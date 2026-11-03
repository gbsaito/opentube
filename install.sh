#!/bin/sh
# opentube installer
set -e
BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
fi
mkdir -p "$HOME/Projects" "$HOME/.local/bin"
if [ -d "$HOME/Projects/opentube/.git" ]; then
  # latest version: update an existing checkout and rebuild
  cd "$HOME/Projects/opentube"
  git fetch origin master
  git reset --hard origin/master
else
  git clone https://github.com/gbsaito/opentube.git "$HOME/Projects/opentube"
  cd "$HOME/Projects/opentube"
fi
bun install
ln -sf "$HOME/Projects/opentube/bin/opentube.ts" "$HOME/.local/bin/opentube"
echo "opentube installed. run: opentube"
