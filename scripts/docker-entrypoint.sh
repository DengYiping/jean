#!/bin/sh
set -eu

# The image ships gh in /usr/bin, but Jean can update only a user-writable
# binary. Seed the managed location once while preserving any newer update.
data_dir=${JEAN_DATA_DIR:-"$HOME/.local/share/com.jean.desktop"}
managed_gh="$data_dir/gh-cli/gh"
if [ ! -x "$managed_gh" ]; then
  system_gh=$(command -v gh)
  mkdir -p "$(dirname "$managed_gh")"
  install -m 0755 "$system_gh" "$managed_gh"
fi

if [ -z "${DISPLAY:-}" ]; then
  Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp &
  export DISPLAY=:99
  sleep 0.5
fi

exec jean-server "$@"
