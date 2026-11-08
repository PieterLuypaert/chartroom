# Chartroom

An interactive map of a project's code, drawn and explained by the person's own Claude. Claude names the
app's parts and describes every file; the chart shows one level at a time, as cards joined by lines for what
uses what. Claude explains any card and answers questions about a card or a level, lighting the cards it
names. It only reads the code, on the person's own Claude subscription. A **Chartroom** button in the tab bar
opens it.

![Chartroom: the whole app, a part picked with its lines lit and its explanation beside the chart](docs/chart-whole-app.png)

![Chartroom: inside a part, a file picked with its lines lit and its explanation beside the chart](docs/chart-inside-a-part.png)

## What you see

Everything sits on `t.chrome`, with 13px `t.foreground` text and 1px `t.border` rules. Top to bottom:

- **Header, 42px** (16px left, 8px right padding): "Chartroom" in semibold, then the project button (24px
  high, at most 220px wide, 1px `t.border` frame, `t.accent` while the picker is open, 11.5px `t.muted`; a
  pin icon when the project was picked rather than followed, the chart's name, a chevron-down). While a
  chart shows, the **search box** follows (24px high, 220px wide, 6px radius, `t.border` frame, 11.5px
  `t.muted`): a 13px search icon, "Search" and a `/` keycap (16px, 4px radius, 10.5px `t.dim`), with the
  tooltip "Search the chart (/)"; 320px while open. It is the first to give way when the header is short,
  down to its icon.
  Then a spacer, a 13px spinner while the chart is read again, and **↻ Update** (26px, 12px `t.muted`; `t.accent`
  with a 1px accent frame when the code has moved on). In the side panel only, two 26px icon buttons
  follow: **full size** (square) and **close** (x).
- **Trail, 34px** (12px): a back chevron below the top level, then crumbs from the app's name down,
  between 11px `t.dim` chevrons. Earlier crumbs are `t.muted`, at most 120px wide and clickable; the current
  one is medium `t.foreground`. On the right: zoom controls `−` `NN%` `+` (22px, 12px, only with ELK's
  layout) and a 24px details toggle (`t.selected` while the details show; panel-right icon in a wide view,
  panel-left in a narrow one).
- **Strips, when they apply.** During an update: 34px, a `t.working` spinner, "Updating · Describing every
  file: 120 of 300 files" and **Stop**. When the code has moved on: 36px, a 7px `t.accent` dot, "The code
  moved on since this chart: 2 commits, 3 files not committed" and a solid **Update the chart** (`t.solid`,
  `t.solid_foreground` text). Errors: one 12px `t.blocked` line, such as "The last drawing failed: …".
- **Body**: the chart and the details. From 900px wide, the details sit on the right (340px, left border);
  narrower, under the chart (36% of the height, kept between 150px and 300px, top border). Folded, the chart
  gets the whole width. Their edge can be dragged (`detailsSize` in `layout.js`): from 260px to half the
  panel's width beside the chart, from 120px to 60% of its height under it, a size dragged on a bigger panel
  kept within the smaller one. The edge is a 6px strip over the border, with a column or row resize cursor,
  whose 1px line is `t.accent` while pointed at or dragged; a double-click puts the default size back. The
  details follow the pointer, and the chart is laid out again once, when the drag ends. The panel's own
  strip, not Herdr's `h_resizable`, whose handle takes neither a double-click nor the theme's accent.
- **Status bar, 28px** (11.8px `t.dim`, top border): only the keys that work now, joined by "  ·  ", such
  as "↑↓ pick · / search · ↵ inside · ⌫ up · −+ zoom · a ask · e explain · d details on · p project · u update".

**The chart** reads left to right (three bands side by side) when the chart area is at least 860px wide,
top to bottom when narrower. In a wide view a heading sits over the cards and moves and zooms with them
(`headingType`, every size times the zoom): at 100%, the level's kind and card count in 13px `t.muted` ("the
whole app · 7 cards", "service · 12 cards"), the name in 24px semibold, never over 32px, and the summary in
13px `t.muted` on 20px lines (under 700px tall: 19px name, 12px summary on 17px lines, cut at two). Each
band has a label pill in 11px medium `t.dim` on `t.chrome` ("Used by  2", "Parts  6" at the top or
"Inside  6" below it, "Uses  3") over a 1px `t.border` rule.

