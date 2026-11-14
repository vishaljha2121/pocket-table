#!/bin/zsh
set -e
project_dir=${0:A:h}
cd "$project_dir"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 26 or newer, then run npm ci in this folder.'
  exit 1
fi
if [[ ! -d node_modules/qrcode ]]; then
  echo 'Run npm ci in this folder before starting Pocket Table.'
  exit 1
fi
if ! /bin/launchctl print "gui/$(id -u)/com.pocket-table.local" >/dev/null 2>&1; then
  node scripts/configure-service.mjs
  /bin/launchctl bootstrap "gui/$(id -u)" "$project_dir/data/service.plist"
fi
/usr/bin/open http://localhost:8787/dealer
