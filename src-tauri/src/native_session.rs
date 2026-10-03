//! Native provider sessions: a provider's own interactive TUI (`claude`,
//! `codex`, `opencode`, `agy`) running in a PTY. The PTY itself is an ordinary
//! `PtyHost` entry, so output, input, resize, kill and exit all use the shared
//! `pty-*` commands and events under the same id. This module only picks the
//! command line, wires Claude's status hooks, and reports a coarse status.

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::dirs_home;
use crate::harness::HarnessHost;
use crate::pty::{PtyHost, PtySpawnSpec};

const STATUS_EVENT: &str = "native-session-status";
const STATUS_POLL: Duration = Duration::from_millis(400);
const PROVIDERS: [&str; 4] = ["claude", "codex", "opencode", "antigravity"];

const STATUS_IDLE: &str = "idle";
const STATUS_RUNNING: &str = "running";
const STATUS_WAITING: &str = "waiting";
const STATUS_EXITED: &str = "exited";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeProvider {
    id: String,
    installed: bool,
    path: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NativeSpawnResult {
    resumed: bool,
    /// False when the CLI takes no first-prompt argument; the caller types it.
    prompt_delivered: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatusPayload {
    id: String,
    status: String,
}

struct Tracked {
    /// The PTY child this status belongs to. A respawn under the same id gets
    /// a new pid, and a missing/different pid means this one exited.
    pid: u32,
    /// Written by Claude's hooks. Providers without hooks stay `idle`.
    status_file: Option<PathBuf>,
    /// Lets a later launch stop this CLI if the app dies; removed on exit.
    pid_file: PathBuf,
    last: String,
}

#[derive(Default)]
struct Inner {
    tracked: HashMap<String, Tracked>,
    watcher_running: bool,
}

#[derive(Default)]
pub struct NativeSessions {
    inner: Mutex<Inner>,
}

impl NativeSessions {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[tauri::command(async)]
pub fn native_session_providers(harness: State<'_, HarnessHost>) -> Vec<NativeProvider> {
    PROVIDERS
        .iter()
        .map(|provider| {
            let path = resolve_binary(&harness, provider).ok().flatten();
            NativeProvider {
                id: (*provider).to_string(),
                installed: path.is_some(),
                path: path.map(|path| path.to_string_lossy().into_owned()),
            }
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
#[tauri::command(async)]
pub fn native_session_spawn(
    app: AppHandle,
    host: State<'_, PtyHost>,
    harness: State<'_, HarnessHost>,
    sessions: State<'_, NativeSessions>,
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    provider: String,
    account_id: Option<String>,
    conversation_id: String,
    resume: bool,
    initial_prompt: Option<String>,
) -> Result<NativeSpawnResult, String> {
    if !PROVIDERS.contains(&provider.as_str()) {
        return Err(format!("Unsupported native session provider: {provider}"));
    }
    // Never fall back to another folder (the PTY would use the home
    // directory): an agent must only run where its session lives.
    if !crate::fs::expand_home(&cwd).is_dir() {
        return Err(format!(
            "This session's folder no longer exists: {cwd}. Reopen the project from its new location."
        ));
    }
    let binary = resolve_binary(&harness, &provider)?
        .ok_or_else(|| not_installed_message(&provider).to_string())?;
    let program = binary.to_string_lossy().into_owned();
    let account_id = account_id.as_deref();

    let mut env: Vec<(String, OsString)> = Vec::new();
    let mut env_remove: Vec<String> = Vec::new();
    let mut account_dir = None;
    if matches!(provider.as_str(), "claude" | "codex") {
        if let Some(dir) = crate::harness::provider_account_dir(&app, &provider, account_id)? {
            let (set, remove) = crate::harness::provider_account_env(&provider, &dir);
            env.extend(
                set.into_iter()
                    .map(|(key, value)| (key.to_string(), value.into_os_string())),
            );
            env_remove.extend(remove.iter().map(|key| key.to_string()));
            account_dir = Some(dir);
        } else {
            // The CLI's own folder. A CLAUDE_CONFIG_DIR / CODEX_HOME inherited
            // from the shell that launched MonoCode would silently run another
            // profile instead.
            env_remove.extend(
                default_folder_overrides(&provider)
                    .iter()
                    .map(|key| key.to_string()),
            );
        }
    }

    // Stop tracking the previous child under this id before it is replaced, so
    // the watcher does not report the replacement as exited.
    sessions.lock().tracked.remove(&id);

    let (args, resumed, status_file) = match provider.as_str() {
        "claude" => {
            let conversation = uuid::Uuid::parse_str(conversation_id.trim())
                .map_err(|_| "Invalid Claude conversation id".to_string())?
                .to_string();
            let config_dir = account_dir.clone().or_else(default_claude_config_dir);
            let resumed = config_dir
                .as_deref()
                .is_some_and(|dir| claude_transcript_exists(dir, &conversation));
            let dir = session_dir(&app, &id)?;
            let status_file = dir.join("status");
            let settings_file = dir.join("settings.json");
            let _ = std::fs::remove_file(&status_file);
            std::fs::write(&status_file, STATUS_IDLE)
                .map_err(|e| format!("Could not write {}: {e}", status_file.display()))?;
            let settings = serde_json::to_string_pretty(&claude_hook_settings(&status_file))
                .map_err(|e| e.to_string())?;
            std::fs::write(&settings_file, settings)
                .map_err(|e| format!("Could not write {}: {e}", settings_file.display()))?;
            (
                claude_args(&conversation, resumed, &settings_file),
                resumed,
                Some(status_file),
            )
        }
        other => (
            simple_args(other, resume),
            resume && other != "antigravity",
            None,
        ),
    };

    let initial_prompt = initial_prompt.filter(|prompt| !prompt.trim().is_empty());
    let prompt_delivered = initial_prompt.is_some() && takes_prompt_argument(&provider, resume);
    let args = match initial_prompt {
        Some(prompt) if prompt_delivered => with_initial_prompt(&provider, args, &prompt),
        _ => args,
    };

    let pid_file = session_dir(&app, &id)?.join("pid");
    // Claude's command line names this session's own settings file; other
    // CLIs can only be matched by their binary.
    let marker = status_file
        .as_ref()
        .and_then(|status| status.parent())
        .map(|dir| dir.join("settings.json").to_string_lossy().into_owned())
        .unwrap_or_else(|| {
            binary
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default()
        });
    stop_stale_cli(&pid_file, &marker);

    let pid = crate::pty::spawn_pty(
        app.clone(),
        &host,
        id.clone(),
        &cwd,
        cols,
        rows,
        PtySpawnSpec {
            program,
            args,
            env,
            env_remove,
        },
    )?;

    // Lets the next launch find this CLI if MonoCode dies without stopping it.
    let _ = std::fs::write(&pid_file, pid.to_string());

    let start_watcher = {
        let mut inner = sessions.lock();
        // A newer spawn for this id may have replaced ours while it ran;
        // tracking this one would report the live session as exited.
        if host.pid_of(&id) != Some(pid) {
            return Err("The session was restarted while it was starting.".into());
        }
        inner.tracked.insert(
            id.clone(),
            Tracked {
                pid,
                status_file,
                pid_file: pid_file.clone(),
                last: STATUS_IDLE.into(),
            },
        );
        !std::mem::replace(&mut inner.watcher_running, true)
    };
    let _ = app.emit(
        STATUS_EVENT,
        StatusPayload {
            id,
            status: STATUS_IDLE.into(),
        },
    );
    if start_watcher {
        let watch_app = app.clone();
        thread::spawn(move || watch_statuses(watch_app));
    }

    Ok(NativeSpawnResult {
        resumed,
        prompt_delivered,
    })
}

/// Current status of each requested id that is still a live native session.
#[tauri::command]
pub fn native_session_status(
    host: State<'_, PtyHost>,
    sessions: State<'_, NativeSessions>,
    ids: Vec<String>,
) -> HashMap<String, String> {
    let inner = sessions.lock();
    ids.into_iter()
        .filter_map(|id| {
            let tracked = inner.tracked.get(&id)?;
            if host.pid_of(&id) != Some(tracked.pid) {
                return None;
            }
            let status = tracked
                .status_file
                .as_deref()
                .and_then(read_status)
                .unwrap_or_else(|| tracked.last.clone());
            Some((id, status))
        })
        .collect()
}

/// One shared poller for every live native session. Exits once nothing is
/// tracked; the next spawn starts it again.
fn watch_statuses(app: AppHandle) {
    loop {
        thread::sleep(STATUS_POLL);
        let (Some(host), Some(sessions)) = (
            app.try_state::<PtyHost>(),
            app.try_state::<NativeSessions>(),
        ) else {
            return;
        };
        let mut events = Vec::new();
        let stop = {
            let mut inner = sessions.lock();
            inner.tracked.retain(|id, tracked| {
                if host.pid_of(id) != Some(tracked.pid) {
                    remove_pid_file(&tracked.pid_file, tracked.pid);
                    events.push((id.clone(), STATUS_EXITED.to_string()));
                    return false;
                }
                if let Some(status) = tracked.status_file.as_deref().and_then(read_status) {
                    if status != tracked.last {
                        tracked.last = status.clone();
                        events.push((id.clone(), status));
                    }
                }
                true
            });
            if inner.tracked.is_empty() {
                inner.watcher_running = false;
            }
            !inner.watcher_running
        };
        for (id, status) in events {
            let _ = app.emit(STATUS_EVENT, StatusPayload { id, status });
        }
        if stop {
            return;
        }
    }
}

fn read_status(path: &Path) -> Option<String> {
    parse_status(&std::fs::read_to_string(path).ok()?)
}

/// A hook may be mid-write (truncated file) or print stray whitespace; only a
/// known word counts.
fn parse_status(raw: &str) -> Option<String> {
    let word = raw.trim();
    matches!(word, STATUS_IDLE | STATUS_RUNNING | STATUS_WAITING).then(|| word.to_string())
}

fn resolve_binary(harness: &HarnessHost, provider: &str) -> Result<Option<PathBuf>, String> {
    match provider {
        "claude" | "codex" | "opencode" => match harness.runtime_binary_path(provider) {
            Some(path) => {
                crate::harness::resolve_harness_binary_override(provider, &path).map(Some)
            }
            None => Ok(crate::harness::resolve_harness_binary_default(provider)),
        },
        "antigravity" => Ok(resolve_agy()),
        _ => Err(format!("Unsupported native session provider: {provider}")),
    }
}

/// The interactive Antigravity CLI, not the ACP server the harness uses.
fn resolve_agy() -> Option<PathBuf> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let local = dirs_home().map(|home| PathBuf::from(home).join(".local/bin/agy"));
        if let Some(local) = local {
            let executable = std::fs::metadata(&local)
                .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0);
            if executable {
                return Some(local);
            }
        }
        crate::harness::which_via_login_shell("agy")
    }
    #[cfg(not(unix))]
    {
        None
    }
}

fn not_installed_message(provider: &str) -> &'static str {
    match provider {
        "claude" => "Claude Code is not installed. Install it and run `claude` once to sign in.",
        "codex" => "Codex CLI is not installed. Install it and run `codex` once to sign in.",
        "opencode" => {
            "OpenCode is not installed. Install it from https://opencode.ai and run `opencode auth login`."
        }
        "antigravity" if cfg!(windows) => "The Antigravity CLI (agy) is not supported on Windows.",
        "antigravity" => {
            "The Antigravity CLI (agy) is not installed. Install Antigravity and run `agy` once to sign in."
        }
        _ => "This provider is not supported.",
    }
}

fn simple_args(provider: &str, resume: bool) -> Vec<String> {
    let args: &[&str] = match (provider, resume) {
        // The picker lists this folder's conversations. `--last` would pick
        // whichever ran most recently, which may belong to another tab.
        ("codex", true) => &["resume"],
        ("opencode", true) => &["--continue"],
        _ => &[],
    };
    args.iter().map(|arg| (*arg).to_string()).collect()
}

/// Whether the CLI gets its first prompt as an argument. Otherwise the app
/// types it into the TUI once it is up.
///
/// - Antigravity has no prompt argument.
/// - `codex resume` opens a session picker, where a positional prompt would
///   be read as a session id.
/// - On Windows the CLIs are usually `.cmd` shims run through `cmd.exe`,
///   which does not honour argument quoting: free text there could run
///   commands, and newlines cut it short.
fn takes_prompt_argument(provider: &str, resume: bool) -> bool {
    if cfg!(windows) {
        return false;
    }
    match provider {
        "antigravity" => false,
        "codex" => !resume,
        _ => true,
    }
}

/// Hand the CLI its first prompt on the command line, so it starts working at
/// once in its own TUI. A leading `-` is padded so it is never read as a flag.
fn with_initial_prompt(provider: &str, mut args: Vec<String>, prompt: &str) -> Vec<String> {
    let prompt = if prompt.starts_with('-') {
        format!(" {prompt}")
    } else {
        prompt.to_string()
    };
    match provider {
        "claude" | "codex" => args.push(prompt),
        "opencode" => {
            args.push("--prompt".into());
            args.push(prompt);
        }
        _ => {}
    }
    args
}

fn claude_args(conversation_id: &str, resume: bool, settings: &Path) -> Vec<String> {
    let flag = if resume { "--resume" } else { "--session-id" };
    vec![
        flag.into(),
        conversation_id.into(),
        "--settings".into(),
        settings.to_string_lossy().into_owned(),
    ]
}

/// Variables that would point a CLI away from its own default folder.
fn default_folder_overrides(provider: &str) -> &'static [&'static str] {
    match provider {
        "claude" => &["CLAUDE_CONFIG_DIR", "CLAUDE_SECURESTORAGE_CONFIG_DIR"],
        "codex" => &["CODEX_HOME"],
        _ => &[],
    }
}

/// The default profile always runs with `~/.claude` (see
/// `default_folder_overrides`), so that is where its transcripts live.
fn default_claude_config_dir() -> Option<PathBuf> {
    crate::harness::provider_default_folder("claude")
}

/// Claude keeps one `<conversation>.jsonl` per session under
/// `projects/<encoded cwd>/`.
fn claude_transcript_exists(config_dir: &Path, conversation_id: &str) -> bool {
    let file = format!("{conversation_id}.jsonl");
    let Ok(entries) = std::fs::read_dir(config_dir.join("projects")) else {
        return false;
    };
    entries
        .flatten()
        .any(|entry| entry.path().join(&file).is_file())
}

/// Stop a CLI that an earlier MonoCode started for this session but never
/// stopped (it crashed or was killed). Its terminal is gone, yet it would
/// keep holding the conversation alongside the one about to start.
fn stop_stale_cli(pid_file: &Path, marker: &str) {
    let Ok(raw) = std::fs::read_to_string(pid_file) else {
        return;
    };
    let _ = std::fs::remove_file(pid_file);
    let Some(pid) = parse_pid(&raw) else {
        return;
    };
    // The pid may since belong to an unrelated process: only stop it when it
    // is still running this provider's CLI.
    if running_command(pid).is_some_and(|command| command_runs(&command, marker)) {
        crate::pty::terminate(pid);
    }
}

/// Forget an exited CLI, unless a newer one already took over the file.
fn remove_pid_file(pid_file: &Path, pid: u32) {
    let recorded = std::fs::read_to_string(pid_file)
        .ok()
        .and_then(|raw| parse_pid(&raw));
    if recorded == Some(pid) {
        let _ = std::fs::remove_file(pid_file);
    }
}

fn parse_pid(raw: &str) -> Option<u32> {
    raw.trim().parse::<u32>().ok().filter(|pid| *pid > 1)
}

fn command_runs(command: &str, marker: &str) -> bool {
    !marker.is_empty() && command.contains(marker)
}

#[cfg(unix)]
fn running_command(pid: u32) -> Option<String> {
    let output = std::process::Command::new("ps")
        .args(["-o", "command=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    let command = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (output.status.success() && !command.is_empty()).then_some(command)
}

#[cfg(not(unix))]
fn running_command(_pid: u32) -> Option<String> {
    None
}

fn session_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("native-sessions")
        .join(safe_dir_name(id));
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn safe_dir_name(id: &str) -> String {
    let name: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if name.is_empty() {
        "_".into()
    } else {
        name
    }
}

/// A shell command that overwrites `path` with `word`. Claude runs hooks via
/// a POSIX shell (Git Bash on Windows); `echo word> "path"` also works in cmd.
fn hook_command(word: &str, path: &Path) -> String {
    let raw = path.to_string_lossy();
    #[cfg(windows)]
    let quoted = raw.replace('\\', "/");
    #[cfg(not(windows))]
    let quoted = raw
        .chars()
        .fold(String::with_capacity(raw.len()), |mut out, c| {
            if matches!(c, '\\' | '"' | '$' | '`') {
                out.push('\\');
            }
            out.push(c);
            out
        });
    format!("echo {word}> \"{quoted}\"")
}

fn claude_hook_settings(status_file: &Path) -> serde_json::Value {
    let matcher = |matcher: &str, word: &str| {
        serde_json::json!({
            "matcher": matcher,
            "hooks": [{ "type": "command", "command": hook_command(word, status_file) }],
        })
    };
    let entry = |word: &str| serde_json::json!([matcher("", word)]);
    serde_json::json!({
        "hooks": {
            "SessionStart": entry(STATUS_IDLE),
            "UserPromptSubmit": entry(STATUS_RUNNING),
            "PreToolUse": entry(STATUS_RUNNING),
            "PostToolUse": entry(STATUS_RUNNING),
            "Notification": [
                matcher("permission_prompt|elicitation_dialog", STATUS_WAITING),
                // Claude has been waiting for a new prompt for a while. No Stop
                // hook fires after an interrupt (Esc), so this resets a status
                // that would otherwise stay "working".
                matcher("idle_prompt", STATUS_IDLE),
            ],
            "Stop": entry(STATUS_IDLE),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "monocode-native-{name}-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn initial_prompt_goes_where_each_cli_expects_it() {
        let base = vec!["--session-id".to_string(), "abc".to_string()];
        assert_eq!(
            with_initial_prompt("claude", base.clone(), "fix it"),
            vec!["--session-id", "abc", "fix it"]
        );
        assert_eq!(
            with_initial_prompt("opencode", Vec::new(), "-x"),
            vec!["--prompt", " -x"]
        );
        assert!(with_initial_prompt("antigravity", Vec::new(), "hi").is_empty());
    }

    #[test]
    fn stale_cli_records_only_match_the_providers_binary() {
        assert_eq!(parse_pid(" 4242\n"), Some(4242));
        assert_eq!(parse_pid("1"), None);
        assert_eq!(parse_pid("nope"), None);
        let settings = "/data/native-sessions/s1/settings.json";
        assert!(command_runs(
            "/opt/bin/claude --session-id x --settings /data/native-sessions/s1/settings.json",
            settings,
        ));
        // The user's own claude, or another session's, is left alone.
        assert!(!command_runs("/opt/bin/claude --session-id x", settings));
        assert!(!command_runs("/usr/bin/vim notes.md", "claude"));
        assert!(!command_runs("anything", ""));
    }

    #[test]
    fn simple_args_per_provider() {
        assert_eq!(simple_args("codex", true), vec!["resume"]);
        assert!(simple_args("codex", false).is_empty());
        assert_eq!(simple_args("opencode", true), vec!["--continue"]);
        assert!(simple_args("opencode", false).is_empty());
        assert!(simple_args("antigravity", true).is_empty());
    }

    #[test]
    fn claude_args_pick_resume_or_new_session() {
        let settings = Path::new("/tmp/s.json");
        assert_eq!(
            claude_args("abc", false, settings),
            vec!["--session-id", "abc", "--settings", "/tmp/s.json"]
        );
        assert_eq!(
            claude_args("abc", true, settings),
            vec!["--resume", "abc", "--settings", "/tmp/s.json"]
        );
    }

    #[test]
    fn transcript_lookup_scans_every_project() {
        let dir = temp_dir("transcript");
        let id = "0b9f6a39-2a0b-4a53-9d3e-1f6a3e9c2b11";
        assert!(!claude_transcript_exists(&dir, id));
        let project = dir.join("projects").join("-home-user-repo");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join("other.jsonl"), "").unwrap();
        assert!(!claude_transcript_exists(&dir, id));
        std::fs::write(project.join(format!("{id}.jsonl")), "{}").unwrap();
        assert!(claude_transcript_exists(&dir, id));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn hook_settings_cover_every_status_event() {
        let status = Path::new("/data/native-sessions/s1/status");
        let settings = claude_hook_settings(status);
        let hooks = settings["hooks"].as_object().unwrap();
        let command = |event: &str| {
            hooks[event][0]["hooks"][0]["command"]
                .as_str()
                .unwrap()
                .to_string()
        };
        assert_eq!(
            command("SessionStart"),
            "echo idle> \"/data/native-sessions/s1/status\""
        );
        assert!(command("UserPromptSubmit").starts_with("echo running>"));
        assert!(command("PreToolUse").starts_with("echo running>"));
        assert!(command("PostToolUse").starts_with("echo running>"));
        assert!(command("Notification").starts_with("echo waiting>"));
        assert!(command("Stop").starts_with("echo idle>"));
        assert_eq!(
            hooks["Notification"][0]["matcher"],
            "permission_prompt|elicitation_dialog"
        );
        assert_eq!(hooks["Stop"][0]["hooks"][0]["type"], "command");
        assert_eq!(hooks.len(), 6);
    }

    #[cfg(unix)]
    #[test]
    fn hook_command_escapes_shell_specials() {
        assert_eq!(
            hook_command("idle", Path::new("/a b/$x/\"q\"/status")),
            "echo idle> \"/a b/\\$x/\\\"q\\\"/status\""
        );
    }

    #[cfg(unix)]
    #[test]
    fn hook_command_writes_the_status_word() {
        let dir = temp_dir("hook dir $HOME");
        let status = dir.join("status");
        let ok = std::process::Command::new("sh")
            .arg("-c")
            .arg(hook_command("waiting", &status))
            .status()
            .unwrap()
            .success();
        assert!(ok);
        assert_eq!(read_status(&status).as_deref(), Some("waiting"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_status_accepts_known_words_only() {
        assert_eq!(parse_status("running\n").as_deref(), Some("running"));
        assert_eq!(parse_status("idle\r\n").as_deref(), Some("idle"));
        assert_eq!(parse_status("waiting").as_deref(), Some("waiting"));
        assert_eq!(parse_status(""), None);
        assert_eq!(parse_status("exited"), None);
        assert_eq!(parse_status("bogus"), None);
    }

    #[test]
    fn safe_dir_name_strips_path_characters() {
        assert_eq!(safe_dir_name("sess-1_a"), "sess-1_a");
        assert_eq!(safe_dir_name("../x/y"), "___x_y");
        assert_eq!(safe_dir_name(""), "_");
    }
}