Card sizes at 100%: left to right, inside 236×78 and outside 184×36; top to bottom, 188×50 and 160×32.
Outside services always take the outside size. **Inside cards**: 9px radius, `t.background` fill, 1px
`t.border` frame, 14px of room on the left and 11px on the right, a 20px `t.raised` tile with a 12px kind
icon in a column of its own, centred down the card beside its words (so it keeps as much room above it as
below), the name in 13px semibold, and a chevron when the card opens. Left to right, two 11.8px `t.muted` lines say what it does; top to bottom, one 11px
`t.dim` line says what it is ("server · 14 files", or a file's folder and "2 endpoints"). A file card left
to right has one line plus a route chip: the method on `t.accent` at alpha `26`, the path in JetBrains
Mono, "+N" for more. **Outside cards** are pills on `t.chrome` with an icon and a 12.5px `t.muted` name.

Kinds, as word / icon from `mods/workspace-chrome`: ui app / monitor; service server / terminal; worker
background jobs / clock; feature feature / folder; library shared code / layers; data data / archive; config
setup / settings; test tests / circle-check; external outside service / server; file file / file-text; misc
other / folder.

The picked card has a `t.selected` fill and a `t.accent` frame; a card an answer names gets `t.accent` at
alpha `1c` and an accent frame. **Lines** are 1.2px `t.dim` at alpha `b0` (`60` while something is picked
or hovered; on a level with more than 18 lines, `4a` and `26`). A hovered card's lines are `t.accent` at
alpha `90`; the picked card's are 1.8px `t.accent`. Corners round at 9px, and each end has a small ring
(radius 3.2 × zoom, at least 2.4). Until the layout arrives: "Laying the chart out…" with a spinner; an
empty level: "Nothing on this level."

**Details.** With no card picked: the level's name, a pill ("6 parts · 4 files"), its summary, and "Pick a
card to see what it uses and what uses it. Double-click one with › to go inside." With a card picked: its
name, a pill with its kind word, **Inside ›** when it opens, and its summary. Then **Explain this** (10px
radius, accent frame at alpha `55` on accent at alpha `10`, a search icon, "Your Claude reads it: what it
does, how it works, what to watch out for", an `e` keycap); once asked, an 8px box with a 6px accent dot,
"Explained by your Claude · Sonnet" (the model it ran on), "N lit on the chart" and the Markdown text. For a file: its path, line count and
routes. Then "Uses  N" and "Used by  N", one 28px row per card: icon, name, what the link carries ("3
links" when nothing is named). Then "Asked  N", at most 8 answer cards (8px radius, `t.background`, accent
frame while lit): the question in medium with the model it was asked on beside it in 11px `t.dim`
("Opus"), then the answer in Markdown, "Your Claude is reading the
code…" with **Stop**, or "No answer: …" in `t.blocked`; a finished answer that names cards adds "3 on the
chart: click to light them". At the foot: "Ask your Claude about <card or level>", a 30px field (accent
frame while typing; placeholder "What does it do? What breaks if it goes?"), the model button and a solid
**Ask** button. The model button is 30px high with an 8px radius and a 1px `t.border` frame (`t.accent`
while open): the model chosen in 12px `t.muted` and a 12px chevron-down. Open, a list hangs over it from its
right edge, 170px wide on `t.background` with a `t.border` frame and an 8px radius: "Ask on" in 11px medium
`t.muted`, then a 28px row per model (Default, Opus 5.5, Opus 5, Opus 4.8, Sonnet 5.5, Sonnet 5, Sonnet 4.6),
`t.selected` under the keys and a
`t.accent` check on the chosen one.

The details' type (`TYPE` in `chart.js`): names 13px; a summary, an explanation, an answer and the field
13px with a 20px line height; a question asked and "Explain this" 13px; what a line carries, the hint, "Your
Claude reads it…" and "Not explained" 12px; the headings ("Uses", "Used by", "Asked") 11px medium in
`t.muted`, and a path, the pill, a method chip, "Explained by your Claude" and "lit on the chart" 11px.
Nothing in the details is under 11px. Herdr has no text size setting for mods: its zoom scales them all.

**Tab bar button** (a 108px block): 26px high, 6px radius, a 14px layers icon and "Chartroom" in 12px;
`t.muted` on `t.chrome`, or `t.foreground` on `t.selected` while the space shows its Chartroom tab.

## How it behaves

- **Opening.** The button or ⌥⌘F opens the space's Chartroom tab full size: it selects the tab when there
  is one, else opens a new "Chartroom" tab on the space's project. Pressed again from that tab, it goes back
  to the tab you came from. ⌥⇧⌘F shows or hides the side panel. In the panel, `f` opens full size on the
  same level and card; × (or `esc` at the top level) closes it and gives the keyboard back to the pane
  that had it.
- **Which project.** It follows the focused pane's folder in the active space. The project button or `p`
  opens a dropdown under the button, over the chart, which stays (the search dropdown's frame: as wide as
  the panel allows up to 440px, at least 260px). Its rows are two lines (40px, 6px radius, `t.selected`
  under the cursor), each with a 14px icon and a 13px accent check on the one charted; the top line is
  12px `t.foreground`, the one under it 11px `t.dim`.
  - **Follow the focused space** first, over "Now: <the focused folder's name>".
  - **The projects** next, between thin `t.border` lines, under the headings "Spaces" (each space's
    project, in the sidebar's order) and "Folders" (those picked by hand), 11px medium `t.dim`. A project
    shows its name, a chip with its machine when not this one, and its chart in 11px words on the right:
    "Checking…", "Charted" (a 6px accent dot), "No chart" or "Not reached" (`t.blocked`, and the second
    line says why instead of the folder). Past seven, they scroll, with a scrollbar (a virtual list: the
    wheel scrolls it, not the chart, and `↑↓` keep the keys' row in view).
  - **Choose a folder…** last (32px; the system folder picker; the last 8 chosen are kept).

  `↑↓` moves, `↵` or a click charts the row, `esc` or `p` closes it, and so does a press outside it,
  which goes no further. A picked
  project shows a pin and stays picked after a restart. The chart lives in `.chartroom/` of the folder or the
  nearest folder above it, short of home.
- **No chart yet.** "No chart of <name> yet", a paragraph on what drawing does, a solid **Draw the chart**
  and **Pick another project**. After a failed drawing the button reads **Try again**, with the reason in
  `t.blocked`. With no folder: "No folder to chart: focus a terminal in a project, or pick one (p)."; while
  looking: "Looking for a chart…".
- **Drawing.** A first drawing shows a centered card, at most 520px wide: "Drawing the chart of <name>", a
  40px accent-tinted layers tile, **Stop**, a percentage with "running 1 min 12 s", a 6px accent bar, and
  four steps: Reading the code (10%), Finding the app's parts (25%, marked Claude), Describing every file
  (55%, marked Claude, "N of M files"), Drawing the chart (10%). Done steps get an accent check; the current
  one a `t.working` spinner on a `t.background` row. Stopped or failed, the view goes back to "no chart yet"
  with the reason. A drawing keeps running after the panel or the app closes.
- **Chart behind the code.** Every 30s while open, git counts the commits past each repo's charted head
  and the uncommitted files changed after `chart.json` was written. Above zero, Update lights up and the
  strip shows. `u` updates, describing only the files that changed.
- **Moving around.** Click a card to pick it: its lines light and fade in; hovering lights a card's lines
  too; arrow keys step through the cards in reading order. A click on the card picked, or on the chart
  around the cards, puts it down: its lines fade back, and the details and answers are the level's again
  (the end of a drag is no click, and a card's click is left to the card). A click around the cards also
  turns the impact off. Double-click or `↵` goes inside a card that
  opens, and the new level fades in. `⌫`, `esc`, the back chevron or a crumb goes up, with the part you came
  from picked. A press that moves 4px drags the chart (the release is no click); it moves freely as long as
  120px stays in view. The wheel or two fingers zoom around the pointer (60% to 160%); with shift or ⌘ they
  pan. `−`/`+` zoom by 1.2×; `0` or a click on the % fits the width (at most 100%, at least 75%, so a wide
  chart then scrolls sideways). On a resize, zoom or fold, cards glide in 220ms and the lines hide until
  they arrive; wheel zoom follows at once.
- **Search.** `/` or a click on the header's search box opens the search. The box becomes its field, where it
  was (`t.accent` frame, 12px, placeholder "Search the chart"), and under it a dropdown drops over the chart,
  which stays: 4px below the box, as wide as the panel allows up to 420px (at least 220px), 8px radius,
  `t.border` frame, `t.background`, a large shadow, 4px inside. It holds at most 20 rows of two lines (40px,
  6px radius, `t.selected` under the cursor), ten before it scrolls, with a scrollbar (a virtual list: the
  wheel scrolls it, not the chart under it, and `↑↓` keep the cursor's row in view): the kind's 14px icon, the
  name in 12px `t.foreground`, an endpoint's route chip, and on the right what it is in 11px `t.dim`
  ("server", "file", "endpoint"); under them, in 11px `t.dim`, where the card sits ("Server › Orders", or the
  app's name at the top). Every word typed must be in a card's name, its path or route, or what it does; names
  that start with the query come first, then names that hold it, then paths and routes, then the rest, parts
  before files, shorter names first. `↑↓` moves, `↵` or a click on a row goes to the card's level with it
  picked, its lines lit and its details shown (an endpoint goes to its file), and `esc` closes. A press
  anywhere else, the chart included, closes it too, as the field loses the keyboard. Before typing: "A part's
  or file's name, a folder or file path, or a route such as GET /orders."; with nothing found: "Nothing on the
  chart matches." `/` is read by the character typed, so on AZERTY it works with shift. It needs no Claude, so
  it works on a remote project too.
- **Impact.** `i`, or **Show impact** in a card's details (24px, 6px radius, a `t.border` frame, `t.accent`
  while on, "Hide impact"), lights what depends on the card picked, any number of steps away:
  - **Affected cards** are tinted in the accent by how many steps they are from the source (alpha `40`, `26`,
    then `14` from three on) and framed in it. A mark filled with the accent holds the steps in bold
    `t.background`: on a card, a 20px square (5px radius) in the place of the icon's tile, so nothing moves
    when the impact is turned on; on a slim card, a 15px circle in the icon's place. Their
    first line under the name says in the accent how much of them is affected ("21 of 32 files affected",
    "affected"). In the card itself, not over its edge, where the lines' rings sit.
  - **The source's cards** are framed 2px in the accent, the mark holding their icon, the line "source".
  - **The lines** from each affected card towards the source are lit in place of the card picked's.
  - **The rest dims** to 35% opacity, the other lines as on a focused level.
  - **The details** of the source say "Working out what depends on it…" until the walk is done, then show
    its **Impact section** in place of "Uses" and "Used by":
    - **Its head:** the title ("Impact of Orders", or "What Orders relies on"), and ✕ to hide it.
    - **Two switches** (24px, 6px radius, the choice on `t.selected`), both kept per copy of the panel:
      **Used by | Uses** walks the other way, and **All steps | Direct only** keeps only what is one step
      away, on the chart and in the section.
    - **The counts:** "14 parts and 52 files depend on it" (or "it relies on"; "Nothing on the chart depends
      on it."), and in 11px `t.dim` "From the imports and requests the scan found."
    - **The groups:** "Directly", "Through one more", "Through 2 more", each with its rows. A row has the
      card's icon and name, its affected files, and what carries it: one step away, the import's names or
      the endpoint (at most three, "+2"); further, "through" the card one step nearer, or that file's name
      where no other card on the level holds it.
    - **Elsewhere:** what is reached with no card on this level, by where it is ("Server › Requests").
    - **Tests:** apart, last, as "Tests  6 files in 2 parts".

    A row picks its card and keeps the source, so a chain can be followed. An Elsewhere row goes to the level
    that holds its part. A row pointed at lights its card on the chart, and shows under it the chain back to
    the source ("Home page → Server client → Tide times → Database client"); a chain longer than six keeps
    its two ends ("… 12 more …").
  - **A card the impact reaches,** when picked, says in a box in the accent's tint "Depends on Database
    client · 2 steps" (turned round, "Database client relies on it"), its chain, and "Back to Database
    client ›". On the chart, its tooltip is its chain.

  The source is kept apart from the card picked: the impact stays as the levels change, inside a part its
  files light one by one, and a card picked by hand becomes the source. `i`, `esc` or a click on the chart
  around the cards turns it off, as do reading the chart again and another project; with no card picked, `i` says in the status bar for 2.5s
  "Pick a card first: i lights what depends on it". The status bar lists `i impact`, or `i impact off`.
- **Explain.** Picking a card shows its kept explanation at once if the card has not changed since, else
  **Explain this**. That button or `e` has Claude explain the card in the background (about 120 words); the
  cards it names light up. Explanations are kept per card until its code or links change: an update that
  leaves a card alone leaves its explanation.
- **Ask.** `a` focuses the field, `↵` or **Ask** sends, `esc` leaves the field. Answers are listed per card
  (a picked card lists only the questions about it, from any level) and per level (with nothing picked,
  only that level's own). Clicking a finished answer lights the cards it names; again turns them off.
  **Stop** ends one still running. The model button or `m` opens the list of models: `↑↓` move, `↵` or a
  click picks, `esc` closes. A question is asked on the model picked (Default: the person's Claude Code
  default, no `--model`), remembered per copy in `localStorage`. "Explain this" always runs on `sonnet` (or
  `$CHARTROOM_DESCRIBE_MODEL`), whatever the list says.
- **Details.** `d` folds them away or back, remembered. Picking a new card with the mouse unfolds them.
  Dragging their edge sizes them, remembered too; folded and back, they keep the size dragged to.
- **Remote project** (a space on another machine): the chart is read there every 15s (no folder watch) and
  the changed check runs there too. Drawing, asking and explaining are off ("Drawing a chart needs the
  project on this computer.", "Asking about a chart needs the project on this computer.").
- The last 8 places shown come back at the level and card they were left on.

## Built from

- **The share folder is the whole repo**: `mods/chartroom/`, `draw/`, `keys.json`, `install.sh`,
  `layout.jq`, `package.json` (dependency `elkjs` 0.9.3) and `bun.lock`.
- `mods/chartroom/mod.json`: `{ "place": "none", "title": "Chartroom", "focusable": true }`.
- `main.js`: the view (header, trail, strips, body, status bar, picker, ask, explain, zoom, pan, keys), in
  three `props` roles. `{button: true}` is the tab bar button: it draws only the button, takes no keys (on
  `"focus"` from `nextCommand()` it runs `pane.go {direction: "down"}`), and is the only copy that acts on
  the command `full` / `chartroom.full`. `{tab: true, project, focus, selected}` is the full-size tab. No
  props is the side panel (block id `chartroom`).
- `model.js` reads `.chartroom/chart.json`, schema `chartroom/chart@1`: `meta` {generatedAt, root, repos
  [{path, head}]}, `project` {name, summary}, `nodes` [{id, parent, label, kind, summary, stats, rev}], `files`
  [{p, n, loc, name, d, rev}], `routes` [{f, m, p, name}], `links` [{a, b, w, labels}]; refs are `n:<id>`,
  `f:<path>`, `r:<index>`. `levelOf(chart, focus)` gives the inside cards (child parts plus the focus's own
  files), the outside cards linked to them (`side` "above" when they only use the level, else "below"), and
  one line per pair and direction with a weight and labels. `draw/build.js`'s `chartText` writes the file in
  ASCII alone (`\uXXXX` for the rest), the other fields on the first line, then each part, file, endpoint and
  link on a line of its own (`"nodes":[`, one per line, `],` …, `]}`): still JSON. `readChart` reads it a line
  at a time, and any other JSON (a chart written before, on one line) in one go. Reading also files each link
  under every part one of its ends is in (`linksUnder`), so a level goes through its own links, not all, and
  by which way it goes (`users`, `used`: each end a file, an endpoint taken to its file, or a node).
  `impactOf(chart, ref, { direction })` walks those backwards ("usedBy") or forwards ("uses") from a file, a
  part (its files and those of the parts inside it) or a node, ring by ring: each file or node reached with
  its fewest `steps`, the end it was reached `from` and the link `via`; links in a circle end, and the source is
  not among those reached. It gathers what it reaches by part (`groups`), as a file shows on any level as its
  part's card except inside that part, so `impactOn(chart, level, impact)` goes through parts, not files: the
  cards with their fewest steps and affected files, the source's cards, the lines towards the source, what has
  no card on the level by part (`elsewhere`), and `counts` (parts at the deepest, and files). On 20,000 files,
  in Herdr's QuickJS: 13 ms for the walk from the most used file, under 1 ms to place it on a level.
  `impactOn` also keeps per card the file nearest the source (`ref`) and what it holds that is reached, and
  takes `steps` to keep only what is that near (Direct only). `impactChain(chart, impact, ref)` names the
  shortest chain back to the source from `from`. `impactSection(chart, level, impact, { directOnly })` gives
  the details' section: title, counts, groups by steps with each row's files, chain and what carries it
  (`labels`, or `names` on older charts) or the card it comes through, `elsewhere` with where each part is,
  and `tests` apart. The panel keeps each placing and section per walk, level and Direct only.
- `layout.js`: `elkLevel` (bands 0/1/2, card sizes per direction) and `fromElk` (zoom, centering, band
  labels); `layOut` is the plain fallback (rows of 132–240 × 52px cards, curved lines with arrowheads).
- `chart.js`: `chartView` (cards; lines as `PathBuilder` paths through `window.paint_path`; port rings;
  bands), `detailsView` (details, explanation, answers, ask bar; `TextView.markdown`, `Input`),
  `searchBox` (the header's box, its field with `SEARCH_KEYS`, and the dropdown), `dropdownFrame` (the
  frame both dropdowns share). `drawing.js`: the first-drawing card, update strip, changed strip,
  `endedWords`. `projects.js`: the picker's rows and dropdown, its projects grouped by `pickerItems` (in
  `model.js`, beside `projectsOf`).
  `models.js`: `MODELS` (Default, then the Opus and Sonnet versions by full name), `isModelName`,
  `modelLabel`; draw/ask.js
  reads it too. `search.js`: `searchIndexOf(chart)` (every part, outside service, file and endpoint with its level and
  lowercased words, made once per chart when the search opens) and `searchChart(index, query)` (the best
  20, kept while looking rather than sorting every match).
- `find.js`: shell snippets run as `exec("sh", ["-c", SNIPPET, name, ...args], { on })`. `FIND_MAP` (chart,
  progress, log tail, whether a drawing runs), `FIND_CHARTS` (which folders have a chart), `START_DRAW` /
  `STOP_DRAW` (`nohup bun draw.js <folder> [--update]`, and kill), `START_ASK` / `STOP_ASK` / `FIND_ASKS` /
  `FIND_EXPLAIN`, and `CHANGED` (commits past the charted heads, uncommitted files newer than the chart).
- From `"herdr"`: `appHome, exec, focused, home, layout, nextCommand, notify, panes, pickFolder, props, run,
  settings, spaces, theme, watchFolder`. Commands: `tab.new {space, name: "Chartroom", mod: "chartroom",
  props}`, `tab.select`, `layout.hide {id: "chartroom"}`, `pane.focus`, `pane.go`.
  `watchFolder(<folder>/.chartroom)` reads again on changes to `chart.json`, `progress.json` or `pid`.
  `localStorage`, one per copy, keeps `pinned`, `picked`, `detailsFolded`, `detailsWidth` and `detailsHeight`.
- Programs: `sh`, `bun`, `git`, `ps`, `kill`, `claude`. The `draw/` pipeline, `bun draw/draw.js <folder>
  [--update]`: **scan** (no Claude; `git ls-files`, imports resolved for JS/TS, Python, Go, PHP, Java,
  Kotlin and Rust, web requests matched to the endpoints that answer them; left out: `node_modules`,
  `vendor`, `dist` and the like, `build`, `out` and the like where git does not know the folder,
  `.min.js`, `.map` and lockfiles, and what is not text. A project's own `.d.ts` files are read: an
  import leads to one only where no code file answers it, so `../types` reaches `types/index.d.ts`, while
  `./thing` with `thing.js` beside `thing.d.ts` reaches `thing.js`), **parts** (one `claude -p` with Read,
  Grep, Glob), **describe** (batches of 40 files, 4 at once, no tools, model `sonnet` or
  `$CHARTROOM_DESCRIBE_MODEL`),
  **build**. It writes `.chartroom/{chart,state,progress}.json`, `pid`, `draw.log` and a `.gitignore` of `*`.
  `claude.js` runs `claude -p --output-format json --no-session-persistence --strict-mcp-config
  --setting-sources "" --tools … --json-schema …`. `ask.js <folder> <id> <json>` writes
  `.chartroom/asks/<id>.json` (or `explains/<hash>.json` for an explanation, model `sonnet`), status asking
  then done, failed or stopped, with the `model` it was asked on, `answer`, up to 8 `cards` and the card's
  `rev`. A question's `model` (in its JSON) must be one `models.js` lists or a full name (`claude-…`), or the
  answer fails saying so. `lay.js '<levels json>'` runs ELK
  (layered, partitioned by band, orthogonal edges, fixed-side ports) and prints `{layouts}`.
- `keys.json`: `"global": { "cmd-alt-f": "chartroom.full", "cmd-alt-shift-f": "layout.toggle:chartroom" }`.
- `install.sh [layout]` needs `jq`, `bun` and `herdr-app`. It symlinks `~/.config/herdr-app/mods/chartroom`
  to the checkout's `mods/chartroom`, runs `bun install --frozen-lockfile`, merges the keys (free keys
  added, keys still on `chartroom.*` or `layout.toggle:chartroom` moved, any other binding left alone, the
  old file kept as a backup), runs `layout.jq` on the shown layout (or the one named), and ends with
  `herdr-app check`. `layout.jq` needs a row root. It appends the panel `{id: "chartroom", hidden: true,
  size: {px: 460}, min: 340, max: 600, content: {mod: "chartroom"}}`, and wraps the `tabs` block in a
  `tabs-row` row (not resizable): the tabs at weight 1, then `{id: "chartroom-button", size: {px: 108},
  window_drag: true, content: {mod: "chartroom", props: {button: true}}}`. Where the Quarterdeck's panel or
  button is there already, each goes just before it.

## Watch out

- **The mod alone does not work.** `script()` finds the checkout with `pwd -P` of
  `<appHome>/mods/chartroom` and runs `<checkout>/draw/*.js` with `bun`, so the mod folder must be a
  symlink into the checkout, as `install.sh` makes it. `draw/ask.js` also imports `model.js` and `find.js`
  from the mod.
- Herdr does not hot-reload a mod through that symlink: restart the app after changing or switching the
  checkout.
- Herdr replaces its own layouts (main, terminals, win98; `layout:<name>` in `installed.json`) on every
  start. `install.sh` refuses them and prints the `layout.clone` command to run first.
- Only the button copy acts on `chartroom.full`: a layout without a `tabs` block gets the panel and no
  button, and ⌥⌘F does nothing there (`f` in the panel still opens full size).
- Icons come from `mods/workspace-chrome/*.svg`: the app draws no asset reached through the symlink.
- Colors come only from `theme()` names, so it follows any theme, light or dark. Accent tints append an
  alpha to `#rrggbb`; an accent that already has an alpha makes those fills solid.
- `on_size_change` sizes are in app-zoomed units: divide by `settings().zoom`.
- Herdr runs mods on QuickJS and interrupts a render that takes longer than about 50 ms ("This view could not
  be re-rendered"), and any script that runs on for some hundreds of milliseconds (a module's top level or
  `init` between 400 and 800 ms). So the work a chart's size drives runs in slices (`model.js`: a generator
  yields once it has run 20 ms, `inSlices` gives Herdr the turn between slices with `cx.timer.after(0)`, and
  bun and the tests run the same steps straight through): reading the chart, each level, the search index.
  A chart read is parsed and indexed in the read's task, and the level it opens on worked out, while the
  chart before stays on screen; then its search index. Measured in QuickJS on a 20,000-file chart (12 MB,
  64,000 links): reading 398 ms in 20 slices, none over 21 ms; the top level 52 ms in 3, a part 16 ms, an
  area 1 ms (33 ms when every level went through every link). On 60,000 files (36 MB, 192,000 links) the
  slices stay at 20 ms. A move to another level (`showLevel`: in, up, the trail, a search result) shows it at
  once when it is worked out, else works it out in slices first, the level shown staying until then. The
  lines' paths and their rings (circles of two arcs) are built once per layout and kept, so a hover or a pick
  only adds the lines it lights. The plain layout, for a level ELK cannot take, is worked out in a task with
  its lines, as ELK's is, never in a render: a level of 800 cards and 2400 lines takes about 25 ms to lay
  out and 15 ms to build.
- `exec` returns at most 8 MiB. A chart up to 7 MiB comes with `FIND_MAP`; a bigger one, in parts of 7 MiB
  (`READ_PART`, through `dd`), and only when its stamp (size and when it was written) changed since the last
  read. A part whose stamp is not the first part's means the chart was written again while it was read: it
  is read again after. `lay.js` gets its levels as an argument, kept under 400 KiB (`MAX_LAY_ARG`), else the
  plain layout. Up to 12 levels one click away are laid out ahead, each under 100 KiB: worked out in slices
  in a task, then laid out by ELK together; a later run, another chart or another level shown stops it.
  `levelOf` keeps each level per chart, so going to one laid out ahead does not work it out again. Without
  `elkjs`, every level gets the plain layout, with a note saying why.
- Polls: the chart is read again every 15s (`READ_MS`) while remote, chartless, drawing or failed; the
  changed check every 30s; answers and explanations every 1.5s while they run. Limits: none on how many code
  files a scan reads or how big they are (a file that is not text is left out); a 15-minute timeout and one
  retry per Claude call; answers: `ask.js` keeps the newest 8 per card and per level, 200 in all, and the
  panel reads 200 and shows 8. On a synthetic 60,000-file project with a stand-in for Claude, the scan and
  the build take about 20 s and 1.1 GB; the scan alone reads 20,000 files with 64,000 links in 2.2 s. A
  file's routes and requests are numbered by halving its line starts, counted once: 5 MB of code reads in
  about 45 ms in every language.
- A drawing runs detached and its `pid` file is the lock. It counts as running only while that pid lives and
  `ps` shows `draw/draw.js`, so a stale pid is never taken for one. The home folder is refused. `bun` must
  be on the PATH the Herdr app runs programs with.
- `localStorage` is per copy: a new tab starts without a pin and charts its `project` prop, while a copy
  pinned before keeps its pin over the prop.
- `herdr-app check` writes `gpui-kit.d.ts` and `jsconfig.json` into the mod folder; keep them out of git.

## Done when

- `bun test` passes, and `herdr-app check ~/.config/herdr-app/mods/chartroom` loads the mod.
- The mod folder is a symlink to the checkout and `keys.json` binds ⌥⌘F and ⌥⇧⌘F; a second `install.sh`
  leaves `keys.json` and the layout as they were.
- The button sits at the right end of the tab bar. A click opens a "Chartroom" tab and lights the button;
  another goes back to the tab before. ⌥⇧⌘F shows the 460px panel; `esc` hides it.
- In a project without a chart, **Draw the chart** shows the four steps with a rising percentage, then
  `.chartroom/chart.json` appears with `"schema":"chartroom/chart@1"` next to a `.gitignore` of `*`.
- The top level shows "Used by", "Parts" and "Uses" bands joined by right-angled lines. Double-clicking a
  card with a chevron goes inside; the trail and `⌫` go back up. Clicking the card picked, or the chart
  around the cards, puts it down and shows the level's details.
- The wheel zooms around the pointer and the % label follows; `0` fits.
- `i` on a card picked lights what depends on it: on the tide tables, picking `db.ts` inside Server and
  pressing `i` frames Server as the source and lights Website (2 steps) and Jobs (2 steps) with the lines
  from them to Server; Mail and the database dim. Inside Website › Pages both pages show 3, the kit 2.
- `e` on a card shows "Explained by your Claude", then the text. Picking another card and coming back shows
  it again without asking, and so does an update that changed a file in another part.
- A question asked with a card picked is listed only on that card; with nothing picked, only that level's
  questions show. Clicking an answer lights its cards.
- After a commit, the "The code moved on since this chart" strip appears within 30s, and **Update the
  chart** starts an update.
- `/`, part of a file's name and `↵` show that file picked on its part's level with its lines lit; a route
  such as `GET /ports` finds the file that answers it.
- The picker lists every space's project under "Spaces", each saying "Charted" or "No chart". Switching
  between a light and a dark theme recolors everything.
