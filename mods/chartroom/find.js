// The shell that finds floorplan's maps, on whichever machine a project is on: a project's map is
// floorplan/graph.json in its folder or the nearest folder above it, short of that machine's home.

// nearest <folder>: prints the folder that holds the map, or fails.
const NEAREST = 'nearest() { f=${1%/}; while [ -n "$f" ] && [ "$f" != "$HOME" ]; do if [ -f "$f/floorplan/graph.json" ]; then printf "%s" "$f"; return 0; fi; f=${f%/*}; done; return 1; };';

// sh -c FIND_MAP find <folder>: the folder that holds the map on one line, then the map; exits 3
// when there is none.
export const FIND_MAP = `${NEAREST} d=$(nearest "$1") || exit 3; printf "%s\\n" "$d"; exec cat "$d/floorplan/graph.json"`;

// sh -c FIND_CHARTS find <folder>...: a line per folder, the folder and a tab, then the folder that
// holds its map or nothing.
export const FIND_CHARTS = `${NEAREST} for d in "$@"; do printf "%s\\t%s\\n" "$d" "$(nearest "$d")"; done`;

// FIND_CHARTS' lines as a Map from each folder to the folder that holds its map, or null.
export function chartedFrom(stdout) {
  const charted = new Map();
  for (const line of stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab > 0) charted.set(line.slice(0, tab), line.slice(tab + 1) || null);
  }
  return charted;
}
