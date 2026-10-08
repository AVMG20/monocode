//! Keep MonoCode's Claude accounts on the default profile's configuration.
//!
//! Each account runs Claude with its own `CLAUDE_CONFIG_DIR`, so it never sees
//! what was set up with plain `claude` (`~/.claude.json`, `~/.claude/`).
//! Before a session starts on an account, the default profile is mirrored in:
//!
//! - MCP servers: `mcpServers` of `~/.claude.json`, and each project's own
//!   `projects.<path>.mcpServers`.
//! - Settings: `~/.claude/settings.json`, key by key; object values (hooks,
//!   permissions, enabledPlugins, ...) one entry deeper, and list entries
//!   (permission rules, hooks per event) item by item.
//! - Plugins: `plugins/installed_plugins.json` and
//!   `plugins/known_marketplaces.json`. Their entries hold absolute paths, so
//!   the account runs the copies installed under `~/.claude/plugins`.
//! - Files: `CLAUDE.md`, `AGENTS.md`, `keybindings.json` and each entry of
//!   `skills/`, `agents/`, `commands/`, `output-styles/` and `rules/`, as
//!   symlinks so edits show up everywhere at once.
//!
//! The default profile wins where both define something. What the account
//! has on its own is kept, and an item removed from the default profile is
//! removed from the account only if a sync put it there (tracked in
//! `SYNCED_FILE`). Credentials, login settings (`ACCOUNT_SETTINGS`,
//! `is_account_env`), history and the claude.ai-synced `synced/` folders stay
//! per account, and nothing inside the default profile is ever changed.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const CONFIG_FILE: &str = ".claude.json";
const SYNCED_FILE: &str = "monocode-synced.json";
const LINKED_FILES: &[&str] = &["CLAUDE.md", "AGENTS.md", "keybindings.json"];
const LINKED_DIRS: &[&str] = &["skills", "agents", "commands", "output-styles", "rules"];

/// Settings that pick how Claude signs in or which API it talks to. Copying
/// them would run every account on the default profile's credentials.
const ACCOUNT_SETTINGS: &[&str] = &[
    "apiKeyHelper",
    "awsAuthRefresh",
    "awsCredentialExport",
    "forceLoginMethod",
    "forceLoginOrgUUID",
    "gcpAuthRefresh",
    "otelHeadersHelper",
];
const ACCOUNT_ENV: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_CUSTOM_HEADERS",
    "AWS_BEARER_TOKEN_BEDROCK",
    "CLAUDE_CODE_CUSTOM_OAUTH_URL",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CONFIG_DIR",
    "CLAUDE_SECURESTORAGE_CONFIG_DIR",
];
/// Provider switches (`CLAUDE_CODE_USE_BEDROCK`, ...) and their credentials.
const ACCOUNT_ENV_PREFIXES: &[&str] = &[
    "CLAUDE_CODE_USE_",
    "ANTHROPIC_AWS_",
    "ANTHROPIC_BEDROCK_",
    "ANTHROPIC_FOUNDRY_",
    "ANTHROPIC_VERTEX_",
];

/// How long Claude Code's own `.claude.json` lock counts as held.
const CONFIG_LOCK_STALE: Duration = Duration::from_secs(10);
const CONFIG_LOCK_WAIT: Duration = Duration::from_secs(3);

/// Concurrent spawns on one account must not merge over each other.
static SYNC_LOCK: Mutex<()> = Mutex::new(());

/// The default profile: `~/.claude.json` and `~/.claude/`, or the folder an
/// inherited `CLAUDE_CONFIG_DIR` names, as default sessions inherit it too.
pub(crate) struct DefaultProfile {
    pub config_file: PathBuf,
    pub dir: PathBuf,
}

