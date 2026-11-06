// The shell the panel runs, on whichever machine a project is on: finding a project's chart and
// how its drawing is going, and starting and stopping a drawing. A project's chart is in
// .chartroom/ (drawn here) or floorplan/ (floorplan's), in its folder or the nearest folder above
// it, short of that machine's home.

// nearest <folder>: the folder with a .chartroom or a floorplan map. charted <folder>: the folder
// with a chart in it.
const FUNCTIONS = [
  'up() { f=${1%/}; while [ -n "$f" ] && [ "$f" != "$HOME" ]; do if eval "$2"; then printf "%s" "$f"; return 0; fi; f=${f%/*}; done; return 1; };',
  'nearest() { up "$1" \'[ -d "$f/.chartroom" ] || [ -f "$f/floorplan/graph.json" ]\'; };',
  'charted() { up "$1" \'[ -f "$f/.chartroom/chart.json" ] || [ -f "$f/floorplan/graph.json" ]\'; };',
].join(" ");

// sh -c FIND_MAP find <folder>, in lines: the folder, whether a drawing is "running" or "idle", the
// drawing's progress (JSON, or nothing), which chart it is ("chartroom", "floorplan" or "none"),
// then the chart. Exits 3 when there is no folder with either.
export const FIND_MAP = `${FUNCTIONS} d=$(nearest "$1") || exit 3; c="$d/.chartroom"; printf "%s\\n" "$d";
if [ -f "$c/pid" ] && kill -0 "$(cat "$c/pid")" 2>/dev/null; then echo running; else echo idle; fi;
if [ -f "$c/progress.json" ]; then tr -d "\\n" < "$c/progress.json"; fi; printf "\\n";
if [ -f "$c/chart.json" ]; then echo chartroom; exec cat "$c/chart.json"; elif [ -f "$d/floorplan/graph.json" ]; then echo floorplan; exec cat "$d/floorplan/graph.json"; else echo none; fi`;

// sh -c FIND_CHARTS find <folder>...: a line per folder, the folder and a tab, then the folder with
// its chart or nothing.
export const FIND_CHARTS = `${FUNCTIONS} for d in "$@"; do printf "%s\\t%s\\n" "$d" "$(charted "$d")"; done`;

// sh -c START_DRAW draw <folder> <draw.js> [--update]: draws the folder's chart in the background,
// on past the panel and the app, its output in .chartroom/draw.log.
export const START_DRAW = 'cd "$1" && mkdir -p .chartroom && (nohup bun "$2" "$1" $3 </dev/null >.chartroom/draw.log 2>&1 &) && echo started';

// sh -c STOP_DRAW stop <folder>: stops the folder's drawing, which stops the Claude it asked.
export const STOP_DRAW = 'p=$(cat "$1/.chartroom/pid" 2>/dev/null) && kill "$p"';

// FIND_MAP's output: where the chart is, the drawing's state, and the chart's text.
export function mapFrom(stdout) {
  const lines = stdout.split("\n");
  const [folder, state, progressLine, kind] = lines;
  let progress = null;
  if (progressLine) {
    try {
      progress = JSON.parse(progressLine);
    } catch (error) {
      console.log(`chartroom: ${folder}/.chartroom/progress.json is not JSON yet: ${error.message}`);
    }
  }
  return { folder, isDrawing: state === "running", progress, kind: kind || "none", text: lines.slice(4).join("\n") };
}

// FIND_CHARTS' lines as a Map from each folder to the folder with its chart, or null.
export function chartedFrom(stdout) {
  const charted = new Map();
  for (const line of stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab > 0) charted.set(line.slice(0, tab), line.slice(tab + 1) || null);
  }
  return charted;
}
