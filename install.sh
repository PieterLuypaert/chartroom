#!/bin/sh
# Puts the Chartroom into the Herdr app: links the mod into ~/.config/herdr-app/mods, binds
# cmd-alt-f in keys.json, and adds the panel and the tab bar's button to a layout of your own.
# Herdr replaces its own layouts (main, terminals, win98) on every start, so for one of those it
# says how to clone it first. Run it again any time, after a pull too: the mod is linked anew (from
# whichever chartroom checkout runs it), keys and layouts already set are left alone, and every
# file it changes is kept beside it first.
#
#   ./install.sh [layout]     the layout to add the panel to; default: the one shown now
set -eu

here=$(cd "$(dirname "$0")" && pwd -P)
app_home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
stamp=$(date +%Y%m%d-%H%M%S)

fail() { echo "install: $*" >&2; exit 1; }

for tool in jq herdr-app; do command -v "$tool" >/dev/null 2>&1 || fail "needs $tool on the PATH"; done
[ -d "$app_home/layouts" ] || fail "no Herdr app at $app_home: open the app once first"

is_chartroom_link() {
  case "$(readlink "$1")" in
    */mods/chartroom) return 0 ;;
    *) return 1 ;;
  esac
}

# The app does not see edits behind the link, so linking again is what makes it load the mod anew
# (after a pull, say). A link to another chartroom checkout points here instead; anything else at
# that place is left alone.
link_mod() {
  src="$here/mods/chartroom" dest="$app_home/mods/chartroom"
  if [ -L "$dest" ] && is_chartroom_link "$dest"; then
    from=$(readlink "$dest")
    rm "$dest" && ln -s "$src" "$dest"
    if [ "$from" = "$src" ]; then echo "mod: linked again, so the app loads it anew"; else echo "mod: linked here instead of $from"; fi
    return
  fi
  if [ -e "$dest" ] || [ -L "$dest" ]; then fail "$dest is there already and is not a chartroom checkout's mod: move it aside first"; fi
  ln -s "$src" "$dest"
  echo "mod: linked $dest"
}

add_key() {
  keys="$app_home/keys.json" ours="$here/keys.json"
  key=$(jq -r '.global | keys[0]' "$ours")
  action=$(jq -r --arg k "$key" '.global[$k]' "$ours")
  [ -f "$keys" ] || echo '{}' >"$keys"
  bound=$(jq -r --arg k "$key" '.global[$k] // empty' "$keys")
  if [ "$bound" = "$action" ]; then echo "key: $key already opens the Chartroom"; return; fi
  if [ -n "$bound" ]; then echo "key: $key does $bound; bind $action to a free key in $keys yourself" >&2; return; fi
  cp "$keys" "$keys.backup-$stamp"
  # Written beside it first, so a failing jq leaves keys.json as it was.
  jq --arg k "$key" --arg a "$action" '.global[$k] = $a' "$keys.backup-$stamp" >"$keys.tmp" || { rm -f "$keys.tmp"; fail "could not add $key to $keys"; }
  mv "$keys.tmp" "$keys"
  echo "key: $key opens the Chartroom (keys.json was kept as keys.json.backup-$stamp)"
}

shown_layout() {
  jq -r '.layout // "main"' "$app_home/shared.json" 2>/dev/null || echo main
}

add_blocks() {
  name=$1 file="$app_home/layouts/$1.json"
  [ -f "$file" ] || fail "there is no layout $file"
  if jq -e --arg n "layout:$name" 'has($n)' "$app_home/installed.json" >/dev/null 2>&1; then
    echo "install: $name is one of Herdr's own layouts, which it replaces on every start. Clone it, then run this again:" >&2
    echo "  herdr-app do layout.clone '{\"name\":\"$name\",\"as\":\"$name-chart\"}' && $0 $name-chart" >&2
    exit 1
  fi
  if jq -e '[.. | objects | select(.id? == "chartroom")] | length > 0' "$file" >/dev/null; then echo "layout: $name has the panel already"; return; fi
  cp "$file" "$file.old-$stamp"
  jq -f "$here/layout.jq" "$file.old-$stamp" >"$file.tmp" || { rm -f "$file.tmp"; fail "could not add the panel to $name"; }
  mv "$file.tmp" "$file"
  jq -e '[.. | objects | select(.id? == "chartroom-button")] | length > 0' "$file" >/dev/null \
    || echo "layout: $name has no tab bar (a block with id \"tabs\"), so it gets the panel without the button" >&2
  echo "layout: added the panel and the button to $name ($name.json was kept as $name.json.old-$stamp)"
}

link_mod
add_key
add_blocks "${1:-$(shown_layout)}"
herdr-app check "$app_home/mods/chartroom"
echo "Chartroom in the tab bar, or its key in keys.json, opens and closes it."
