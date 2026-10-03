//! Keep MonoCode's Claude accounts on the default profile's configuration.
//!
//! Each account runs Claude with its own `CLAUDE_CONFIG_DIR`, so it never sees
//! what was set up with plain `claude` (`~/.claude.json`, `~/.claude/`).
//! Before a session starts on an account, the default profile is mirrored in:
//!
//! - MCP servers: `mcpServers` of `~/.claude.json`.
//! - Settings: `~/.claude/settings.json`, key by key; object values (hooks,
//!   permissions, enabledPlugins, ...) one entry deeper.
//! - Plugins: `plugins/installed_plugins.json` and
//!   `plugins/known_marketplaces.json`. Their entries hold absolute paths, so
//!   the account runs the copies installed under `~/.claude/plugins`.
//! - Files: `CLAUDE.md`, `AGENTS.md`, `keybindings.json` and each entry of
//!   `skills/`, `agents/`, `commands/` and `output-styles/`, as symlinks so
//!   edits show up everywhere at once.
//!
//! The default profile wins where both define something. What the account
//! has on its own is kept, and an item removed from the default profile is
//! removed from the account only if a sync put it there (tracked in
//! `SYNCED_FILE`). Credentials, login settings (`ACCOUNT_SETTINGS`,
//! `ACCOUNT_ENV`), history and the claude.ai-synced `synced/` folders stay
//! per account, and nothing inside the default profile is ever changed.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

const CONFIG_FILE: &str = ".claude.json";
const SYNCED_FILE: &str = "monocode-synced.json";
const LINKED_FILES: &[&str] = &["CLAUDE.md", "AGENTS.md", "keybindings.json"];
const LINKED_DIRS: &[&str] = &["skills", "agents", "commands", "output-styles"];

/// Settings that pick how Claude signs in or which API it talks to. Copying
/// them would run every account on the default profile's credentials.
const ACCOUNT_SETTINGS: &[&str] = &[
    "apiKeyHelper",
    "awsAuthRefresh",
    "awsCredentialExport",
    "forceLoginMethod",
    "forceLoginOrgUUID",
    "otelHeadersHelper",
];
const ACCOUNT_ENV: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_CUSTOM_HEADERS",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CONFIG_DIR",
    "CLAUDE_SECURESTORAGE_CONFIG_DIR",
];

/// The default profile: `~/.claude.json` and `~/.claude/`.
pub(crate) struct DefaultProfile {
    pub config_file: PathBuf,
    pub dir: PathBuf,
}

impl DefaultProfile {
    pub(crate) fn locate() -> Option<Self> {
        let home = PathBuf::from(crate::dirs_home()?);
        Some(Self {
            config_file: home.join(CONFIG_FILE),
            dir: home.join(".claude"),
        })
    }
}

/// What earlier syncs copied in, so a later one can tell a copied item the
/// default profile dropped from one the account added itself.
#[derive(Default, Serialize, Deserialize, PartialEq)]
struct Synced {
    #[serde(default)]
    mcp_servers: Vec<String>,
    #[serde(default)]
    settings: Vec<Vec<String>>,
    #[serde(default)]
    plugins: Vec<String>,
    #[serde(default)]
    marketplaces: Vec<String>,
    #[serde(default)]
    links: Vec<String>,
}

