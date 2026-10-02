<p align="center">
  <img src="public/monocode.png" alt="MonoCode" width="88" />
</p>

<h1 align="center">MonoCode</h1>

<p align="center">
  <strong>A desktop UI for your coding agents.</strong>
</p>

<p align="center">
  <img width="1680" height="1050" alt="Screenshot 2026-09-04 at 06 34 00" src="https://github.com/user-attachments/assets/2cd4a6ec-eb1e-4b45-8627-a76442ea3874" />
</p>

Each session runs the agent's own terminal app — the same `claude` you get in a terminal, with its questions, subagents, running scripts and look — inside a MonoCode tab. MonoCode is the manager around it: projects, the session sidebar, folders, names, notes, automations, extra terminals, and history you can reopen and resume.

Supported agents: **Claude Code** (primary), **Codex**, **OpenCode** and **Antigravity** (`agy`). Any of them that is installed shows up when you start a session. MonoCode does not sell tokens.

### Sessions

- **Start** a session from the sidebar's **+** (or Cmd/Ctrl+T), pick the agent and, when you have more than one, the account profile (for example *Work* or *Home*), then press **Start**.
- **Profiles** are created under Settings → Providers → Accounts. Each profile is an isolated sign-in (`CLAUDE_CONFIG_DIR` for Claude Code, `CODEX_HOME` for Codex), so work and home never mix.
- **Resume**: Claude Code sessions reopen their own conversation (`claude --resume`) after a restart or after the CLI exits; Codex and OpenCode continue their most recent conversation in that folder.
- **Status**: Claude Code reports working / needs input / done through hooks, so the sidebar, tabs and the working-agents card stay in sync.
- **Extra terminals**: the Terminal button in the footer (and the terminal icon above a session) opens shells below the session.

Git/source control and the file browser are hidden in this build (see `src/app/model/features.ts`).

## Install

> Install and log in to at least one agent CLI first:
>
> - [Claude Code](https://claude.com/product/claude-code) - `claude auth login`
> - [Codex](https://developers.openai.com/codex/cli) - `codex login`
> - [OpenCode](https://opencode.ai) - `opencode auth login`
> - [Antigravity](https://antigravity.google/docs/cli-install) (macOS/Linux) - `curl -fsSL https://antigravity.google/cli/install.sh | bash`, then run `agy` once to sign in

The download links below are the upstream MonoCode builds, which still use the chat UI. To run this version, [build from source](#build-from-source).

macOS (Apple Silicon): download [MonoCode.dmg](https://dl.usemono.dev/MonoCode.dmg), open it, drag MonoCode to Applications.

macOS (Intel): download [MonoCode_x64.dmg](https://dl.usemono.dev/MonoCode_x64.dmg), open it, drag MonoCode to Applications.

Linux (x86_64): download the `.deb` or AppImage from [GitHub Releases](https://github.com/hardbeat920/monocode/releases/latest). Install the `.deb` with `sudo apt install ./MonoCode_*.deb`, or make the AppImage executable with `chmod +x MonoCode_*.AppImage` and run it directly. On Fedora and Enterprise Linux 10, download the `.rpm` from the same release page — see [Fedora / Enterprise Linux packages](#fedora--enterprise-linux-packages) for the one extra repository step Enterprise Linux needs.

Windows (x86_64): download the NSIS installer from [GitHub Releases](https://github.com/hardbeat920/monocode/releases/latest) and run it.

## Some notes

Agent sessions run in a terminal on this computer, so the experimental remote projects ([docs](docs/remote-access.md)) can't host a session in this version.

This is very early and you should expect bugs.

## Build from source

Supports macOS, Linux, and Windows.

Need Node.js 20+ and a current stable Rust toolchain. On Linux, ensure standard Tauri prerequisites are installed (e.g. `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libsoup-3.0-dev`, `libjavascriptcoregtk-4.1-dev`). On Windows, the installer bootstraps the [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) runtime when it is missing.

```bash
npm install
npm run tauri dev
```

### Ubuntu / Debian packages

On an Ubuntu/Debian workstation, the repository can install the native Tauri prerequisites and build distributable Linux packages directly:

```bash
npm run setup:linux:deb
npm ci
npm run build:linux
```

The Linux build emits `.deb` and AppImage bundles under `target/release/bundle/`.
Tauri loads `src-tauri/tauri.linux.conf.json` automatically for Linux development and builds.

### Fedora / Enterprise Linux packages

On Fedora, or on an Enterprise Linux 10 system (registered RHEL, Rocky, Alma, CentOS Stream, Oracle), install the release `.rpm` from [GitHub Releases](https://github.com/hardbeat920/monocode/releases/latest). Enterprise Linux needs EPEL first, because `webkit2gtk4.1` is an EPEL package there — CRB is not needed to run MonoCode. On Oracle Linux 10, `epel-release` does not enable `ol10_developer_EPEL`, which is the repository that provides that package. Enable it before installing the rpm:

```bash
# Enterprise Linux 10 only; skip on Fedora.
sudo dnf install -y epel-release   # RHEL: sudo dnf install -y https://dl.fedoraproject.org/pub/epel/epel-release-latest-10.noarch.rpm
# Oracle Linux 10, instead of epel-release:
# sudo dnf install -y oracle-epel-release-el10 dnf-plugins-core
# sudo dnf config-manager --set-enabled ol10_developer_EPEL
sudo dnf install ./MonoCode-*.rpm
```

The `.rpm` declares its own runtime dependencies, so `dnf` pulls the WebKitGTK stack for you. GitHub Releases builds that package on Enterprise Linux 10 so it loads on Fedora and EL 10. Building natively links the system WebKitGTK instead of the Ubuntu-built libraries shipped in the AppImage, which avoids graphics issues (e.g. `Could not create default EGL display`) on newer Mesa/Wayland systems.

To build it yourself instead — which also enables EPEL 10 and CRB automatically, since the -devel packages need CRB:

```bash
npm run setup:linux:fedora
npm ci
npm run build:fedora
```

That emits a `.rpm` under `target/release/bundle/rpm/`, installable with `sudo dnf install ./target/release/bundle/rpm/MonoCode-*.rpm`. EL 9 and older are unsupported (`webkit2gtk4.1-devel` only exists in EPEL 10).

### Troubleshooting on Fedora / Wayland

The portable AppImage bundles Ubuntu-built Wayland libraries that can fail against newer Mesa drivers: the app aborts at startup with `Could not create default EGL display: EGL_BAD_PARAMETER`, or opens a blank window. The native `.rpm` above links the system WebKitGTK stack and does not have this problem — prefer it on Fedora.

### Windows packages

```bash
npm ci
npm run build:windows
```

The Windows build emits an NSIS installer under `target/release/bundle/nsis/`.
Tauri loads `src-tauri/tauri.windows.conf.json` automatically for Windows development and builds.

## License

[MIT](LICENSE). Provider names and logos are trademarks of their owners - see [NOTICE](NOTICE).
