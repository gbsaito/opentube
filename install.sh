#!/bin/sh
# opentube installer
set -e
BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
fi
mkdir -p "$HOME/Projects"
if [ ! -d "$HOME/Projects/opentube/.git" ]; then
  git clone https://github.com/gbsaito/opentube.git "$HOME/Projects/opentube"
fi
mkdir -p "$HOME/.local/bin"
ln -sf "$HOME/Projects/opentube/bin/opentube.ts" "$HOME/.local/bin/opentube"
echo "opentube installed. run: opentube"