/// Mirror the default profile into the account at `account_dir`. Returns
/// whether anything in the account changed.
pub(crate) fn sync_claude_account(
    default: &DefaultProfile,
    account_dir: &Path,
) -> Result<bool, String> {
    if same_path(&default.dir, account_dir) {
        return Ok(false);
    }
    let synced_file = account_dir.join(SYNCED_FILE);
    let before: Synced = read_json(&synced_file)
        .ok()
        .flatten()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default();
    let mut after = Synced::default();
    let mut changed = false;
    let mut errors = Vec::new();

    // Each step runs on its own: one bad file must not stop the others, and
    // a step that failed keeps what it had copied before so a later sync can
    // still clean it up.
    let mut step =
        |result: Result<bool, String>, before: &[String], after: &mut Vec<String>| match result {
            Ok(step_changed) => changed |= step_changed,
            Err(error) => {
                keep_tracked(before, after);
                errors.push(error);
            }
        };
    let plugins = Path::new("plugins");
    step(
        sync_map_in_file(
            &default.config_file,
            &account_dir.join(CONFIG_FILE),
            &["mcpServers"],
            false,
            &before.mcp_servers,
            &mut after.mcp_servers,
        ),
        &before.mcp_servers,
        &mut after.mcp_servers,
    );
    step(
        sync_map_in_file(
            &default.dir.join(plugins).join("installed_plugins.json"),
            &account_dir.join(plugins).join("installed_plugins.json"),
            &["plugins"],
            true,
            &before.plugins,
            &mut after.plugins,
        ),
        &before.plugins,
        &mut after.plugins,
    );
    step(
        sync_map_in_file(
            &default.dir.join(plugins).join("known_marketplaces.json"),
            &account_dir.join(plugins).join("known_marketplaces.json"),
            &[],
            true,
            &before.marketplaces,
            &mut after.marketplaces,
        ),
        &before.marketplaces,
        &mut after.marketplaces,
    );
    step(
        sync_links(&default.dir, account_dir, &before.links, &mut after.links),
        &before.links,
        &mut after.links,
    );
    match sync_settings(
        &default.dir.join("settings.json"),
        &account_dir.join("settings.json"),
        &before.settings,
        &mut after.settings,
    ) {
        Ok(step_changed) => changed |= step_changed,
        Err(error) => {
            keep_tracked(&before.settings, &mut after.settings);
            errors.push(error);
        }
    }

    if after != before {
        let value = serde_json::to_value(&after).map_err(|error| error.to_string())?;
        write_json_atomic(&synced_file, &value)
            .map_err(|error| errors.push(error))
            .ok();
    }
    if errors.is_empty() {
        Ok(changed)
    } else {
        Err(errors.join("; "))
    }
}

/// After a failed step: track everything it had copied before as well as
/// anything it copied this time.
fn keep_tracked<T: Clone + PartialEq>(before: &[T], after: &mut Vec<T>) {
    for item in before {
        if !after.contains(item) {
            after.push(item.clone());
        }
    }
}

/// Overlay the map at `path` (an empty path is the file's root) of `source`
/// onto the same map in `target`. Records the names it copied in `copied`.
fn sync_map_in_file(
    source: &Path,
    target: &Path,
    path: &[&str],
    seed_from_source: bool,
    before: &[String],
    copied: &mut Vec<String>,
) -> Result<bool, String> {
    let Some(source_root) = read_json(source)? else {
        // No default file: keep tracking what was copied so a later sync can
        // still clean it up.
        copied.extend(before.iter().cloned());
        return Ok(false);
    };
    let entries = map_at(&source_root, path).cloned().unwrap_or_default();
    copied.extend(entries.keys().cloned());

    let existing = read_json(target)?;
    let created = existing.is_none();
    // A new plugin index takes the source's other fields too: it carries a
    // format "version". Never for .claude.json, which holds the login.
    let mut target_root = existing.unwrap_or_else(|| {
        if !seed_from_source {
            return Value::Object(Map::new());
        }
        let mut root = source_root.clone();
        set_map_at(&mut root, path, Map::new());
        root
    });
    let current = map_at(&target_root, path).cloned().unwrap_or_default();
    let merged = merge_entries(&current, &entries, before);
    if merged == current && (!created || entries.is_empty()) {
        return Ok(false);
    }
    set_map_at(&mut target_root, path, merged)
        .ok_or_else(|| format!("{} is not a JSON object", target.display()))?;
    write_json_atomic(target, &target_root)?;
    Ok(true)
}