impl DefaultProfile {
    /// `accounts_root` holds MonoCode's account folders. A `CLAUDE_CONFIG_DIR`
    /// inside it (MonoCode started from an account's session) is not the
    /// default profile.
    pub(crate) fn locate(accounts_root: &Path) -> Option<Self> {
        Self::resolve(
            std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from),
            crate::dirs_home().map(PathBuf::from),
            accounts_root,
        )
    }

    fn resolve(
        inherited: Option<PathBuf>,
        home: Option<PathBuf>,
        accounts_root: &Path,
    ) -> Option<Self> {
        let inherited =
            inherited.filter(|dir| !dir.as_os_str().is_empty() && !is_within(dir, accounts_root));
        if let Some(dir) = inherited {
            return Some(Self {
                config_file: dir.join(CONFIG_FILE),
                dir,
            });
        }
        let home = home?;
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
    project_mcp_servers: Vec<Vec<String>>,
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
    let _serial = SYNC_LOCK.lock().unwrap_or_else(|error| error.into_inner());
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
    let config = account_dir.join(CONFIG_FILE);
    match ConfigLock::acquire(&config) {
        Ok(_lock) => {
            let result = sync_map_in_file(
                &default.config_file,
                &config,
                &["mcpServers"],
                false,
                &before.mcp_servers,
                &mut after.mcp_servers,
            );
            record(
                result,
                &before.mcp_servers,
                &mut after.mcp_servers,
                &mut changed,
                &mut errors,
            );
            let result = sync_project_mcp_servers(
                &default.config_file,
                &config,
                &before.project_mcp_servers,
                &mut after.project_mcp_servers,
            );
            record(
                result,
                &before.project_mcp_servers,
                &mut after.project_mcp_servers,
                &mut changed,
                &mut errors,
            );
        }
        Err(error) => {
            keep_tracked(&before.mcp_servers, &mut after.mcp_servers);
            keep_tracked(&before.project_mcp_servers, &mut after.project_mcp_servers);
            errors.push(error);
        }
    }
    let plugins = Path::new("plugins");
    let result = sync_map_in_file(
        &default.dir.join(plugins).join("installed_plugins.json"),
        &account_dir.join(plugins).join("installed_plugins.json"),
        &["plugins"],
        true,
        &before.plugins,
        &mut after.plugins,
    );
    record(
        result,
        &before.plugins,
        &mut after.plugins,
        &mut changed,
        &mut errors,
    );
    let result = sync_map_in_file(
        &default.dir.join(plugins).join("known_marketplaces.json"),
        &account_dir.join(plugins).join("known_marketplaces.json"),
        &[],
        true,
        &before.marketplaces,
        &mut after.marketplaces,
    );
    record(
        result,
        &before.marketplaces,
        &mut after.marketplaces,
        &mut changed,
        &mut errors,
    );
    let result = sync_links(&default.dir, account_dir, &before.links, &mut after.links);
    record(
        result,
        &before.links,
        &mut after.links,
        &mut changed,
        &mut errors,
    );
    let result = sync_settings(
        &default.dir.join("settings.json"),
        &account_dir.join("settings.json"),
        &before.settings,
        &mut after.settings,
    );
    record(
        result,
        &before.settings,
        &mut after.settings,
        &mut changed,
        &mut errors,
    );

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

fn record<T: Clone + PartialEq>(
    result: Result<bool, String>,
    before: &[T],
    after: &mut Vec<T>,
    changed: &mut bool,
    errors: &mut Vec<String>,
) {
    match result {
        Ok(step_changed) => *changed |= step_changed,
        Err(error) => {
            keep_tracked(before, after);
            errors.push(error);
        }
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

/// The lock Claude Code (proper-lockfile) takes around `.claude.json` writes:
/// a `$CLAUDE_CONFIG_DIR/.claude.json.lock` folder, stale once its mtime is
/// old. The CLI names it without resolving symlinks, so neither do we.
/// Holding it keeps a running CLI from writing between our read and rename.
struct ConfigLock(PathBuf);

impl ConfigLock {
    fn acquire(file: &Path) -> Result<Self, String> {
        let mut name = file.as_os_str().to_owned();
        name.push(".lock");
        let lock = PathBuf::from(name);
        if let Some(parent) = lock.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
        }
        let deadline = Instant::now() + CONFIG_LOCK_WAIT;
        loop {
            match std::fs::create_dir(&lock) {
                Ok(()) => return Ok(Self(lock)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    if Instant::now() >= deadline {
                        return Err(format!("{} is locked by a running Claude", file.display()));
                    }
                    let stale = std::fs::metadata(&lock)
                        .and_then(|meta| meta.modified())
                        .ok()
                        .and_then(|modified| modified.elapsed().ok())
                        .is_some_and(|age| age > CONFIG_LOCK_STALE);
                    if stale {
                        let _ = std::fs::remove_dir(&lock);
                    } else {
                        std::thread::sleep(Duration::from_millis(50));
                    }
                }
                Err(error) => {
                    return Err(format!("Could not lock {}: {error}", file.display()));
                }
            }
        }
    }
}

impl Drop for ConfigLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir(&self.0);
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

    let existing = read_target(target)?;
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
    let changed = merged != current || (created && !entries.is_empty());
    if changed {
        set_map_at(&mut target_root, path, merged)
            .ok_or_else(|| format!("{} is not a JSON object", target.display()))?;
        write_json_atomic(target, &target_root)?;
    }
    copied.extend(entries.keys().cloned());
    Ok(changed)
}

/// Project-scoped servers (`projects.<path>.mcpServers`), tracked as
/// `[project, server]`. A project the account never opened gets Claude's
/// default project entry, so the CLI finds every field it expects there.
fn sync_project_mcp_servers(
    source: &Path,
    target: &Path,
    before: &[Vec<String>],
    copied: &mut Vec<Vec<String>>,
) -> Result<bool, String> {
    let Some(source_root) = read_json(source)? else {
        copied.extend(before.iter().cloned());
        return Ok(false);
    };
    let wanted: Vec<(String, Map<String, Value>)> = source_root
        .get("projects")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(project, entry)| {
            let servers = entry.get("mcpServers")?.as_object()?;
            (!servers.is_empty()).then(|| (project.clone(), servers.clone()))
        })
        .collect();
    let names: Vec<Vec<String>> = wanted
        .iter()
        .flat_map(|(project, servers)| {
            servers
                .keys()
                .map(move |name| vec![project.clone(), name.clone()])
        })
        .collect();
    let stale: Vec<&Vec<String>> = before.iter().filter(|pair| !names.contains(pair)).collect();
    if wanted.is_empty() && stale.is_empty() {
        return Ok(false);
    }

    let mut target_root = read_target(target)?.unwrap_or_else(|| Value::Object(Map::new()));
    let original = target_root.clone();
    let not_object = || format!("{} is not a JSON object", target.display());
    let root = target_root.as_object_mut().ok_or_else(not_object)?;
    if let Some(projects) = root.get_mut("projects").and_then(Value::as_object_mut) {
        for pair in stale {
            if let [project, name] = pair.as_slice() {
                if let Some(servers) = projects
                    .get_mut(project)
                    .and_then(|entry| entry.get_mut("mcpServers"))
                    .and_then(Value::as_object_mut)
                {
                    servers.remove(name);
                }
            }
        }
    }
    if !wanted.is_empty() {
        let projects = root
            .entry("projects")
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()
            .ok_or_else(not_object)?;
        for (project, servers) in wanted {
            let Some(entry) = projects
                .entry(project)
                .or_insert_with(default_project_entry)
                .as_object_mut()
            else {
                continue;
            };
            let current = entry
                .entry("mcpServers")
                .or_insert_with(|| Value::Object(Map::new()));
            if !current.is_object() {
                *current = Value::Object(Map::new());
            }
            if let Some(current) = current.as_object_mut() {
                current.extend(servers);
            }
        }
    }

    let changed = target_root != original;
    if changed {
        write_json_atomic(target, &target_root)?;
    }
    copied.extend(names);
    Ok(changed)
}

