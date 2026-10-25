#!/bin/bash
# Build the navigation benchmark into <checkout>/dist-navbench.
#
#   tests/browser/navbench/build.sh [checkout]
#
# With no argument it builds this checkout. Given another checkout (for
# example a `git worktree` at an older release), it copies the harness
# (tests/browser/nav-bench.{html,tsx} and nav-bench.vite.config.ts) there
# first; the harness only uses APIs that exist back to v0.10.
#
# Then measure with:
#   node tests/browser/navbench/run.cjs <checkout> --runs 3       # Chromium (Playwright)
#   node tests/browser/navbench/wk.cjs  <checkout> --runs 2 --query 'phases&settle=1500'
#                                                                  # WebKitGTK MiniBrowser under Xvfb
#   node tests/browser/navbench/trace.cjs <checkout>               # Chromium style/layout per action
set -e
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
target=$(cd "${1:-$repo}" && pwd)
if [ "$target" != "$repo" ]; then
  cp "$repo/tests/browser/nav-bench.html" "$repo/tests/browser/nav-bench.tsx" "$target/tests/browser/"
  cp "$repo/nav-bench.vite.config.ts" "$target/nav-bench.vite.config.ts"
fi
cd "$target"
npx vite build --config nav-bench.vite.config.ts