/// `settings.json`, key by key. For a key whose value is an object in both
/// files (hooks, permissions, enabledPlugins, env, ...), entry by entry, so
/// the account keeps what it set on its own.
fn sync_settings(
    source: &Path,
    target: &Path,
    before: &[Vec<String>],
    copied: &mut Vec<Vec<String>>,
) -> Result<bool, String> {
    let Some(source_root) = read_json(source)? else {
        copied.extend(before.iter().cloned());
        return Ok(false);
    };
    let Some(source_map) = source_root.as_object() else {
        return Err(format!("{} is not a JSON object", source.display()));
    };
    let mut target_root = read_json(target)?.unwrap_or_else(|| Value::Object(Map::new()));
    let Some(target_map) = target_root.as_object_mut() else {
        return Err(format!("{} is not a JSON object", target.display()));
    };
    let original = target_map.clone();

    for path in before {
        let still_there = match path.as_slice() {
            [key] => source_map.contains_key(key),
            [key, entry] => source_map
                .get(key)
                .and_then(Value::as_object)
                .is_some_and(|map| map.contains_key(entry)),
            _ => true,
        };
        if still_there {
            continue;
        }
        match path.as_slice() {
            [key] => {
                target_map.remove(key);
            }
            [key, entry] => {
                if let Some(map) = target_map.get_mut(key).and_then(Value::as_object_mut) {
                    map.remove(entry);
                    // An object the sync emptied and the default no longer has.
                    if map.is_empty() && !source_map.contains_key(key) {
                        target_map.remove(key);
                    }
                }
            }
            _ => {}
        }
    }

    for (key, value) in source_map {
        if ACCOUNT_SETTINGS.contains(&key.as_str()) {
            continue;
        }
        let filtered;
        let value = if key == "env" {
            filtered = Value::Object(
                value
                    .as_object()
                    .map(|vars| {
                        vars.iter()
                            .filter(|(name, _)| !ACCOUNT_ENV.contains(&name.as_str()))
                            .map(|(name, value)| (name.clone(), value.clone()))
                            .collect()
                    })
                    .unwrap_or_default(),
            );
            &filtered
        } else {
            value
        };
        match (value.as_object(), target_map.get_mut(key)) {
            (Some(entries), Some(Value::Object(current))) => {
                for (entry, entry_value) in entries {
                    current.insert(entry.clone(), entry_value.clone());
                    copied.push(vec![key.clone(), entry.clone()]);
                }
            }
            (Some(entries), _) => {
                target_map.insert(key.clone(), value.clone());
                copied.extend(entries.keys().map(|entry| vec![key.clone(), entry.clone()]));
            }
            (None, _) => {
                target_map.insert(key.clone(), value.clone());
                copied.push(vec![key.clone()]);
            }
        }
    }

    if *target_map == original {
        return Ok(false);
    }
    write_json_atomic(target, &target_root)?;
    Ok(true)
}