/// Claude Code's own defaults for a project it has not seen before.
fn default_project_entry() -> Value {
    serde_json::json!({
        "allowedTools": [],
        "mcpContextUris": [],
        "mcpServers": {},
        "enabledMcpjsonServers": [],
        "disabledMcpjsonServers": [],
        "hasTrustDialogAccepted": false,
        "hasClaudeMdExternalIncludesApproved": false,
        "hasClaudeMdExternalIncludesWarningShown": false
    })
}

fn is_account_env(name: &str) -> bool {
    ACCOUNT_ENV.contains(&name)
        || ACCOUNT_ENV_PREFIXES
            .iter()
            .any(|prefix| name.starts_with(prefix))
}

/// `settings.json`, key by key. For a key whose value is an object in both
/// files (hooks, permissions, enabledPlugins, env, ...), entry by entry, so
/// the account keeps what it set on its own; for a list entry in both
/// (permission rules, hooks per event), item by item. Tracked as `[key]`,
/// `[key, entry]` or `[key, entry, item as JSON]`.
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
    let entry_in = |map: &Map<String, Value>, key: &str, entry: &str| {
        map.get(key)
            .and_then(Value::as_object)
            .and_then(|entries| entries.get(entry))
            .cloned()
    };

    // Drop what an earlier sync copied and the default profile no longer has.
    for path in before {
        match path.as_slice() {
            [key] => {
                if !source_map.contains_key(key) {
                    target_map.remove(key);
                }
            }
            [key, entry] => {
                if entry_in(source_map, key, entry).is_none() {
                    remove_setting_entry(target_map, source_map, key, entry);
                }
            }
            [key, entry, item] => {
                let still_there = entry_in(source_map, key, entry)
                    .as_ref()
                    .and_then(Value::as_array)
                    .is_some_and(|items| items.iter().any(|value| item_id(value) == *item));
                if still_there {
                    continue;
                }
                let emptied = match target_map
                    .get_mut(key)
                    .and_then(Value::as_object_mut)
                    .and_then(|entries| entries.get_mut(entry))
                    .and_then(Value::as_array_mut)
                {
                    Some(items) => {
                        items.retain(|value| item_id(value) != *item);
                        items.is_empty()
                    }
                    None => false,
                };
                // A list the sync emptied and the default no longer has.
                if emptied && entry_in(source_map, key, entry).is_none() {
                    remove_setting_entry(target_map, source_map, key, entry);
                }
            }
            _ => {}
        }
    }

    let mut tracked = Vec::new();
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
                            .filter(|(name, _)| !is_account_env(name))
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
                    match (entry_value.as_array(), current.get_mut(entry)) {
                        (Some(items), Some(Value::Array(existing))) => {
                            for item in items {
                                if !existing.contains(item) {
                                    existing.push(item.clone());
                                }
                            }
                        }
                        _ => {
                            current.insert(entry.clone(), entry_value.clone());
                        }
                    }
                    track_setting_entry(key, entry, entry_value, &mut tracked);
                }
            }
            (Some(entries), _) => {
                target_map.insert(key.clone(), value.clone());
                for (entry, entry_value) in entries {
                    track_setting_entry(key, entry, entry_value, &mut tracked);
                }
            }
            (None, _) => {
                target_map.insert(key.clone(), value.clone());
                tracked.push(vec![key.clone()]);
            }
        }
    }

    let changed = *target_map != original;
    if changed {
        write_json_atomic(target, &target_root)?;
    }
    copied.extend(tracked);
    Ok(changed)
}

