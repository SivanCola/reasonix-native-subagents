#!/bin/sh
# GUI apps need not inherit a login shell's PATH. Never source shell profiles.
set -eu
config_dir=${REASONIX_SUBAGENT_CONFIG_DIR:-"$HOME/.reasonix/native-subagents"}
case "$config_dir" in /*) ;; *) echo invalid_config_directory >&2; exit 1;; esac
node_override=${REASONIX_SUBAGENT_NODE:-}
if [ -z "$node_override" ] && [ -e "$config_dir/node-path" ]; then
  node_override=$(cat "$config_dir/node-path") || exit 1
  [ -n "$node_override" ] || { echo invalid_node_override >&2; exit 1; }
fi
best_node=
best_major=0
best_minor=0
best_patch=0
probe() {
  [ -x "$1" ] || return 0
  node_version=$("$1" --version 2>/dev/null) || return 0
  node_version=${node_version#v}
  major=${node_version%%.*}
  rest=${node_version#*.}
  minor=${rest%%.*}
  patch=${rest#*.}
  case "$major:$minor:$patch" in *[!0-9:]*|:*|*::*) return 0;; esac
  [ "$major" -ge 20 ] || return 0
  if [ "$major" -gt "$best_major" ] ||
     { [ "$major" -eq "$best_major" ] && [ "$minor" -gt "$best_minor" ]; } ||
     { [ "$major" -eq "$best_major" ] && [ "$minor" -eq "$best_minor" ] && [ "$patch" -gt "$best_patch" ]; }; then
    best_node=$1 best_major=$major best_minor=$minor best_patch=$patch
  fi
}
if [ -n "$node_override" ]; then
  case "$node_override" in /*) ;; *) echo invalid_node_override >&2; exit 1;; esac
  probe "$node_override"
  [ -n "$best_node" ] || { echo node_override_requires_node_20 >&2; exit 1; }
else
  path_node=$(command -v node || true)
  case "$path_node" in /*) probe "$path_node";; esac
  # Respect an already working host Node before probing installed versions.
  if [ -z "$best_node" ]; then
    for candidate in \
      "$HOME/.local/bin/node" /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node \
      "$HOME/.volta/bin/node" "$HOME/.asdf/shims/node" \
      "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node \
      "$HOME"/Library/Application\ Support/fnm/node-versions/*/installation/bin/node \
      "$HOME"/.nvm/versions/node/*/bin/node \
      "$HOME"/.asdf/installs/nodejs/*/bin/node; do
      probe "$candidate"
    done
  fi
  [ -n "$best_node" ] || { echo node_20_not_found_install_node_or_set_node_path >&2; exit 1; }
fi
PATH="${best_node%/*}:${PATH:-/usr/bin:/bin}"
export PATH
exec "$best_node" "${0%/*}/main.mjs" "$@"