/// Symlink the default profile's instructions, keybindings, skills, agents,
/// commands and output styles into the account. A real file or folder the
/// account has under the same name is left alone.
#[cfg(unix)]
fn sync_links(
    default_dir: &Path,
    account_dir: &Path,
    before: &[String],
    linked: &mut Vec<String>,
) -> Result<bool, String> {
    let mut wanted: Vec<String> = LINKED_FILES
        .iter()
        .filter(|name| default_dir.join(name).is_file())
        .map(|name| name.to_string())
        .collect();
    for dir in LINKED_DIRS {
        let Ok(entries) = std::fs::read_dir(default_dir.join(dir)) else {
            continue;
        };
        let mut names: Vec<String> = entries
            .flatten()
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| !name.starts_with('.') && name != "synced")
            .map(|name| format!("{dir}/{name}"))
            .collect();
        names.sort();
        wanted.extend(names);
    }

    // An account folder (or its skills/ etc.) that resolves into the default
    // profile: a link there is the user's own, never ours to touch.
    let default_real = default_dir
        .canonicalize()
        .unwrap_or_else(|_| default_dir.to_path_buf());
    let inside_default = |link: &Path| {
        link.parent()
            .and_then(|parent| parent.canonicalize().ok())
            .is_some_and(|parent| parent.starts_with(&default_real))
    };

    let mut changed = false;
    for name in before {
        if wanted.contains(name) {
            continue;
        }
        let link = account_dir.join(name);
        if inside_default(&link) {
            continue;
        }
        if std::fs::symlink_metadata(&link).is_ok_and(|meta| meta.file_type().is_symlink()) {
            std::fs::remove_file(&link)
                .map_err(|error| format!("Could not remove {}: {error}", link.display()))?;
            changed = true;
        }
    }

    for name in wanted {
        let source = default_dir.join(&name);
        let link = account_dir.join(&name);
        if inside_default(&link) {
            continue;
        }
        match std::fs::symlink_metadata(&link) {
            Ok(meta) if meta.file_type().is_symlink() => {
                if std::fs::read_link(&link).is_ok_and(|target| target == source) {
                    linked.push(name);
                    continue;
                }
                // A link the account made itself stays.
                if !before.contains(&name) {
                    continue;
                }
                std::fs::remove_file(&link)
                    .map_err(|error| format!("Could not replace {}: {error}", link.display()))?;
            }
            // The account's own file or folder.
            Ok(_) => continue,
            Err(_) => {}
        }
        if let Some(parent) = link.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
        }
        std::os::unix::fs::symlink(&source, &link)
            .map_err(|error| format!("Could not link {}: {error}", link.display()))?;
        linked.push(name);
        changed = true;
    }
    Ok(changed)
}

/// Symlinks need extra privileges on Windows; files are not mirrored there.
#[cfg(not(unix))]
fn sync_links(
    _default_dir: &Path,
    _account_dir: &Path,
    _before: &[String],
    _linked: &mut Vec<String>,
) -> Result<bool, String> {
    Ok(false)
}

/// The account's entries with the default profile's on top. An entry an
/// earlier sync copied and the default profile has since dropped goes too.
fn merge_entries(
    current: &Map<String, Value>,
    source: &Map<String, Value>,
    before: &[String],
) -> Map<String, Value> {
    let mut merged = current.clone();
    for name in before {
        if !source.contains_key(name) {
            merged.remove(name);
        }
    }
    for (name, value) in source {
        merged.insert(name.clone(), value.clone());
    }
    merged
}

fn map_at<'a>(root: &'a Value, path: &[&str]) -> Option<&'a Map<String, Value>> {
    path.iter()
        .try_fold(root, |value, key| value.get(key))?
        .as_object()
}

fn set_map_at(root: &mut Value, path: &[&str], map: Map<String, Value>) -> Option<()> {
    let Some((last, parents)) = path.split_last() else {
        *root = Value::Object(map);
        return Some(());
    };
    let mut value = root;
    for key in parents {
        value = value
            .as_object_mut()?
            .entry(key.to_string())
            .or_insert_with(|| Value::Object(Map::new()));
    }
    value
        .as_object_mut()?
        .insert(last.to_string(), Value::Object(map));
    Some(())
}

fn same_path(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

fn read_json(path: &Path) -> Result<Option<Value>, String> {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not read {}: {error}", path.display())),
    };
    if raw.trim().is_empty() {
        return Ok(None);
    }
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|error| format!("Could not parse {}: {error}", path.display()))
}