fn remove_setting_entry(
    target: &mut Map<String, Value>,
    source: &Map<String, Value>,
    key: &str,
    entry: &str,
) {
    if let Some(map) = target.get_mut(key).and_then(Value::as_object_mut) {
        map.remove(entry);
        // An object the sync emptied and the default no longer has.
        if map.is_empty() && !source.contains_key(key) {
            target.remove(key);
        }
    }
}

fn track_setting_entry(key: &str, entry: &str, value: &Value, tracked: &mut Vec<Vec<String>>) {
    match value.as_array() {
        Some(items) => tracked.extend(
            items
                .iter()
                .map(|item| vec![key.to_string(), entry.to_string(), item_id(item)]),
        ),
        None => tracked.push(vec![key.to_string(), entry.to_string()]),
    }
}

/// A list item's identity for tracking. Object keys serialize sorted, so the
/// same item always gives the same string.
fn item_id(item: &Value) -> String {
    serde_json::to_string(item).unwrap_or_default()
}

/// Symlink the default profile's instructions, keybindings, skills, agents,
/// commands, output styles and rules into the account. A real file or folder
/// the account has under the same name is left alone.
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

    // A folder of the account (skills/ etc.) that resolves into the default
    // profile or anywhere outside the account: links there are the user's
    // own, never ours to touch.
    let real = |path: &Path| path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let default_real = real(default_dir);
    let account_real = real(account_dir);
    let foreign = |link: &Path| {
        link.parent()
            .and_then(|parent| parent.canonicalize().ok())
            .is_some_and(|parent| {
                parent.starts_with(&default_real) || !parent.starts_with(&account_real)
            })
    };

    let mut changed = false;
    for name in before {
        if wanted.contains(name) {
            continue;
        }
        let link = account_dir.join(name);
        if foreign(&link) {
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
        if foreign(&link) {
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

fn is_within(path: &Path, root: &Path) -> bool {
    let path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    path.starts_with(root)
}

fn same_path(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

/// An account file to update. Unlike a default-profile file, an empty one is
/// not treated as missing: replacing it would drop whatever Claude can still
/// restore from its backups (the login, for `.claude.json`).
fn read_target(path: &Path) -> Result<Option<Value>, String> {
    match std::fs::metadata(path) {
        Ok(meta) if meta.len() == 0 => Err(format!(
            "{} is empty; leaving it for Claude to restore",
            path.display()
        )),
        _ => read_json(path),
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

/// Env vars that make an account talk to an API endpoint with a token
/// instead of a claude.ai sign-in.
const ENDPOINT_TOKEN_ENV: &[&str] = &["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"];
const ENDPOINT_URL_ENV: &str = "ANTHROPIC_BASE_URL";

/// An account that reaches Claude with an API token. The token itself never
/// leaves the host process.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeEndpoint {
    /// `None` for Anthropic's own API.
    pub base_url: Option<String>,
}

impl ClaudeEndpoint {
    /// The base URL's host, or "Anthropic API" without one.
    pub(crate) fn host(&self) -> String {
        match &self.base_url {
            Some(url) => url::Url::parse(url)
                .ok()
                .and_then(|parsed| parsed.host_str().map(str::to_string))
                .unwrap_or_else(|| url.clone()),
            None => "Anthropic API".to_string(),
        }
    }
}

fn account_env(settings: &Value) -> Option<&Map<String, Value>> {
    settings.get("env")?.as_object()
}

fn env_str<'a>(env: &'a Map<String, Value>, name: &str) -> Option<&'a str> {
    env.get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn endpoint_token(env: &Map<String, Value>) -> Option<&str> {
    ENDPOINT_TOKEN_ENV.iter().find_map(|name| env_str(env, name))
}

/// The endpoint an account uses, or `None` for a claude.ai sign-in.
pub(crate) fn claude_account_endpoint(account_dir: &Path) -> Option<ClaudeEndpoint> {
    let settings = read_json(&account_dir.join("settings.json")).ok().flatten()?;
    let env = account_env(&settings)?;
    endpoint_token(env)?;
    Some(ClaudeEndpoint {
        base_url: env_str(env, ENDPOINT_URL_ENV).map(str::to_string),
    })
}

/// Edit the `env` of an account's `settings.json`, keeping everything else.
fn edit_account_env(
    account_dir: &Path,
    edit: impl FnOnce(&mut Map<String, Value>) -> Result<(), String>,
) -> Result<(), String> {
    let path = account_dir.join("settings.json");
    let mut root = read_json(&path)?.unwrap_or_else(|| Value::Object(Map::new()));
    let Some(map) = root.as_object_mut() else {
        return Err(format!("{} is not a JSON object", path.display()));
    };
    let env = map
        .entry("env")
        .or_insert_with(|| Value::Object(Map::new()));
    if !env.is_object() {
        *env = Value::Object(Map::new());
    }
    edit(env.as_object_mut().expect("env is an object"))?;
    if map.get("env").and_then(Value::as_object).is_some_and(Map::is_empty) {
        map.remove("env");
    }
    write_json_atomic(&path, &root)
}

/// Point an account at `base_url` (empty for Anthropic's own API) with
/// `token`; an empty `token` keeps the one it has. The sync never copies
/// these vars, so the account keeps them.
pub(crate) fn set_claude_account_endpoint(
    account_dir: &Path,
    base_url: &str,
    token: &str,
) -> Result<(), String> {
    let base_url = base_url.trim().trim_end_matches('/');
    if !base_url.is_empty() {
        let parsed =
            url::Url::parse(base_url).map_err(|_| format!("{base_url} is not a valid URL"))?;
        if parsed.scheme() != "https" && parsed.scheme() != "http" {
            return Err(format!("{base_url} is not an http(s) URL"));
        }
    }
    edit_account_env(account_dir, |env| {
        let token = match token.trim() {
            "" => endpoint_token(env)
                .map(str::to_string)
                .ok_or("An API token is required")?,
            token => token.to_string(),
        };
        for name in ENDPOINT_TOKEN_ENV {
            env.remove(*name);
        }
        // Anthropic's API takes a key as `x-api-key`; gateways take a bearer token.
        if base_url.is_empty() {
            env.remove(ENDPOINT_URL_ENV);
            env.insert("ANTHROPIC_API_KEY".into(), Value::String(token));
        } else {
            env.insert(ENDPOINT_URL_ENV.into(), Value::String(base_url.into()));
            env.insert("ANTHROPIC_AUTH_TOKEN".into(), Value::String(token));
        }
        Ok(())
    })
}

/// Take an account off its API endpoint, back to a claude.ai sign-in.
pub(crate) fn clear_claude_account_endpoint(account_dir: &Path) -> Result<(), String> {
    edit_account_env(account_dir, |env| {
        for name in ENDPOINT_TOKEN_ENV.iter().chain([&ENDPOINT_URL_ENV]) {
            env.remove(*name);
        }
        Ok(())
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
    fn an_endpoint_account_keeps_its_token_and_reports_its_host() {
        let (default, account) = profile();
        write(&account.join("settings.json"), json!({ "model": "opus" }));
        assert_eq!(claude_account_endpoint(&account), None);
        set_claude_account_endpoint(&account, " https://gw.example.dev/ ", " tok ").unwrap();
        write(
            &default.dir.join("settings.json"),
            json!({ "env": { "ANTHROPIC_AUTH_TOKEN": "default", "FOO": "1" } }),
        );
        sync_claude_account(&default, &account).unwrap();
        assert_eq!(
            read(&account.join("settings.json")),
            json!({
                "model": "opus",
                "env": {
                    "ANTHROPIC_BASE_URL": "https://gw.example.dev",
                    "ANTHROPIC_AUTH_TOKEN": "tok",
                    "FOO": "1"
                }
            })
        );
        let endpoint = claude_account_endpoint(&account).unwrap();
        assert_eq!(endpoint.base_url.as_deref(), Some("https://gw.example.dev"));
        assert_eq!(endpoint.host(), "gw.example.dev");
    }

    #[test]
    fn an_endpoint_edit_without_a_token_keeps_the_current_one() {
        let (_default, account) = profile();
        set_claude_account_endpoint(&account, "https://gw.example.dev", "tok").unwrap();
        set_claude_account_endpoint(&account, "", "").unwrap();
        assert_eq!(
            read(&account.join("settings.json")),
            json!({ "env": { "ANTHROPIC_API_KEY": "tok" } })
        );
        assert_eq!(claude_account_endpoint(&account).unwrap().host(), "Anthropic API");

        set_claude_account_endpoint(&account, "https://other.dev", "").unwrap();
        assert_eq!(
            read(&account.join("settings.json")),
            json!({ "env": { "ANTHROPIC_BASE_URL": "https://other.dev", "ANTHROPIC_AUTH_TOKEN": "tok" } })
        );
    }

    #[test]
    fn clearing_an_endpoint_keeps_the_other_settings() {
        let (_default, account) = profile();
        write(
            &account.join("settings.json"),
            json!({ "model": "opus", "env": { "FOO": "1" } }),
        );
        set_claude_account_endpoint(&account, "https://gw.example.dev", "tok").unwrap();
        clear_claude_account_endpoint(&account).unwrap();
        assert_eq!(
            read(&account.join("settings.json")),
            json!({ "model": "opus", "env": { "FOO": "1" } })
        );
        assert_eq!(claude_account_endpoint(&account), None);
    }

    #[test]
    fn an_endpoint_needs_a_token_and_an_http_url() {
        let (_default, account) = profile();
        assert!(set_claude_account_endpoint(&account, "https://gw.example.dev", " ").is_err());
        assert!(set_claude_account_endpoint(&account, "ftp://gw.example.dev", "tok").is_err());
        assert!(set_claude_account_endpoint(&account, "not a url", "tok").is_err());
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

    #[test]
    fn copies_project_servers_into_new_and_existing_projects() {
        let (default, account) = profile();
        write(
            &default.config_file,
            json!({ "projects": {
                "/a": { "hasTrustDialogAccepted": true, "mcpServers": { "deploy": { "url": "d" } } },
                "/b": { "mcpServers": { "db": { "command": "pg" } } },
                "/c": { "mcpServers": {} }
            } }),
        );
        write(
            &account.join(CONFIG_FILE),
            json!({ "projects": { "/b": {
                "hasTrustDialogAccepted": true,
                "mcpServers": { "own": { "url": "o" } }
            } } }),
        );

        assert!(sync_claude_account(&default, &account).unwrap());
        let projects = read(&account.join(CONFIG_FILE))["projects"].clone();
        // A new project gets Claude's defaults, not the default profile's trust.
        assert_eq!(
            projects["/a"]["mcpServers"],
            json!({ "deploy": { "url": "d" } })
        );
        assert_eq!(projects["/a"]["hasTrustDialogAccepted"], false);
        assert_eq!(projects["/a"]["allowedTools"], json!([]));
        assert_eq!(projects["/b"]["hasTrustDialogAccepted"], true);
        assert_eq!(
            projects["/b"]["mcpServers"],
            json!({ "own": { "url": "o" }, "db": { "command": "pg" } })
        );
        assert!(projects.get("/c").is_none());
        assert!(!sync_claude_account(&default, &account).unwrap());

        // Dropped from the default profile: only the copied server goes.
        write(&default.config_file, json!({ "projects": {} }));
        assert!(sync_claude_account(&default, &account).unwrap());
        let projects = read(&account.join(CONFIG_FILE))["projects"].clone();
        assert_eq!(projects["/a"]["mcpServers"], json!({}));
        assert_eq!(
            projects["/b"]["mcpServers"],
            json!({ "own": { "url": "o" } })
        );
        assert!(!sync_claude_account(&default, &account).unwrap());
    }

    #[test]
    fn project_servers_leave_the_login_and_top_level_servers_alone() {
        let (default, account) = profile();
        write(
            &default.config_file,
            json!({
                "oauthAccount": { "email": "default@x" },
                "mcpServers": { "notes": { "url": "n" } },
                "projects": { "/p": { "mcpServers": { "x": { "url": "x" } } } }
            }),
        );
        write(
            &account.join(CONFIG_FILE),
            json!({ "oauthAccount": { "email": "sub@x" }, "numStartups": 3 }),
        );
        sync_claude_account(&default, &account).unwrap();
        let config = read(&account.join(CONFIG_FILE));
        assert_eq!(config["oauthAccount"]["email"], "sub@x");
        assert_eq!(config["numStartups"], 3);
        assert_eq!(config["mcpServers"]["notes"]["url"], "n");
        assert_eq!(config["projects"]["/p"]["mcpServers"]["x"]["url"], "x");
    }

    #[test]
    fn default_profile_follows_an_inherited_config_dir_outside_the_accounts() {
        let home = temp_dir("locate-home");
        let accounts = temp_dir("locate-accounts");
        let custom = temp_dir("locate-custom");

        let found = DefaultProfile::resolve(None, Some(home.clone()), &accounts).unwrap();
        assert_eq!(found.dir, home.join(".claude"));
        assert_eq!(found.config_file, home.join(CONFIG_FILE));

        let found =
            DefaultProfile::resolve(Some(custom.clone()), Some(home.clone()), &accounts).unwrap();
        assert_eq!(found.dir, custom);
        assert_eq!(found.config_file, custom.join(CONFIG_FILE));

        // MonoCode started from an account's own session.
        let account = accounts.join("claude/account-1");
        std::fs::create_dir_all(&account).unwrap();
        let found = DefaultProfile::resolve(Some(account), Some(home.clone()), &accounts).unwrap();
        assert_eq!(found.dir, home.join(".claude"));

        let found =
            DefaultProfile::resolve(Some(PathBuf::new()), Some(home.clone()), &accounts).unwrap();
        assert_eq!(found.dir, home.join(".claude"));
    }

    #[cfg(unix)]
    #[test]
    fn links_rules_and_output_styles() {
        let (default, account) = profile();
        std::fs::create_dir_all(default.dir.join("rules")).unwrap();
        std::fs::write(default.dir.join("rules/style.md"), "r").unwrap();
        std::fs::create_dir_all(default.dir.join("output-styles")).unwrap();
        std::fs::write(default.dir.join("output-styles/terse.md"), "t").unwrap();
        sync_claude_account(&default, &account).unwrap();
        assert_eq!(
            std::fs::read_to_string(account.join("rules/style.md")).unwrap(),
            "r"
        );
        assert_eq!(
            std::fs::read_to_string(account.join("output-styles/terse.md")).unwrap(),
            "t"
        );
    }

    #[test]
    fn the_default_profile_itself_is_never_synced() {
        let (default, _) = profile();
        write(&default.config_file, json!({ "mcpServers": { "x": {} } }));
        assert!(!sync_claude_account(&default, &default.dir).unwrap());
        assert!(!default.dir.join(SYNCED_FILE).exists());
    }

    #[test]
    fn permission_rules_and_hooks_merge_item_by_item() {
        let (default, account) = profile();
        let settings = default.dir.join("settings.json");
        let hook = json!({ "matcher": "Bash", "hooks": [{ "type": "command", "command": "a" }] });
        let own_hook =
            json!({ "matcher": "Edit", "hooks": [{ "type": "command", "command": "b" }] });
        write(
            &settings,
            json!({
                "permissions": { "allow": ["Bash(git:*)"], "defaultMode": "auto" },
                "hooks": { "PreToolUse": [hook.clone()] }
            }),
        );
        write(
            &account.join("settings.json"),
            json!({
                "permissions": { "allow": ["Bash(npm:*)", "Bash(git:*)"], "deny": ["Read(.env)"] },
                "hooks": { "PreToolUse": [own_hook.clone()] }
            }),
        );
        assert!(sync_claude_account(&default, &account).unwrap());
        assert_eq!(
            read(&account.join("settings.json")),
            json!({
                "permissions": {
                    "allow": ["Bash(npm:*)", "Bash(git:*)"],
                    "deny": ["Read(.env)"],
                    "defaultMode": "auto"
                },
                "hooks": { "PreToolUse": [own_hook.clone(), hook.clone()] }
            })
        );
        assert!(!sync_claude_account(&default, &account).unwrap());

        // A rule or hook the default drops goes; the account's own stay.
        write(
            &settings,
            json!({ "permissions": { "allow": ["Bash(ls)"] }, "hooks": {} }),
        );
        assert!(sync_claude_account(&default, &account).unwrap());
        assert_eq!(
            read(&account.join("settings.json")),
            json!({
                "permissions": { "allow": ["Bash(npm:*)", "Bash(ls)"], "deny": ["Read(.env)"] },
                "hooks": { "PreToolUse": [own_hook] }
            })
        );

        // A list the sync created and the default drops goes entirely.
        write(
            &settings,
            json!({ "permissions": { "ask": ["Bash(rm:*)"] } }),
        );
        sync_claude_account(&default, &account).unwrap();
        write(&settings, json!({ "permissions": {} }));
        sync_claude_account(&default, &account).unwrap();
        assert!(read(&account.join("settings.json"))["permissions"]
            .get("ask")
            .is_none());
    }

    #[test]
    fn an_empty_account_config_is_left_for_claude_to_restore() {
        let (default, account) = profile();
        write(&default.config_file, json!({ "mcpServers": { "x": {} } }));
        std::fs::write(account.join(CONFIG_FILE), "").unwrap();
        assert!(sync_claude_account(&default, &account).is_err());
        assert_eq!(
            std::fs::read_to_string(account.join(CONFIG_FILE)).unwrap(),
            ""
        );
    }

    fn lock_dir(account: &Path) -> PathBuf {
        account.join(format!("{CONFIG_FILE}.lock"))
    }

    #[test]
    fn waits_out_a_running_claudes_config_lock() {
        let (default, account) = profile();
        write(&default.config_file, json!({ "mcpServers": { "x": {} } }));
        write(&account.join(CONFIG_FILE), json!({ "numStartups": 1 }));
        let lock = lock_dir(&account);
        std::fs::create_dir(&lock).unwrap();

        // Held throughout: the config is left alone, the rest still syncs.
        write(
            &default.dir.join("settings.json"),
            json!({ "model": "opus" }),
        );
        let error = sync_claude_account(&default, &account).unwrap_err();
        assert!(error.contains("locked"), "{error}");
        assert_eq!(
            read(&account.join(CONFIG_FILE)),
            json!({ "numStartups": 1 })
        );
        assert_eq!(read(&account.join("settings.json"))["model"], "opus");
        assert!(lock.is_dir());

        // Released: the next sync takes and frees it.
        std::fs::remove_dir(&lock).unwrap();
        sync_claude_account(&default, &account).unwrap();
        assert_eq!(
            read(&account.join(CONFIG_FILE))["mcpServers"]["x"],
            json!({})
        );
        assert!(!lock.exists());
    }

    #[test]
    fn breaks_a_stale_config_lock() {
        let (default, account) = profile();
        write(&default.config_file, json!({ "mcpServers": { "x": {} } }));
        write(&account.join(CONFIG_FILE), json!({}));
        let lock = lock_dir(&account);
        std::fs::create_dir(&lock).unwrap();
        let old = std::time::SystemTime::now() - Duration::from_secs(60);
        std::fs::File::open(&lock)
            .unwrap()
            .set_modified(old)
            .unwrap();

        sync_claude_account(&default, &account).unwrap();
        assert_eq!(
            read(&account.join(CONFIG_FILE))["mcpServers"]["x"],
            json!({})
        );
        assert!(!lock.exists());
    }

    #[test]
    fn provider_switches_and_their_keys_stay_per_account() {
        let (default, account) = profile();
        write(
            &default.dir.join("settings.json"),
            json!({
                "gcpAuthRefresh": "gcloud auth",
                "env": {
                    "CLAUDE_CODE_USE_FOUNDRY": "1",
                    "ANTHROPIC_FOUNDRY_API_KEY": "k",
                    "CLAUDE_CODE_CUSTOM_OAUTH_URL": "u",
                    "AWS_BEARER_TOKEN_BEDROCK": "t",
                    "GITHUB_TOKEN": "g"
                }
            }),
        );
        sync_claude_account(&default, &account).unwrap();
        assert_eq!(
            read(&account.join("settings.json")),
            json!({ "env": { "GITHUB_TOKEN": "g" } })
        );
    }

    #[cfg(unix)]
    #[test]
    fn never_touches_a_shared_folder_the_account_links_to() {
        let (default, account) = profile();
        let shared = temp_dir("shared-skills");
        std::fs::create_dir_all(default.dir.join("skills/commit")).unwrap();
        std::os::unix::fs::symlink(&shared, account.join("skills")).unwrap();

        sync_claude_account(&default, &account).unwrap();
        assert_eq!(std::fs::read_dir(&shared).unwrap().count(), 0);
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
