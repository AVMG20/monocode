---
name: update-project
description: Sync this MonoCode fork when the user asks to update the project or sync the fork; fetch both remotes, merge upstream main, resolve conflicts, verify, and push fork main.
---

# Update the MonoCode fork

In this repository, `origin` is the fork (`AVMG20/monocode`) and `upstream` is the original project (`hardbeat920/monocode`). Verify those remote URLs before acting. The user's request to update the project authorizes a normal commit and push to `origin/main`. Never push to `upstream`, rebase shared `main`, or force push.

1. Inspect the current branch and working tree. Preserve uncommitted changes; finish and commit work from the current request before syncing. Keep unrelated changes out of the update commit. If the tree cannot safely be made clean, report the obstacle instead of discarding changes.
2. Fetch both repositories: `git fetch origin --prune --tags` and `git fetch upstream --prune --tags`.
3. Switch to local `main`. Merge `origin/main` first, then `upstream/main`, using `git merge --no-edit`. Resolve conflicts by inspecting both sides and keeping intended fork behavior while incorporating upstream changes. Stage resolutions and complete any unfinished merge commit.
4. Review the resulting diff and history. Run `npm run check:web`; run Rust checks when Rust code or Tauri configuration changed and the toolchain is available. Fix merge-caused failures and commit the fixes.
5. Push with `git push origin main`. If the fork advanced, fetch and merge the new `origin/main`, rerun affected checks, and retry the normal push. Verify that local `main` matches `origin/main` and the working tree is clean.
6. On macOS, rebuild and install the app with `npm run install:macos` so `/Applications/MonoCode.app` runs the merged fork, then tell the user to quit MonoCode and reopen it from the Dock.

Report the upstream commit merged, conflicts resolved, checks run, fork commit pushed, and whether the app was reinstalled. If completion is blocked, state exactly what remains.
