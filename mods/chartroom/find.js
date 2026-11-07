// The shell the panel runs, on whichever machine a project is on: finding a project's chart and
// how its drawing is going, and starting and stopping a drawing. A project's chart is in
// .chartroom/, in its folder or the nearest folder above it, short of that machine's home.

// up <folder> <test>: the nearest folder from <folder> up, short of home, for which <test> holds.
// nearest <folder>: the folder with a chart, or with a .chartroom of the folder itself or of its
// repository's top, where its first drawing runs: a .chartroom further up without a chart (a
// drawing there that failed) does not take the projects below it over. charted <folder>: the
// folder with a chart. drawing <.chartroom>: whether its pid is a drawer that still runs, so a pid
// left by a drawer that died, and since taken by another program, is not one. stamp <file>: its
// size in bytes and when it was last written, as "<bytes>:<seconds>", by GNU's stat or else BSD's.
const FUNCTIONS = [
  'up() { f=${1%/}; while [ -n "$f" ] && [ "$f" != "$HOME" ]; do if eval "$2"; then printf "%s" "$f"; return 0; fi; f=${f%/*}; done; return 1; };',
  'charted() { up "$1" \'[ -f "$f/.chartroom/chart.json" ]\'; };',
  'nearest() { start=${1%/}; top=$(git -C "$1" rev-parse --show-toplevel 2>/dev/null); up "$1" \'[ -f "$f/.chartroom/chart.json" ] || { [ -d "$f/.chartroom" ] && { [ "$f" = "$start" ] || [ "$f" = "$top" ]; }; }\'; };',
  'drawing() { p=$(cat "$1/pid" 2>/dev/null) && kill -0 "$p" 2>/dev/null && ps -p "$p" -o command= 2>/dev/null | grep -q "draw/draw.js"; };',
  'stamp() { stat -c "%s:%Y" "$1" 2>/dev/null || stat -f "%z:%m" "$1"; };',
].join(" ");

// A program run through Herdr hands back at most 8 MiB. A chart up to INLINE_BYTES comes with
// FIND_MAP; a bigger one in parts of PART_MIB MiB, through READ_PART.
const MIB = 1024 * 1024;
const PART_MIB = 7;
export const INLINE_BYTES = PART_MIB * MIB;

// sh -c FIND_MAP find <folder>, in lines: the folder, whether a drawing is "running" or "idle", the
// drawing's progress (JSON, or nothing), the end of its log when it is not running (or nothing),
// whether there is a chart ("chartroom <stamp>" or "none"), then the chart when it is at most
// INLINE_BYTES. Exits 3 when there is no
// folder with either. The log's line drops the newline GNU cut ends with (BSD cut adds none), or on
// Linux every line after it would move down one.
export const FIND_MAP = `${FUNCTIONS} d=$(nearest "$1") || exit 3; c="$d/.chartroom"; printf "%s\\n" "$d";
if drawing "$c"; then echo running; else echo idle; fi;
if [ -f "$c/progress.json" ]; then tr -d "\\n" < "$c/progress.json"; fi; printf "\\n";
if ! drawing "$c" && [ -f "$c/draw.log" ]; then tail -n 4 "$c/draw.log" | tr "\\n" " " | cut -c 1-400 | tr -d "\\n"; fi; printf "\\n";
if [ -f "$c/chart.json" ]; then s=$(stamp "$c/chart.json"); echo "chartroom $s"; [ "\${s%%:*}" -gt ${INLINE_BYTES} ] || exec cat "$c/chart.json"; else echo none; fi`;

// sh -c READ_PART read <folder> <skip> <count>: the chart's stamp on a line, then <count> MiB of
// it from <skip> MiB on.
export const READ_PART = `${FUNCTIONS} f="$1/.chartroom/chart.json"; stamp "$f" && dd if="$f" bs=${MIB} skip="$2" count="$3" 2>/dev/null`;

// A chart too big for FIND_MAP, read a part at a time with `run` (a program and its arguments, to
// its output): the chart of `stamp`, or null when it was written again while it was read. A chart
// that big is written in ASCII alone (draw/build.js), so no part ends inside a character.
export async function chartInParts(run, folder, stamp, size) {
  const parts = [];
  for (let skip = 0; skip * MIB < size; skip += PART_MIB) {
    const out = await run(["sh", "-c", READ_PART, "read", folder, String(skip), String(PART_MIB)]);
    const newline = out.indexOf("\n");
    if (out.slice(0, newline) !== stamp) return null;
    parts.push(out.slice(newline + 1));
  }
  const text = parts.join("");
  return text.length === size ? text : null;
}

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
  const [folder, state, progressLine, log, chartLine] = lines;
  const [kind, stamp = null] = (chartLine || "none").split(" ");
  const size = stamp ? Number(stamp.split(":")[0]) : 0;
  let progress = null;
  if (progressLine) {
    try {
      progress = JSON.parse(progressLine);
    } catch (error) {
      console.log(`chartroom: ${folder}/.chartroom/progress.json is not JSON yet: ${error.message}`);
    }
  }
  return { folder, isDrawing: state === "running", progress, log: (log ?? "").trim(), kind, stamp, size, text: size > INLINE_BYTES ? null : lines.slice(5).join("\n") };
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

// sh -c FIND_ASKS asks <folder>: the latest answers, newest first, one JSON per line: as many as
// draw/ask.js keeps (KEPT), so every card and level has its own after asksFor.
export const FIND_ASKS = 'ls -t "$1/.chartroom/asks" 2>/dev/null | grep -E "^[0-9]+\\.json$" | head -n 200 | while IFS= read -r n; do tr -d "\\n" < "$1/.chartroom/asks/$n"; printf "\\n"; done';

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

// The answers asked about the card picked, on whatever level it was picked; with none picked, those
// asked about the level itself (focus, or null for the app's own level).
export function asksFor(asks, { focus = null, card = null }) {
  if (card) return asks.filter((one) => one.card === card);
  return asks.filter((one) => !one.card && (one.focus ?? null) === focus);
}

// sh -c CHANGED changed <folder> <chart file> [<repo path> <head>]...: how far the code moved on
// since the chart, as "<commits> <files>": the commits past the head each repo was at, and the
// files changed (not committed) after the chart was written. A head git no longer knows (a rebase)
// counts as a commit.
export const CHANGED = `root=$1; chart=$2; shift 2; commits=0; files=0;
while [ $# -ge 2 ]; do d="$root\${1:+/$1}"; h=$2; shift 2;
  n=$(git -C "$d" rev-list --count "$h..HEAD" 2>/dev/null) || n=1;
  f=$(git -C "$d" status --porcelain 2>/dev/null | cut -c4- | while IFS= read -r p; do case "$p" in (.chartroom*) ;; (*) if [ "$d/$p" -nt "$chart" ]; then echo x; fi ;; esac; done | wc -l | tr -d " ");
  commits=$((commits + n)); files=$((files + f)); done; echo "$commits $files"`;

// The file name a card's explanation is kept under (.chartroom/explains/<key>.json): a short hash of
// its id, as an id holds slashes.
export function explainKey(card) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < card.length; i += 1) hash = Math.imul(hash ^ card.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

// sh -c FIND_EXPLAIN explain <folder> <key>: a card's explanation, or nothing.
export const FIND_EXPLAIN = 'cat "$1/.chartroom/explains/$2.json" 2>/dev/null || true';
