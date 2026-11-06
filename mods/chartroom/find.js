// The shell the panel runs, on whichever machine a project is on: finding a project's chart and
// how its drawing is going, and starting and stopping a drawing. A project's chart is in
// .chartroom/ (drawn here) or floorplan/ (floorplan's), in its folder or the nearest folder above
// it, short of that machine's home.

// up <folder> <test>: the nearest folder from <folder> up, short of home, for which <test> holds.
// nearest <folder>: the folder with a chart, or with a .chartroom of the folder itself or of its
// repository's top, where its first drawing runs: a .chartroom further up without a chart (a
// drawing there that failed) does not take the projects below it over. charted <folder>: the
// folder with a chart. drawing <.chartroom>: whether its pid is a drawer that still runs, so a pid
// left by a drawer that died, and since taken by another program, is not one.
const FUNCTIONS = [
  'up() { f=${1%/}; while [ -n "$f" ] && [ "$f" != "$HOME" ]; do if eval "$2"; then printf "%s" "$f"; return 0; fi; f=${f%/*}; done; return 1; };',
  'charted() { up "$1" \'[ -f "$f/.chartroom/chart.json" ] || [ -f "$f/floorplan/graph.json" ]\'; };',
  'nearest() { start=${1%/}; top=$(git -C "$1" rev-parse --show-toplevel 2>/dev/null); up "$1" \'[ -f "$f/.chartroom/chart.json" ] || [ -f "$f/floorplan/graph.json" ] || { [ -d "$f/.chartroom" ] && { [ "$f" = "$start" ] || [ "$f" = "$top" ]; }; }\'; };',
  'drawing() { p=$(cat "$1/pid" 2>/dev/null) && kill -0 "$p" 2>/dev/null && ps -p "$p" -o command= 2>/dev/null | grep -q "draw/draw.js"; };',
].join(" ");

// sh -c FIND_MAP find <folder>, in lines: the folder, whether a drawing is "running" or "idle", the
// drawing's progress (JSON, or nothing), the end of its log when it is not running (or nothing),
// which chart it is ("chartroom", "floorplan" or "none"), then the chart. Exits 3 when there is no
// folder with either.
export const FIND_MAP = `${FUNCTIONS} d=$(nearest "$1") || exit 3; c="$d/.chartroom"; printf "%s\\n" "$d";
if drawing "$c"; then echo running; else echo idle; fi;
if [ -f "$c/progress.json" ]; then tr -d "\\n" < "$c/progress.json"; fi; printf "\\n";
if ! drawing "$c" && [ -f "$c/draw.log" ]; then tail -n 4 "$c/draw.log" | tr "\\n" " " | cut -c 1-400; fi; printf "\\n";
if [ -f "$c/chart.json" ]; then echo chartroom; exec cat "$c/chart.json"; elif [ -f "$d/floorplan/graph.json" ]; then echo floorplan; exec cat "$d/floorplan/graph.json"; else echo none; fi`;

// sh -c FIND_CHARTS find <folder>...: a line per folder, the folder and a tab, then the folder with
// its chart or nothing.
export const FIND_CHARTS = `${FUNCTIONS} for d in "$@"; do printf "%s\\t%s\\n" "$d" "$(charted "$d")"; done`;

// sh -c START_DRAW draw <folder> <draw.js> [--update]: draws the folder's chart in the background,
// on past the panel and the app, its output in .chartroom/draw.log. It says why it does not start:
// home is no project, bun or the script is missing, or a drawing runs there already.
export const START_DRAW = `${FUNCTIONS} [ "\${1%/}" != "\${HOME%/}" ] || { echo "the home folder is not a project: pick one" >&2; exit 4; };
command -v bun >/dev/null 2>&1 || { echo "bun is not on the PATH the Herdr app runs programs with" >&2; exit 4; };
[ -f "$2" ] || { echo "there is no $2: run install.sh again" >&2; exit 4; };
! drawing "$1/.chartroom" || { echo "a drawing runs here already" >&2; exit 4; };
cd "$1" && mkdir -p .chartroom && (nohup bun "$2" "$1" $3 </dev/null >.chartroom/draw.log 2>&1 &) && echo started`;

// sh -c STOP_DRAW stop <folder>: stops the folder's drawing, which stops the Claude it asked.
export const STOP_DRAW = `${FUNCTIONS} drawing "$1/.chartroom" || { echo "no drawing runs there" >&2; exit 1; }; kill "$(cat "$1/.chartroom/pid")"`;

// FIND_MAP's output: where the chart is, the drawing's state, and the chart's text.
export function mapFrom(stdout) {
  const lines = stdout.split("\n");
  const [folder, state, progressLine, log, kind] = lines;
  let progress = null;
  if (progressLine) {
    try {
      progress = JSON.parse(progressLine);
    } catch (error) {
      console.log(`chartroom: ${folder}/.chartroom/progress.json is not JSON yet: ${error.message}`);
    }
  }
  return { folder, isDrawing: state === "running", progress, log: (log ?? "").trim(), kind: kind || "none", text: lines.slice(5).join("\n") };
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

// sh -c START_ASK ask <folder> <ask.js> <id> <question as JSON>: asks the folder's Claude in the
// background; the answer lands in .chartroom/asks/<id>.json.
export const START_ASK = `command -v bun >/dev/null 2>&1 || { echo "bun is not on the PATH the Herdr app runs programs with" >&2; exit 4; };
[ -f "$2" ] || { echo "there is no $2: run install.sh again" >&2; exit 4; };
cd "$1" && mkdir -p .chartroom/asks && (nohup bun "$2" "$1" "$3" "$4" </dev/null >".chartroom/asks/$3.log" 2>&1 &) && echo started`;

// sh -c FIND_ASKS asks <folder>: the latest answers, newest first, one JSON per line.
export const FIND_ASKS = 'ls -t "$1/.chartroom/asks" 2>/dev/null | grep -E "^[0-9]+\\.json$" | head -n 12 | while IFS= read -r n; do tr -d "\\n" < "$1/.chartroom/asks/$n"; printf "\\n"; done';

// sh -c STOP_ASK stop <pid>: stops a question still being answered, when that pid is one.
export const STOP_ASK = 'ps -p "$1" -o command= 2>/dev/null | grep -q "draw/ask.js" || { echo "that question is answered already" >&2; exit 1; }; kill "$1"';

// FIND_ASKS' lines as answers, a line that is not one (half written) left out.
export function asksFrom(stdout) {
  const asks = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      asks.push(JSON.parse(line));
    } catch (error) {
      console.log(`chartroom: an answer was left out, as it is not JSON yet: ${error.message}`);
    }
  }
  return asks;
}