/// Write through a temp file and rename, so a CLI reading the file never
/// sees half of it. These files can hold credentials: keep them owner-only.
fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    // Replace what a symlinked config points at, not the link.
    let resolved = path.canonicalize().ok();
    let path = resolved.as_deref().unwrap_or(path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    let tmp = path.with_file_name(format!(
        ".{}.monocode-{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("config"),
        uuid::Uuid::new_v4()
    ));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(&tmp)
        .and_then(|mut file| {
            use std::io::Write;
            file.write_all(text.as_bytes())
        })
        .map_err(|error| {
            let _ = std::fs::remove_file(&tmp);
            format!("Could not write {}: {error}", tmp.display())
        })?;
    std::fs::rename(&tmp, path).map_err(|error| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not write {}: {error}", path.display())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "monocode-account-sync-{name}-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn profile() -> (DefaultProfile, PathBuf) {
        let home = temp_dir("home");
        let dir = home.join(".claude");
        std::fs::create_dir_all(dir.join("plugins")).unwrap();
        (
            DefaultProfile {
                config_file: home.join(CONFIG_FILE),
                dir,
            },
            temp_dir("account"),
        )
    }

    fn write(path: &Path, value: Value) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, serde_json::to_string(&value).unwrap()).unwrap();
    }

    fn read(path: &Path) -> Value {
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn copies_mcp_servers_and_keeps_the_rest_of_the_account_config() {
        let (default, account) = profile();
        write(
            &default.config_file,
            json!({ "mcpServers": { "notes": { "type": "http", "url": "https://n/mcp" } } }),
        );
        write(
            &account.join(CONFIG_FILE),
            json!({ "oauthAccount": { "email": "a@b" }, "mcpServers": { "own": { "command": "x" } } }),
        );

        assert!(sync_claude_account(&default, &account).unwrap());
        let config = read(&account.join(CONFIG_FILE));
        assert_eq!(config["oauthAccount"]["email"], "a@b");
        assert_eq!(config["mcpServers"]["notes"]["url"], "https://n/mcp");
        assert_eq!(config["mcpServers"]["own"]["command"], "x");

        // Already in sync: nothing to write.
        assert!(!sync_claude_account(&default, &account).unwrap());
    }

    #[test]
    fn follows_default_updates_and_removals_but_not_account_servers() {
        let (default, account) = profile();
        write(
            &default.config_file,
            json!({ "mcpServers": { "a": { "url": "1" }, "b": { "url": "1" } } }),
        );
        write(
            &account.join(CONFIG_FILE),
            json!({ "mcpServers": { "own": { "url": "x" } } }),
        );
        sync_claude_account(&default, &account).unwrap();

        write(
            &default.config_file,
            json!({ "mcpServers": { "a": { "url": "2" } } }),
        );
        assert!(sync_claude_account(&default, &account).unwrap());
        assert_eq!(
            read(&account.join(CONFIG_FILE))["mcpServers"],
            json!({ "a": { "url": "2" }, "own": { "url": "x" } })
        );
    }

    #[test]
    fn merges_settings_one_level_deep() {
        let (default, account) = profile();
        write(
            &default.dir.join("settings.json"),
            json!({
                "outputStyle": "Concise",
                "enabledPlugins": { "a@m": true },
                "permissions": { "defaultMode": "auto" }
            }),
        );
        write(
            &account.join("settings.json"),
            json!({
                "theme": "dark",
                "outputStyle": "Explanatory",
                "enabledPlugins": { "own@m": true }
            }),
        );
        assert!(sync_claude_account(&default, &account).unwrap());
        assert_eq!(
            read(&account.join("settings.json")),
            json!({
                "theme": "dark",
                "outputStyle": "Concise",
                "enabledPlugins": { "own@m": true, "a@m": true },
                "permissions": { "defaultMode": "auto" }
            })
        );

        // Dropped from the default profile: dropped from the account too.
        write(
            &default.dir.join("settings.json"),
            json!({ "enabledPlugins": {} }),
        );
        sync_claude_account(&default, &account).unwrap();
        assert_eq!(
            read(&account.join("settings.json")),
            json!({ "theme": "dark", "enabledPlugins": { "own@m": true } })
        );
    }

    #[test]
    fn copies_installed_plugins_and_marketplaces() {
        let (default, account) = profile();
        write(
            &default.dir.join("plugins/installed_plugins.json"),
            json!({ "version": 2, "plugins": { "a@m": [{ "installPath": "/home/.claude/plugins/cache/a" }] } }),
        );
        write(
            &default.dir.join("plugins/known_marketplaces.json"),
            json!({ "m": { "installLocation": "/home/.claude/plugins/marketplaces/m" } }),
        );
        write(
            &account.join("plugins/installed_plugins.json"),
            json!({ "version": 2, "plugins": { "own@m": [] } }),
        );
        assert!(sync_claude_account(&default, &account).unwrap());
        let installed = read(&account.join("plugins/installed_plugins.json"));
        assert_eq!(installed["version"], 2);
        assert!(installed["plugins"]["own@m"].is_array());
        assert_eq!(
            installed["plugins"]["a@m"][0]["installPath"],
            "/home/.claude/plugins/cache/a"
        );
        assert_eq!(
            read(&account.join("plugins/known_marketplaces.json"))["m"]["installLocation"],
            "/home/.claude/plugins/marketplaces/m"
        );
    }

    #[cfg(unix)]
    #[test]
    fn links_instructions_and_skills_but_not_synced_or_own_ones() {
        let (default, account) = profile();
        std::fs::write(default.dir.join("CLAUDE.md"), "# rules").unwrap();
        std::fs::create_dir_all(default.dir.join("skills/commit")).unwrap();
        std::fs::create_dir_all(default.dir.join("skills/old")).unwrap();
        std::fs::create_dir_all(default.dir.join("skills/synced/x")).unwrap();
        std::fs::create_dir_all(default.dir.join("skills/.trash")).unwrap();
        std::fs::create_dir_all(account.join("skills/mine")).unwrap();
        std::fs::write(account.join("AGENTS.md"), "own").unwrap();
        std::fs::write(default.dir.join("AGENTS.md"), "default").unwrap();

        assert!(sync_claude_account(&default, &account).unwrap());
        assert_eq!(
            std::fs::read_to_string(account.join("CLAUDE.md")).unwrap(),
            "# rules"
        );
        assert_eq!(
            std::fs::read_link(account.join("skills/commit")).unwrap(),
            default.dir.join("skills/commit")
        );
        assert!(!account.join("skills/synced").exists());
        assert!(!account.join("skills/.trash").exists());
        assert!(account.join("skills/mine").is_dir());
        assert_eq!(
            std::fs::read_to_string(account.join("AGENTS.md")).unwrap(),
            "own"
        );

        std::fs::remove_dir_all(default.dir.join("skills/old")).unwrap();
        assert!(sync_claude_account(&default, &account).unwrap());
        assert!(std::fs::symlink_metadata(account.join("skills/old")).is_err());
        assert!(!sync_claude_account(&default, &account).unwrap());
    }

    #[test]
    fn missing_default_profile_changes_nothing() {
        let (default, account) = profile();
        assert!(!sync_claude_account(&default, &account).unwrap());
        assert!(!account.join(CONFIG_FILE).exists());
        assert!(!account.join("settings.json").exists());
    }

    #[test]
    fn a_new_account_config_gets_only_the_servers_not_the_login() {
        let (default, account) = profile();
        write(
            &default.config_file,
            json!({
                "oauthAccount": { "email": "default@x" },
                "projects": { "/p": {} },
                "mcpServers": { "notes": { "url": "u" } }
            }),
        );
        assert!(sync_claude_account(&default, &account).unwrap());
        assert_eq!(
            read(&account.join(CONFIG_FILE)),
            json!({ "mcpServers": { "notes": { "url": "u" } } })
        );
    }

    #[test]
    fn a_new_plugin_index_keeps_its_format_version() {
        let (default, account) = profile();
        write(
            &default.dir.join("plugins/installed_plugins.json"),
            json!({ "version": 2, "plugins": { "a@m": [] } }),
        );
        sync_claude_account(&default, &account).unwrap();
        assert_eq!(
            read(&account.join("plugins/installed_plugins.json")),
            json!({ "version": 2, "plugins": { "a@m": [] } })
        );
    }

    #[test]
    fn login_settings_stay_per_account() {
        let (default, account) = profile();
        write(
            &default.dir.join("settings.json"),
            json!({
                "apiKeyHelper": "/bin/key",
                "forceLoginOrgUUID": "org",
                "env": { "ANTHROPIC_API_KEY": "sk", "ANTHROPIC_BASE_URL": "b", "FOO": "1" }
            }),
        );
        sync_claude_account(&default, &account).unwrap();
        assert_eq!(
            read(&account.join("settings.json")),
            json!({ "env": { "FOO": "1" } })
        );
    }

    #[test]
    fn a_key_changing_between_object_and_value_follows_the_default() {
        let (default, account) = profile();
        let settings = default.dir.join("settings.json");
        write(&settings, json!({ "statusLine": { "type": "command" } }));
        sync_claude_account(&default, &account).unwrap();
        write(&settings, json!({ "statusLine": "off" }));
        sync_claude_account(&default, &account).unwrap();
        assert_eq!(
            read(&account.join("settings.json")),
            json!({ "statusLine": "off" })
        );
        write(&settings, json!({}));
        sync_claude_account(&default, &account).unwrap();
        assert_eq!(read(&account.join("settings.json")), json!({}));
    }

    #[test]
    fn a_failing_step_keeps_the_others_and_their_tracking() {
        let (default, account) = profile();
        write(
            &default.config_file,
            json!({ "mcpServers": { "x": { "url": "u" } } }),
        );
        write(
            &default.dir.join("settings.json"),
            json!({ "model": "opus" }),
        );
        std::fs::write(account.join("settings.json"), "{ not json").unwrap();

        assert!(sync_claude_account(&default, &account).is_err());
        assert_eq!(
            read(&account.join(CONFIG_FILE))["mcpServers"]["x"]["url"],
            "u"
        );

        // The server copied during the failed run is still known as ours.
        write(&default.config_file, json!({ "mcpServers": {} }));
        std::fs::write(account.join("settings.json"), "{}").unwrap();
        sync_claude_account(&default, &account).unwrap();
        assert_eq!(read(&account.join(CONFIG_FILE))["mcpServers"], json!({}));
    }

    #[test]
    fn an_account_server_with_a_default_name_is_left_once_the_default_drops_it() {
        let (default, account) = profile();
        write(
            &account.join(CONFIG_FILE),
            json!({ "mcpServers": { "own": { "url": "a" } } }),
        );
        write(&default.config_file, json!({ "mcpServers": {} }));
        sync_claude_account(&default, &account).unwrap();
        assert_eq!(
            read(&account.join(CONFIG_FILE))["mcpServers"]["own"]["url"],
            "a"
        );
    }

    #[cfg(unix)]
    #[test]
    fn never_touches_links_inside_the_default_profile() {
        let (default, account) = profile();
        let elsewhere = temp_dir("elsewhere");
        std::fs::create_dir_all(default.dir.join("skills")).unwrap();
        // The user's own skill link in ~/.claude/skills.
        std::os::unix::fs::symlink(&elsewhere, default.dir.join("skills/managed")).unwrap();
        // The account shares ~/.claude/skills wholesale.
        std::os::unix::fs::symlink(default.dir.join("skills"), account.join("skills")).unwrap();

        sync_claude_account(&default, &account).unwrap();
        sync_claude_account(&default, &account).unwrap();
        assert_eq!(
            std::fs::read_link(default.dir.join("skills/managed")).unwrap(),
            elsewhere
        );
    }

    #[cfg(unix)]
    #[test]
    fn keeps_a_link_the_account_made_itself() {
        let (default, account) = profile();
        let own = temp_dir("own-skill");
        std::fs::create_dir_all(default.dir.join("skills/commit")).unwrap();
        std::fs::create_dir_all(account.join("skills")).unwrap();
        std::os::unix::fs::symlink(&own, account.join("skills/commit")).unwrap();

        sync_claude_account(&default, &account).unwrap();
        assert_eq!(
            std::fs::read_link(account.join("skills/commit")).unwrap(),
            own
        );
    }

    #[cfg(unix)]
    #[test]
    fn writes_configs_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let (default, account) = profile();
        write(&default.config_file, json!({ "mcpServers": { "x": {} } }));
        sync_claude_account(&default, &account).unwrap();
        let mode = std::fs::metadata(account.join(CONFIG_FILE))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
