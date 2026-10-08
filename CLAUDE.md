@AGENTS.md

## Building the macOS app

Whenever the app is built, and after every fork sync or merge from upstream, build it with `npm run install:macos`, never with a bare `tauri build`. It builds the bundle, copies it to `/Applications/MonoCode.app`, and unregisters every other copy (`target/` outputs, worktrees, mounted DMGs) from LaunchServices. If a bundle was already built another way, finish with `npm run install:macos -- --skip-build`.

`/Applications/MonoCode.app` must stay the only registered copy: macOS routes notification clicks by bundle identifier, so a second registered copy gets launched as a duplicate MonoCode in the Dock. Never launch the app from `target/release/bundle/`. After installing, tell the user to quit the running MonoCode and reopen it from the Dock so the new build is the one running.
