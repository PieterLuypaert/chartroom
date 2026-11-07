// The Chartroom in the Herdr app: a chart of a project's code, one level at a time, as cards with
// the lines between them, in a panel on the right of the window. The project is the focused
// space's, or one picked from every space's project and folders chosen by hand. The panel draws
// the chart itself: it starts draw/draw.js in the background, which reads the code and asks the
// person's own Claude for the app's parts and a description of every file, and shows how far it
// is until the chart is there. With props {button: true} it is the
// tab bar's button, which opens the space's Chartroom full size, in a tab of its own (as ⌥⌘F does,
// through the command chartroom.full), and from that tab goes back; with props {tab: true, project,
// focus, selected} it is that tab. The panel beside the terminals stays a key away (⌥⇧⌘F).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState } from "gpui-base";
import { appHome, exec, focused, home, layout, nextCommand, notify, panes, pickFolder, props, run, settings, spaces, theme, watchFolder } from "herdr";
import { cardIdOn, detailsOf, isExplanationCurrent, levelOf, projectsOf, readChart } from "./model.js";
import { elkLevel, fromElk, layOut } from "./layout.js";
import { chartView, detailsView, minimapView, searchView } from "./chart.js";
import { searchChart, searchIndexOf } from "./search.js";
import { grabOf, hasRoomFor, minimapOf, panAt } from "./minimap.js";
import { asksFor, asksFrom, CHANGED, chartedFrom, explainKey, FIND_ASKS, FIND_EXPLAIN, FIND_CHARTS, FIND_MAP, mapFrom, START_ASK, START_DRAW, STOP_ASK, STOP_DRAW } from "./find.js";
import { pickerRows, projectList } from "./projects.js";
import { changedStrip, endedWords, firstDrawing, stepWords, updateStrip } from "./drawing.js";

// The layout block the panel lives in, and the tab bar's button: install.sh adds both.
const BLOCK = "chartroom";
const BUTTON = "chartroom-button";
const MOD = "chartroom";
const ICONS = "mods/workspace-chrome";
// While shown, how often a chart on another machine (which cannot be watched) is read again, and
// how often the project is looked in again while it has no chart or is being drawn.
const READ_MS = 15000;
// exec hands back at most 8 MiB, so a bigger chart arrives cut short.
const MAX_OUTPUT = 8 * 1024 * 1024;
// Kept in localStorage: the project picked (null: follow the focused space), and the folders
// chosen by hand, the latest first.
const PINNED = "pinned";
const PICKED = "picked";
const MAX_PICKED = 8;
// The files whose change means the chart or the drawing's progress is new.
// The pid goes when a drawing ends, so its end shows at once.
const WATCHED = /\/((chart|graph|progress)\.json|pid)$/;
// The places remembered to come back to, the least recently left forgotten first.
const MAX_VIEWS = 8;
// From this wide on, the details sit to the right of the chart instead of under it.
const WIDE = 900;
const DETAILS_WIDTH = 340;
// How long a new level or a card's lines are drawn see-through before they fade in, and how long
// the lines stay aside while the cards glide to new places (chart.js's GLIDE, and a little more).
const ENTER_MS = 30;
const MOVE_MS = 260;
// Zoom: at most this far out and in, this much a step; fitting the width never goes past 100%, nor
// below what still reads (the chart scrolls sideways then).
const MIN_ZOOM = 0.6;
const MIN_FIT = 0.75;
// From this wide a chart reads left to right, as three bands side by side; narrower, top to bottom.
const ACROSS = 860;
const MAX_ZOOM = 1.6;
const ZOOM_STEP = 1.2;
// draw/lay.js gets its levels as an argument, which the system keeps under a megabyte: a level
// bigger than this is laid out plainly. Levels one click away are laid out ahead, this many at once.
const MAX_LAY_ARG = 400 * 1024;
const MAX_AHEAD = 12;
// While open, how often the code is looked at for changes since the chart.
const CHANGED_MS = 30000;
// A card picked and kept picked this long is explained (each card once, until the chart changes).

// The details folded away (d), remembered.
const FOLDED_SETTING = "detailsFolded";
// While a question is being answered, its answer is looked for this often.
const ASK_POLL_MS = 1500;
// A press that moves this far is a drag of the chart, not a click on a card. The chart moves
// freely every way, as long as this much of it stays in view.
const DRAG_STEP = 4;
const KEEP_IN_VIEW = 120;
// The wheel at rest this long ends a zoom with it; until then the cards follow it without gliding.
const WHEEL_REST_MS = 160;
// The heading's height over a wide view's chart, near enough to bound how far it is dragged.
const HEADING_HEIGHT = 130;
// A chart view lower than this is a laptop's: the heading is kept small.
const LOW_VIEW = 700;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const panel = () => find(layout(), BLOCK);
const isShown = () => Boolean(panel()) && panel().hidden !== true;
const isTab = () => Boolean(props()?.tab);
// A tab of its own is open whenever it exists; the panel, while its column shows.
const isOpen = () => isTab() || isShown();
const baseName = (folder) => folder.slice(folder.lastIndexOf("/") + 1) || folder;

// Where the focused pane is, as the Files and Changes panels find it.
function location() {
  const space = spaces().find((one) => one.active);
  const f = focused();
  const pane = f?.pane ? panes().find((one) => one.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder || null, on, space: space?.id ?? null };
}

function stored(key, fallback) {
  const text = localStorage.getItem(key);
  if (text === null) return fallback;
  try {
    return JSON.parse(text);
  } catch (error) {
    console.log(`chartroom: ${key} in localStorage is not JSON, so it starts over: ${error}`);
    return fallback;
  }
}

function store(key, value) {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(value));
}

export default class Chartroom extends View {
  init(_props, cx) {
    if (props()?.button) return this.passFocus(cx);
    const asked = props() ?? {};
    const pinned = stored(PINNED, null) ?? (asked.tab ? asked.project : null);
    this.pinned = typeof pinned?.folder === "string" ? pinned : null;
    this.picked = stored(PICKED, []).filter((folder) => typeof folder === "string");
    this.isPicking = false;
    this.cursor = 0;
    // Each project's chart folder as FIND_CHARTS last said, by project key.
    this.charted = new Map();
    this.context = null;
    this.place = null;
    // What each project showed, to come back to: its chart, its drawing, and where in it.
    this.views = new Map();
    this.size = { width: 460, height: 600 };
    this.hasSize = false;
    // ELK's layouts by level, those asked for and not back yet, and which chart they are of.
    Object.assign(this, { layouts: new Map(), laying: new Set(), chartVersion: 0, zoom: null, hovered: null });
    // Questions: the answers of the project showing (each listed only with the card or level it was
    // asked about), the one an answer was asked for and waits on, the one shown on the chart, and the
    // field to ask in.
    Object.assign(this, { asks: [], asksFolder: null, waitingFor: null, shownAnswer: null, isTyping: false });
    // Explaining a card picked: whether it is on (e), the picked card's explanation, and which ask is current.
    Object.assign(this, { explanation: null, explainCount: 0, explaining: null });
    this.detailsFolded = stored(FOLDED_SETTING, false) === true;
    this.question = InputState.new({ placeholder: "What does it do? What breaks if it goes?" });
    this.question.on("submit", (_e, cx) => this.ask(cx));
    this.question.on("focus", (_e, cx) => {
      this.isTyping = true;
      cx.notify();
    });
    this.question.on("blur", (_e, cx) => {
      this.isTyping = false;
      cx.notify();
    });
    // Finding a card (/): whether the search shows in place of the chart, what it found, the row the
    // keys are on, and the index of the chart it searches, made when the search opens.
    Object.assign(this, { isSearching: false, found: [], foundCursor: 0, searchIndex: null, indexedChart: null });
    this.searchField = InputState.new({ placeholder: "Find a part, file or endpoint" });
    this.searchField.on("change", (_e, cx) => this.searchFor(cx));
    this.searchField.on("submit", (_e, cx) => this.jumpTo(this.found[this.foundCursor], cx));
    // Moving around the chart: how far it is moved, a drag underway, and the sizes that bound it.
    Object.assign(this, { pan: { x: 0, y: 0 }, drag: null, didDrag: false, viewSize: null, isWheeling: false, wheelCount: 0 });
    // The minimap: a drag on it underway, whether the pointer is on it, and the wide view's heading height.
    Object.assign(this, { minimapDrag: null, isOnMinimap: false, headingHeight: null });
    Object.assign(this, { levelCount: 0, litCount: 0, moveCount: 0, isEntering: false, isLitEntering: false, isMoving: false });
    this.handle = cx.focus_handle();
    Object.assign(this, { folder: null, kind: "none", chart: null, text: null, progress: null, log: "", isDrawing: false, focus: null, selected: null });
    this.moveTo(JSON.stringify(this.where()), this.where());
    if (asked.tab) Object.assign(this, { focus: asked.focus ?? null, selected: asked.selected ?? null });
    this.wasShown = isOpen();
    if (this.wasShown) this.refresh(cx);
    cx.timer.every(READ_MS, (cx) => {
      if (isOpen() && (this.place?.on || !this.chart || this.isDrawing || this.error)) this.refresh(cx);
    });
    // How far the code moved on since the chart: commits and files, or null when not known.
    this.changed = null;
    cx.timer.every(CHANGED_MS, (cx) => isOpen() && this.checkChanged(cx));
    // pane.go moves onto the panel too ("focusable" in mod.json).
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "focus") this.handle.focus();
        cx.notify();
      }
    });
  }

  // The button takes no keys: pane.go, which may land on it as on the panel, moves on below it. It
  // is the one copy that hears chartroom.full (⌥⌘F): the panel and the tabs leave that command be.
  passFocus(cx) {
    this.back = new Map();
    cx.spawn(async () => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") run("pane.go", { direction: "down" });
        else if (/^(chartroom[.:])?full$/.test(command)) this.toggleFullSize();
      }
    });
  }

  // The space's Chartroom tab: the one showing, the one there (gone to), or a new one on the space's
  // project. From it, back to the tab it was opened from.
  toggleFullSize() {
    const space = spaces().find((one) => one.active);
    if (!space) return;
    const shown = space.tabs.find((tab) => tab.active);
    const ours = this.fullSizeTab(space);
    if (ours && shown?.id === ours) {
      const back = this.back.get(space.id);
      if (back && space.tabs.some((tab) => tab.id === back)) run("tab.select", { id: back });
      return;
    }
    if (shown) this.back.set(space.id, shown.id);
    if (ours) return run("tab.select", { id: ours });
    const project = { folder: space.folder, on: space.machine ?? null, label: space.name };
    run("tab.new", { space: space.id, name: "Chartroom", mod: MOD, props: { tab: true, project } });
  }

  // The tab in this space whose pane is the Chartroom, if there is one.
  fullSizeTab(space) {
    const tabs = new Set(space.tabs.map((tab) => tab.id));
    return panes().find((pane) => pane.mod === MOD && tabs.has(pane.tab))?.tab ?? null;
  }

  // The project charted: the one picked, else the focused space's.
  where() {
    return this.pinned ? { cwd: this.pinned.folder, on: this.pinned.on ?? null, space: null } : location();
  }

  // A place seen before comes back as it was left. A new one keeps what shows until its read says
  // whether it is the same project (a cd inside it keeps the level and the card picked) or another.
  moveTo(context, place) {
    if (this.context) this.remember();
    const view = this.views.get(context);
    this.context = context;
    this.place = place;
    this.error = "";
    // A new count ends the watch of the place left; the next read watches this one's.
    this.watchCount = (this.watchCount ?? 0) + 1;
    this.watched = null;
    if (view) Object.assign(this, view, { isChecked: true });
    else this.isChecked = Boolean(this.chart);
  }

  remember() {
    this.views.delete(this.context);
    this.views.set(this.context, { folder: this.folder, kind: this.kind, chart: this.chart, text: this.text, progress: this.progress, log: this.log, isDrawing: this.isDrawing, focus: this.focus, selected: this.selected });
    while (this.views.size > MAX_VIEWS) this.views.delete(this.views.keys().next().value);
  }

  refresh(cx) {
    const place = this.where();
    const context = JSON.stringify(place);
    if (context !== this.context) this.moveTo(context, place);
    if (!place.cwd) return;
    // Asked again while reading: read once more when this read is done, as what changed may have
    // changed after this read looked.
    if (this.isReading) {
      this.isStale = true;
      return;
    }
    this.isReading = true;
    this.isStale = false;
    cx.spawn(async (cx) => {
      try {
        await this.read(context, place, cx);
      } catch (error) {
        if (context === this.context) this.error = `The chart could not be read: ${error.message ?? error}`;
      } finally {
        this.isReading = false;
        if (context === this.context) this.isChecked = true;
        if ((context !== this.context || this.isStale) && isOpen()) this.refresh(cx);
        cx.notify();
      }
    });
  }

  async read(context, place, cx) {
    const result = await exec("sh", ["-c", FIND_MAP, "find", place.cwd], { on: place.on });
    if (context !== this.context) return;
    if (result.code === 3) return this.forget();
    if (result.code !== 0) throw new Error(result.stderr.trim() || `looking for the chart ended with ${result.code}`);
    const found = mapFrom(result.stdout);
    // Another project than the one showing: its own level and card, not the last one's.
    if (this.folder && found.folder !== this.folder) Object.assign(this, { chart: null, text: null, focus: null, selected: null });
    Object.assign(this, { folder: found.folder, kind: found.kind, progress: found.progress, log: found.log, isDrawing: found.isDrawing, error: "" });
    if (found.kind === "none") Object.assign(this, { chart: null, text: null });
    else if (found.text !== this.text) this.show(found.folder, found.text, result.stdout.length, cx);
    this.watch(place, cx);
    if (this.folder !== this.asksFolder) this.loadAsks(cx);
  }

  async close() {
    this.question?.release();
    this.searchField?.release();
  }

  // The project's latest answers, read again while one is still being answered. The answer asked
  // for last lights its cards when it comes.
  loadAsks(cx) {
    const folder = this.folder;
    this.asksFolder = folder;
    if (!folder || this.place?.on) {
      this.asks = [];
      return;
    }
    cx.spawn(async (cx) => {
      try {
        const result = await exec("sh", ["-c", FIND_ASKS, "asks", folder]);
        if (this.folder !== folder) return;
        this.asks = asksFrom(result.stdout);
        const answered = this.asks.find((one) => one.id === this.waitingFor && one.status !== "asking");
        if (answered) {
          this.waitingFor = null;
          if (answered.status === "done") this.shownAnswer = answered.id;
        }
        if (this.asks.some((one) => one.status === "asking")) cx.timer.after(ASK_POLL_MS, (cx) => this.loadAsks(cx));
      } catch (error) {
        console.log(`chartroom: the answers in ${folder} could not be read: ${error.message ?? error}`);
      }
      cx.notify();
    });
  }

  // Asks the project's own Claude about the card picked, or the level, in the background.
  ask(cx) {
    const question = this.question.value().trim();
    const folder = this.folder;
    if (!question || !this.chart || !folder || this.place?.on) return;
    const { selected: card, focus } = this;
    const id = String(Date.now());
    this.question.set_value("");
    this.asks = [{ id, question, card, focus, status: "asking" }, ...this.asks];
    this.waitingFor = id;
    cx.spawn(async (cx) => {
      try {
        const started = await exec("sh", ["-c", START_ASK, "ask", folder, await this.script("ask.js"), id, JSON.stringify({ question, card, focus })]);
        if (started.code !== 0) throw new Error(started.stderr.trim() || `starting it ended with ${started.code}`);
        cx.timer.after(ASK_POLL_MS, (cx) => this.loadAsks(cx));
      } catch (error) {
        this.asks = this.asks.map((one) => (one.id === id ? { ...one, status: "failed", error: error.message ?? String(error) } : one));
      }
      cx.notify();
    });
    cx.notify();
  }

  stopAsk(one, cx) {
    if (!one.pid) return;
    cx.spawn(async (cx) => {
      const stopped = await exec("sh", ["-c", STOP_ASK, "stop", String(one.pid)]);
      if (stopped.code !== 0) console.log(`chartroom: ${stopped.stderr.trim()}`);
      this.loadAsks(cx);
    });
  }

  // Lights the cards an answer is about, or puts them out again.
  showAnswer(one, cx) {
    this.shownAnswer = this.shownAnswer === one.id ? null : one.id;
    cx.notify();
  }

  // The answers of what shows now: the card picked's own, or with none picked the level's own.
  asksHere() {
    return asksFor(this.asks, { focus: this.focus, card: this.selected });
  }

  // The cards the answer shown is about, while it is listed, and the ones the picked card's
  // explanation names.
  lighted() {
    const one = this.asksHere().find((ask) => ask.id === this.shownAnswer);
    const explained = this.explanation?.status === "done" && this.explanation.card === this.selected ? this.explanation.cards ?? [] : [];
    const refs = [...(one?.cards ?? []), ...explained];
    if (!refs.length || !this.chart) return new Set();
    return new Set(refs.map((ref) => cardIdOn(this.chart, this.focus, ref)).filter((id) => id && id !== this.selected));
  }

  // The card picked: its explanation shows at once when one was kept for it and the chart since,
  // else an Explain button does (asked = false). Asked for (the button, or e), the project's Claude
  // explains it in the background. An explanation underway for another card finishes and is kept.
  explainSoon(cx, isAsked = false) {
    this.explanation = null;
    const card = this.selected;
    if (!card || !this.chart || !this.folder || this.place?.on) return;
    this.explain(card, ++this.explainCount, cx, isAsked);
  }

  explain(card, count, cx, isAsked) {
    const folder = this.folder;
    const key = explainKey(card);
    const chart = this.chart;
    const again = (cx) => cx.timer.after(ASK_POLL_MS, (cx) => count === this.explainCount && this.explain(card, count, cx, false));
    cx.spawn(async (cx) => {
      try {
        const found = await exec("sh", ["-c", FIND_EXPLAIN, "explain", folder, key]);
        if (count !== this.explainCount) return;
        const record = asksFrom(found.stdout)[0] ?? null;
        const isKept = record?.card === card && (record.status === "asking" || (record.status === "done" && isExplanationCurrent(chart, record)));
        if (isKept || (!record && this.explaining?.key === key)) {
          this.explanation = record ?? { card, status: "asking" };
          if (this.explanation.status === "asking") again(cx);
          return;
        }
        if (!isAsked) {
          this.explanation = { card, status: "none" };
          return;
        }
        this.explanation = { card, status: "asking" };
        const started = await exec("sh", ["-c", START_ASK, "explain", folder, await this.script("ask.js"), key, JSON.stringify({ explain: true, card, focus: this.focus })]);
        if (started.code !== 0) throw new Error(started.stderr.trim() || `starting it ended with ${started.code}`);
        this.explaining = { key };
        again(cx);
      } catch (error) {
        if (count === this.explainCount) this.explanation = { card, status: "failed", error: error.message ?? String(error) };
      } finally {
        cx.notify();
      }
    });
  }

  // What the field asks about, and what each answer was about, in words.
  labelOf(card, focus) {
    if (card) return this.cardLabel(card) ?? "this card";
    return focus ? this.chart?.nodes.get(focus)?.label ?? "this part" : this.chart?.name ?? "this app";
  }

  cardLabel(ref) {
    if (ref?.startsWith("n:")) return this.chart?.nodes.get(ref.slice(2))?.label ?? null;
    if (ref?.startsWith("f:")) return this.chart?.files.get(ref.slice(2))?.name ?? ref.slice(2);
    return null;
  }

  askView() {
    const canAsk = Boolean(this.folder) && !this.place?.on;
    return {
      field: this.question,
      isTyping: this.isTyping,
      canAsk,
      reason: this.place?.on ? "Asking about a chart needs the project on this computer." : "",
      subject: this.labelOf(this.selected, this.focus),
      asks: this.asksHere().slice(0, 8),
      shownId: this.shownAnswer,
      onAsk: (cx) => this.ask(cx),
      onShow: (one, cx) => this.showAnswer(one, cx),
      onStop: (one, cx) => this.stopAsk(one, cx),
    };
  }

  show(folder, text, length, cx) {
    try {
      this.chart = readChart(text);
    } catch (error) {
      if (length >= MAX_OUTPUT * 0.9) throw new Error(`the chart in ${folder} is bigger than the 8 MiB the Chartroom reads`);
      throw error;
    }
    this.text = text;
    if (!this.chart.nodes.has(this.focus)) this.focus = null;
    this.chartVersion += 1;
    this.layouts = new Map();
    this.changed = null;
    this.enter(cx);
    this.checkChanged(cx);
    // A card picked when the chart comes (a tab opened on it) is explained too.
    if (this.selected) this.explainSoon(cx);
  }

  // Asks git how far the code moved on since the chart was drawn: the commits past the head each
  // repo was at, and the files changed after the chart was written.
  checkChanged(cx) {
    const chart = this.chart;
    const folder = this.folder;
    const repos = (chart?.meta?.repos ?? []).filter((repo) => repo.head);
    if (!chart || !folder || this.isDrawing || !repos.length) return;
    const file = `${folder}/.chartroom/chart.json`;
    cx.spawn(async (cx) => {
      try {
        const result = await exec("sh", ["-c", CHANGED, "changed", folder, file, ...repos.flatMap((repo) => [repo.path ?? "", repo.head])], { on: this.place?.on });
        if (result.code !== 0 || this.chart !== chart) return;
        const [commits, files] = result.stdout.trim().split(" ").map(Number);
        this.changed = { commits: commits || 0, files: files || 0 };
      } catch (error) {
        console.log(`chartroom: could not tell what changed in ${folder}: ${error.message ?? error}`);
      }
      cx.notify();
    });
  }

  // A new level fades in: drawn see-through once, then brought up natively (chart.js).
  enter(cx) {
    const count = ++this.levelCount;
    this.zoom = null;
    this.pan = { x: 0, y: 0 };
    this.isEntering = true;
    cx.timer.after(ENTER_MS, (cx) => {
      if (this.levelCount !== count) return;
      this.isEntering = false;
      cx.notify();
    });
  }

  // The lines of a card just picked fade in the same way.
  light(cx) {
    const count = ++this.litCount;
    this.isLitEntering = true;
    cx.timer.after(ENTER_MS, (cx) => {
      if (this.litCount !== count) return;
      this.isLitEntering = false;
      cx.notify();
    });
  }

  // A size as the app reports it, zoomed, in the points the panel draws in: with the app zoomed in
  // (as on a laptop), a panel is narrower than it reports.
  unzoomed(size) {
    const zoom = Number(settings()?.zoom) || 1;
    return { width: size.width / zoom, height: size.height / zoom };
  }

  // A new size: the cards glide to their new places, and the lines step aside until they are there.
  resized(reported, cx) {
    const size = this.unzoomed(reported);
    const isChange = this.hasSize && Math.round(size.width) !== Math.round(this.size.width);
    this.size = size;
    this.hasSize = true;
    if (isChange && this.chart) this.moving(cx);
    cx.notify();
  }

  // The cards glide to new places; the lines step aside until they are there.
  moving(cx) {
    const count = ++this.moveCount;
    this.isMoving = true;
    cx.timer.after(MOVE_MS, (cx) => {
      if (this.moveCount !== count) return;
      this.isMoving = false;
      cx.notify();
    });
  }

  // Zoom to `next` (null: fit the width), the cards gliding there. With `around` (a point in the
  // view), what is under it stays under it.
  zoomTo(next, cx, around = null) {
    const before = this.zoomNow();
    this.zoom = next === null ? null : Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (next === null) this.pan = { x: 0, y: 0 };
    else if (around) {
      const scale = this.zoom / before;
      this.panTo((this.pan.x + around.x) * scale - around.x, (this.pan.y + around.y) * scale - around.y);
    }
    this.moving(cx);
    cx.notify();
  }

  // Zooming with the wheel follows every step at once, cards and lines together, frame by frame:
  // no glide and no lines stepping aside, which a stream of steps would make stutter.
  wheelZoom(next, around, cx) {
    const before = this.zoomNow();
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (around) {
      const scale = this.zoom / before;
      this.panTo((this.pan.x + around.x) * scale - around.x, (this.pan.y + around.y) * scale - around.y);
    }
    const count = ++this.wheelCount;
    this.isWheeling = true;
    cx.timer.after(WHEEL_REST_MS, (cx) => {
      if (count !== this.wheelCount) return;
      this.isWheeling = false;
      cx.notify();
    });
    cx.notify();
  }

  // Moves the chart to (x, y) from its start, freely, as long as a strip of it stays in view.
  panTo(x, y) {
    const laid = this.memo?.laid;
    const view = this.visible();
    const width = Math.max(laid?.width ?? 0, KEEP_IN_VIEW);
    const height = Math.max((laid?.height ?? 0) + (this.isWide() ? HEADING_HEIGHT : 0), KEEP_IN_VIEW);
    const between = (value, low, high) => Math.min(high, Math.max(low, value));
    this.pan = { x: between(x, KEEP_IN_VIEW - view.width, width - KEEP_IN_VIEW), y: between(y, KEEP_IN_VIEW - view.height, height - KEEP_IN_VIEW) };
  }

  // A press on the chart may start a drag of it; it is one once it has moved a few pixels.
  pressed(e) {
    this.drag = { x: e.position.x, y: e.position.y, pan: { ...this.pan } };
    this.didDrag = false;
  }

  dragged(e, cx) {
    if (this.minimapDrag) return this.minimapMoved(e.position, cx);
    if (!this.drag) return;
    const dx = e.position.x - this.drag.x;
    const dy = e.position.y - this.drag.y;
    if (!this.didDrag && Math.hypot(dx, dy) < DRAG_STEP) return;
    this.didDrag = true;
    this.panTo(this.drag.pan.x - dx, this.drag.pan.y - dy);
    cx.notify();
  }

  released(cx) {
    if (!this.drag && !this.minimapDrag) return;
    this.drag = null;
    this.minimapDrag = null;
    cx.notify();
  }

  // The size of the chart's area, in the points it draws in.
  visible() {
    return this.viewSize ?? { width: this.chartWidth(), height: this.size.height };
  }

  // The minimap of the level shown, or null without ELK's layout or room for it.
  minimap(view) {
    const visible = this.visible();
    if (!view?.laid?.lines || !hasRoomFor(visible)) return null;
    const top = this.isWide() ? this.headingHeight ?? HEADING_HEIGHT : 0;
    return minimapOf(view.laid.cards, { view: visible, pan: this.pan, top });
  }

  // A press on the minimap moves the view there, and held it drags the view along; a press on the
  // frame in view keeps it under the pointer. It is no press on the chart under it. Its place is
  // read as a share of the minimap's size, so the app's zoom does not matter.
  minimapPressed(e, cx) {
    cx.stop_propagation();
    this.handle.focus();
    const map = this.minimap(this.memo);
    if (!map || !e.local_position || !e.bounds?.width || !e.bounds?.height) return;
    const origin = { x: e.position.x - e.local_position.x, y: e.position.y - e.local_position.y };
    const scale = { x: map.width / e.bounds.width, y: map.height / e.bounds.height };
    const point = { x: e.local_position.x * scale.x, y: e.local_position.y * scale.y };
    this.minimapDrag = { origin, scale, grab: grabOf(map, point) };
    this.minimapMoved(e.position, cx);
  }

  minimapMoved(position, cx) {
    const map = this.minimap(this.memo);
    if (!map) return;
    const { origin, scale, grab } = this.minimapDrag;
    const point = { x: (position.x - origin.x) * scale.x - grab.x, y: (position.y - origin.y) * scale.y - grab.y };
    const to = panAt(map, point, this.visible());
    this.panTo(to.x, to.y);
    cx.notify();
  }

  // The pointer on the minimap lights no card under it.
  minimapHovered(isHovered, cx) {
    this.isOnMinimap = isHovered;
    if (isHovered) this.hovered = null;
    cx.notify();
  }

  headingSized(size, cx) {
    const height = this.unzoomed(size).height;
    if (Math.round(height) === Math.round(this.headingHeight ?? -1)) return;
    this.headingHeight = height;
    cx.notify();
  }

  zoomNow() {
    return this.memo?.laid?.zoom ?? 1;
  }

  // A card under the pointer lights its lines.
  hover(id, isHovered, cx) {
    if (isHovered && this.isOnMinimap) return;
    const next = isHovered ? id : this.hovered === id ? null : this.hovered;
    if (next === this.hovered) return;
    this.hovered = next;
    cx.notify();
  }

  forget() {
    Object.assign(this, { folder: null, kind: "none", chart: null, text: null, progress: null, log: "", isDrawing: false, focus: null, selected: null, error: "" });
  }

  // Reads again when the chart or the drawing's progress changes: in .chartroom while the panel's
  // own chart is drawn or shown. Another machine's is read on the timer.
  watch(place, cx) {
    const dir = `${this.folder}/.chartroom`;
    if (place.on || this.watched === dir) return;
    this.watched = dir;
    const count = ++this.watchCount;
    cx.spawn(async (cx) => {
      try {
        while (this.watchCount === count) {
          const paths = await watchFolder(dir);
          if (this.watchCount === count && isOpen() && paths.some((path) => path === dir || WATCHED.test(path))) this.refresh(cx);
        }
      } catch (error) {
        if (this.watchCount === count) this.watched = null;
        console.log(`chartroom: stopped watching ${dir}: ${error}`);
      }
    });
  }

  // A script in the draw/ of the checkout this mod is linked from (install.sh links it).
  async script(name) {
    if (!this.checkout) {
      const result = await exec("sh", ["-c", 'cd "$1" && pwd -P', "where", `${appHome()}/mods/${MOD}`]);
      const folder = result.stdout.trim();
      if (result.code !== 0 || !folder.endsWith("/mods/chartroom")) throw new Error("the Chartroom draws and lays out charts from its checkout: link the mod with install.sh");
      this.checkout = folder.slice(0, -"/mods/chartroom".length);
    }
    return `${this.checkout}/draw/${name}`;
  }

  // Draws the project's chart in the background, or brings the Chartroom's own chart up to date.
  // A project with no chart yet is drawn from the top of its repository.
  // Starts once, however often it is asked while starting; START_DRAW and the drawing itself refuse
  // a second drawing of a folder too. What it learns lands only on the project it started for.
  draw(cx) {
    const place = this.place;
    if (!place?.cwd || this.isDrawing || this.isStarting) return;
    if (place.on) return notify({ title: "Chartroom", body: "Drawing a chart needs the project on this computer.", level: "warning" });
    const isUpdate = this.kind === "chartroom";
    const context = this.context;
    this.isStarting = true;
    cx.spawn(async (cx) => {
      try {
        const script = await this.script("draw.js");
        let folder = this.kind === "none" && !this.folder ? null : this.folder;
        if (!folder) {
          const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: place.cwd });
          folder = top.code === 0 ? top.stdout.trim() : place.cwd;
        }
        const started = await exec("sh", ["-c", START_DRAW, "draw", folder, script, isUpdate ? "--update" : ""]);
        if (started.code !== 0) throw new Error(started.stderr.trim() || `starting it ended with ${started.code}`);
        // Read again once the drawing reports, not before: it may not have said it runs yet.
        if (this.context === context) {
          Object.assign(this, { folder, isDrawing: true, progress: { step: "scan", done: 0, total: 0 } });
          this.watch(place, cx);
        }
      } catch (error) {
        notify({ title: "Chartroom", body: `The chart could not be drawn: ${error.message ?? error}`, level: "error" });
      } finally {
        this.isStarting = false;
      }
      cx.notify();
    });
  }

  stop(cx) {
    if (!this.isDrawing || !this.folder) return;
    const folder = this.folder;
    cx.spawn(async (cx) => {
      const stopped = await exec("sh", ["-c", STOP_DRAW, "stop", folder], { on: this.place?.on });
      if (stopped.code !== 0) notify({ title: "Chartroom", body: `The drawing in ${folder} did not stop: ${stopped.stderr.trim() || "it may have ended already"}`, level: "warning" });
      this.refresh(cx);
    });
  }

  // The level shown and where its cards go: ELK's layout once draw/lay.js has sent it (asked for
  // here when it has not), the plain layout when ELK could not lay the level out. Worked out again
  // only when the level, its layout, the width or the zoom changes. Until ELK answers, `laid` is
  // null and the level shows when it is there.
  view(cx) {
    const direction = this.direction();
    const width = this.chartWidth();
    const level = this.memo?.chart === this.chart && this.memo.focus === this.focus ? this.memo.level : levelOf(this.chart, this.focus);
    const key = this.levelKey(this.focus, direction);
    const elk = this.layouts.get(key);
    if (!elk && cx) this.lay([{ key, level, direction }], cx);
    const memo = this.memo;
    if (memo?.level === level && memo.elk === elk && memo.width === width && memo.zoom === this.zoom) return memo;
    let laid = null;
    let note = "";
    if (elk && !elk.error) {
      const fit = Math.min(1, Math.max(MIN_FIT, width / elk.width));
      laid = fromElk(level, { ...elk, direction }, { zoom: this.zoom ?? fit, viewWidth: width, insideLabel: level.focus === null ? "Parts" : "Inside" });
    } else if (elk?.error) {
      laid = layOut(level, width);
      note = `Laid out plainly: ${elk.error}`;
    }
    this.memo = { chart: this.chart, focus: this.focus, level, elk, width, zoom: this.zoom, laid, note };
    return this.memo;
  }

  // Left to right where the chart has room for three bands side by side, top to bottom elsewhere.
  direction() {
    return this.chartWidth() >= ACROSS ? "RIGHT" : "DOWN";
  }

  levelKey(focus, direction) {
    return `${this.chartVersion}:${focus ?? ""}:${direction}`;
  }

  // Asks draw/lay.js for these levels' layouts, those not had or asked for yet, all in one go.
  lay(levels, cx) {
    const wanted = levels.filter((one) => !this.layouts.has(one.key) && !this.laying.has(one.key));
    if (!wanted.length) return;
    for (const one of wanted) this.laying.add(one.key);
    const version = this.chartVersion;
    cx.spawn(async (cx) => {
      try {
        const payload = JSON.stringify({ levels: wanted.map((one) => elkLevel(one.key, one.level, one.direction)) });
        if (payload.length > MAX_LAY_ARG) throw new Error("this level is too big for ELK");
        const result = await exec("bun", [await this.script("lay.js"), payload]);
        if (result.code !== 0) throw new Error(result.stderr.trim() || `bun ended with ${result.code}`);
        const { layouts } = JSON.parse(result.stdout);
        if (version !== this.chartVersion) return;
        for (const one of wanted) this.layouts.set(one.key, layouts[one.key] ?? { error: "ELK sent no layout for it" });
        if (wanted.some((one) => one.key === this.levelKey(this.focus, this.direction()))) {
          this.enter(cx);
          this.layAhead(cx);
        }
      } catch (error) {
        if (version === this.chartVersion) for (const one of wanted) this.layouts.set(one.key, { error: error.message ?? String(error) });
      } finally {
        for (const one of wanted) this.laying.delete(one.key);
        cx.notify();
      }
    });
  }

  // The levels one click away (the parts on this level, and the level above), laid out ahead so
  // going there shows them at once.
  layAhead(cx) {
    const level = this.memo?.level;
    if (!level) return;
    const direction = this.direction();
    const parts = [...level.inside, ...level.outside].filter((card) => card.isOpenable).map((card) => card.part);
    if (level.focus !== null) parts.push(this.chart.nodes.get(level.focus)?.parent ?? null);
    const levels = [...new Set(parts)].slice(0, MAX_AHEAD).map((part) => ({ key: this.levelKey(part, direction), level: levelOf(this.chart, part), direction }));
    this.lay(levels.filter((one) => JSON.stringify(elkLevel(one.key, one.level, direction)).length < MAX_LAY_ARG / 4), cx);
  }

  isWide() {
    return this.size.width >= WIDE;
  }

  chartWidth() {
    return Math.round(this.isWide() && !this.detailsFolded ? this.size.width - DETAILS_WIDTH : this.size.width);
  }

  // The details folded away, so the chart gets the whole width, or back; the cards glide there.
  foldDetails(isFolded, cx) {
    this.detailsFolded = isFolded;
    store(FOLDED_SETTING, isFolded);
    this.moving(cx);
    cx.notify();
  }

  cardOf(view, id) {
    return [...view.level.inside, ...view.level.outside].find((card) => card.id === id) ?? null;
  }

  pick(card, isOpening, cx) {
    // The press that ends a drag of the chart is no click on the card it ends on.
    if (this.didDrag) {
      this.didDrag = false;
      return;
    }
    if (isOpening && card.isOpenable) return this.open(card, cx);
    if (this.selected !== card.id) this.light(cx);
    const isNew = this.selected !== card.id;
    this.selected = card.id;
    if (isNew) this.explainSoon(cx);
    // A card picked opens the details again, so what it is and its explanation show.
    if (isNew && this.detailsFolded) this.foldDetails(false, cx);
    cx.notify();
  }

  open(card, cx) {
    if (!card?.isOpenable) return;
    this.focus = card.part;
    this.selected = null;
    this.enter(cx);
    cx.notify();
  }

  // Up to the level around this one, with the part it came out of picked.
  up(cx) {
    if (this.focus === null) return false;
    const from = this.focus;
    const parent = this.chart.nodes.get(from)?.parent ?? null;
    // A part that is its own parent (a map with a loop in it) leads to the top.
    this.focus = parent === from ? null : parent;
    this.selected = `n:${from}`;
    this.enter(cx);
    cx.notify();
    return true;
  }

  // Back to a level on the trail, with the part on the way down from it picked.
  goTo(part, cx) {
    let child = this.focus;
    for (let depth = 0; child !== null && depth < 64 && (this.chart.nodes.get(child)?.parent ?? null) !== part; depth += 1) child = this.chart.nodes.get(child)?.parent ?? null;
    this.focus = part;
    this.selected = child === null ? null : `n:${child}`;
    this.enter(cx);
    cx.notify();
  }

  step(view, by) {
    const cards = view.laid?.cards ?? [];
    if (!cards.length) return;
    const at = cards.findIndex((card) => card.id === this.selected);
    const next = at < 0 ? (by > 0 ? 0 : cards.length - 1) : Math.min(cards.length - 1, Math.max(0, at + by));
    this.selected = cards[next].id;
  }

  // The search in place of the chart, its field taking the keyboard; and the chart again. The index
  // is made here, once per chart, so a key typed only searches it.
  openSearch(cx) {
    this.indexNow();
    Object.assign(this, { isSearching: true, found: [], foundCursor: 0 });
    this.searchField.set_value("");
    this.searchField.focus();
    cx.notify();
  }

  closeSearch(cx) {
    this.isSearching = false;
    this.handle.focus();
    cx.notify();
  }

  // What the field finds on the chart showing.
  searchFor(cx) {
    if (!this.chart || !this.isSearching) return;
    this.found = searchChart(this.indexNow(), this.searchField.value());
    this.foundCursor = 0;
    cx.notify();
  }

  // The search index of the chart showing, made again only when the chart is read again.
  indexNow() {
    if (this.indexedChart !== this.chart) Object.assign(this, { searchIndex: searchIndexOf(this.chart), indexedChart: this.chart });
    return this.searchIndex;
  }

  // To a card found: the level it sits on, with the card picked, its lines lit and its details
  // shown, as if walked there.
  jumpTo(one, cx) {
    if (!one || !this.chart) return;
    this.closeSearch(cx);
    this.focus = one.focus !== null && this.chart.nodes.has(one.focus) ? one.focus : null;
    this.selected = one.ref;
    this.enter(cx);
    this.light(cx);
    this.explainSoon(cx);
    if (this.detailsFolded) this.foldDetails(false, cx);
  }

  projects() {
    return projectsOf(spaces(), this.picked);
  }

  // The list of projects in place of the chart, or the chart again.
  togglePicker(cx) {
    this.isPicking = !this.isPicking;
    this.isSearching = false;
    if (this.isPicking) {
      const rows = pickerRows(this.projects());
      const current = rows.findIndex((row) => (row.kind === "follow" ? !this.pinned : row.kind === "project" && row.project.folder === this.pinned?.folder && row.project.on === (this.pinned.on ?? null)));
      this.cursor = Math.max(0, current);
      this.checkCharts(cx);
    }
    cx.notify();
  }

  // Asks each machine which of its projects have a chart, all of a machine's projects at once.
  checkCharts(cx) {
    const byMachine = new Map();
    for (const project of this.projects()) {
      if (!byMachine.has(project.on)) byMachine.set(project.on, []);
      byMachine.get(project.on).push(project);
    }
    for (const [on, projects] of byMachine) {
      cx.spawn(async (cx) => {
        try {
          const result = await exec("sh", ["-c", FIND_CHARTS, "find", ...projects.map((project) => project.folder)], { on });
          if (result.code !== 0) throw new Error(result.stderr.trim() || `looking for charts ended with ${result.code}`);
          const found = chartedFrom(result.stdout);
          for (const project of projects) this.charted.set(project.key, { map: found.get(project.folder) ?? null, error: null });
        } catch (error) {
          for (const project of projects) this.charted.set(project.key, { map: null, error: `${on ?? "This computer"} did not answer: ${error.message ?? error}` });
        }
        cx.notify();
      });
    }
  }

  onRow(row, cx) {
    if (row.kind === "follow") this.pin(null, cx);
    else if (row.kind === "project") this.pin({ folder: row.project.folder, on: row.project.on, label: row.project.label }, cx);
    else this.chooseFolder(cx);
  }

  pin(project, cx) {
    this.pinned = project;
    store(PINNED, project);
    this.isPicking = false;
    this.refresh(cx);
    this.enter(cx);
    cx.notify();
  }

  // The system's folder picker, for a project no space is in.
  chooseFolder(cx) {
    cx.spawn(async (cx) => {
      try {
        const folder = await pickFolder({ prompt: "Chart" });
        if (!folder) return;
        this.picked = [folder, ...this.picked.filter((one) => one !== folder)].slice(0, MAX_PICKED);
        store(PICKED, this.picked);
        this.pin({ folder, on: null, label: baseName(folder) }, cx);
      } catch (error) {
        notify({ title: "Chartroom", body: `The folder picker did not open: ${error.message ?? error}`, level: "error" });
      }
    });
  }

  // The space a tab for this project goes in: the project's own, else one that starts in its
  // folder, else the one shown.
  spaceFor(place) {
    const list = spaces();
    return place.space ?? list.find((one) => one.folder === place.cwd && (one.machine ?? null) === place.on)?.id ?? list.find((one) => one.active)?.id ?? null;
  }

  // The Chartroom full size: a tab of its own in the space, on this project and level. As any
  // pane, ⌘⇧↵ zooms it, and the window's full screen makes it the whole screen.
  openFullSize() {
    const place = this.place;
    if (!place?.cwd) return;
    // The space's Chartroom tab when it has one; else a new one on this project and level.
    const space = spaces().find((one) => one.active);
    const ours = space ? this.fullSizeTab(space) : null;
    if (ours) return run("tab.select", { id: ours });
    const folder = this.folder ?? place.cwd;
    const project = this.pinned ?? { folder, on: place.on, label: this.chart?.name ?? baseName(folder) };
    run("tab.new", { space: this.spaceFor(place), name: "Chartroom", mod: MOD, props: { tab: true, project, focus: this.focus, selected: this.selected } });
  }

  hide() {
    const pane = focused()?.pane;
    run("layout.hide", { id: BLOCK });
    if (pane) run("pane.focus", { pane });
  }

  onKey(e, cx) {
    // Keys typed into the search are the search's, but for the ones that move through what it found.
    if (this.isSearching) {
      if (this.searchKey(e.key, cx)) {
        cx.stop_propagation();
        cx.notify();
      }
      return;
    }
    // Keys typed into the question are the question's; esc leaves it.
    if (this.isTyping) {
      if (e.key === "escape") {
        this.handle.focus();
        cx.stop_propagation();
      }
      return;
    }
    const m = e.modifiers ?? {};
    if (m.platform || m.control || m.alt) return;
    // `/` by the character it types, as on an AZERTY keyboard it takes shift.
    const k = e.key_char === "/" ? "/" : e.key;
    if (this.isPicking ? this.pickerKey(k, cx) : this.chartKey(k, cx)) {
      cx.stop_propagation();
      cx.notify();
    }
  }

  searchKey(k, cx) {
    if (k === "down" || k === "up") this.foundCursor = Math.max(0, Math.min(this.found.length - 1, this.foundCursor + (k === "down" ? 1 : -1)));
    else if (k === "escape") this.closeSearch(cx);
    else return false;
    return true;
  }

  pickerKey(k, cx) {
    const rows = pickerRows(this.projects());
    if (k === "down" || k === "up") this.cursor = Math.min(rows.length - 1, Math.max(0, this.cursor + (k === "down" ? 1 : -1)));
    else if (k === "enter" && rows[this.cursor]) this.onRow(rows[this.cursor], cx);
    else if (k === "escape" || k === "p") this.togglePicker(cx);
    else return false;
    return true;
  }

  chartKey(k, cx) {
    const view = this.chart ? this.view(cx) : null;
    if (view && (k === "down" || k === "right" || k === "up" || k === "left")) {
      this.step(view, k === "down" || k === "right" ? 1 : -1);
      this.light(cx);
      this.explainSoon(cx);
    }
    else if (view && k === "enter") this.open(this.cardOf(view, this.selected), cx);
    else if (view && k === "backspace") this.up(cx);
    else if (k === "escape") {
      if (!view || !this.up(cx)) {
        if (isTab()) return false;
        this.hide();
      }
    } else if (k === "p") this.togglePicker(cx);
    else if (view && k === "/") this.openSearch(cx);
    else if (k === "f" && !isTab()) this.openFullSize();
    else if (k === "u") this.draw(cx);
    else if (k === "s") this.stop(cx);
    else if (view && k === "a" && this.folder && !this.place?.on) this.question.focus();
    else if (view && k === "d") this.foldDetails(!this.detailsFolded, cx);
    else if (view && k === "e") {
      if (this.explanation?.status !== "asking" && this.explanation?.status !== "done") this.explainSoon(cx, true);
    }
    else if (view?.laid && (k === "-" || k === "=" || k === "+")) this.zoomTo(this.zoomNow() * (k === "-" ? 1 / ZOOM_STEP : ZOOM_STEP), cx);
    else if (view?.laid && k === "0") this.zoomTo(null, cx);
    else return false;
    return true;
  }

  // Opened by the key or the button: read the chart and take the keyboard.
  watchShown(cx) {
    const shown = isOpen();
    if (shown && !this.wasShown) {
      this.refresh(cx);
      cx.spawn(async () => this.handle.focus());
    }
    this.wasShown = shown;
  }

  render(cx) {
    const t = theme();
    if (props()?.button) return this.button(t);
    this.watchShown(cx);
    if (isOpen() && JSON.stringify(this.where()) !== this.context) this.refresh(cx);
    const view = this.chart && !this.isPicking ? this.view(cx) : null;
    const failed = this.progress?.step === "failed" && !this.isDrawing && this.chart ? endedWords(this.progress, this.log) : "";
    const error = this.isPicking ? "" : this.error || failed;
    return v_flex().id("chartroom").track_focus(this.handle).size_full().min_h(0).bg(t.chrome).text_size(13).text_color(t.foreground)
      .on_size_change((size, cx) => this.resized(size, cx))
      .on_key_down((e, cx) => this.onKey(e, cx))
      .on_mouse_down("left", () => this.handle.focus())
      .child(this.header(t))
      .when(Boolean(view), (el) => el.child(this.trail(t, view.level)))
      .when(Boolean(view) && this.isDrawing, (el) => el.child(updateStrip({ t, progress: this.progress, onStop: (cx) => this.stop(cx) })))
      .when(Boolean(view) && !this.isDrawing && this.isBehind(), (el) => el.child(changedStrip({ t, changed: this.changed, isOwn: this.kind === "chartroom", onUpdate: (cx) => this.draw(cx) })))
      .when(Boolean(error), (el) => el.child(div().flex_none().px(16).py(6).text_size(12).line_height("17px").text_color(t.blocked).child(error)))
      .child(this.body(t, view))
      // As the status bar beside it.
      .child(h_flex().flex_none().h(28).px(14).items_center().border_t(1).border_color(t.border).text_size(11.8).text_color(t.dim)
        .child(div().truncate().child(this.hints(view))));
  }

  body(t, view) {
    if (this.isPicking) return this.picker(t);
    if (view && this.isSearching) {
      const onPick = (one, cx) => this.jumpTo(one, cx);
      return searchView({ t, field: this.searchField, query: this.searchField.value(), found: this.found, cursor: this.foundCursor, onPick });
    }
    if (view) return this.chartBody(t, view);
    if (this.isDrawing) return firstDrawing({ t, name: baseName(this.folder ?? this.place.cwd), progress: this.progress, onStop: (cx) => this.stop(cx) });
    return this.empty(t);
  }

  // The tab bar's button, drawn as the tab bar draws Files and Changes, in the tab bar's row; the
  // last block of the row keeps the tab bar's own room on its right.
  // Lit while the space shows its Chartroom tab.
  button(t) {
    const space = spaces().find((one) => one.active);
    const shown = space?.tabs.find((tab) => tab.active)?.id;
    const isOn = Boolean(space && shown && this.fullSizeTab(space) === shown);
    const isLast = find(layout(), "tabs-row")?.children?.at(-1)?.id === BUTTON;
    return h_flex().size_full().pr(isLast ? 10 : 3).items_center().justify_end().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id(BUTTON).h(26).px(8).gap(5).flex_none().items_center().rounded(6).text_size(12)
        .bg(isOn ? t.selected : t.chrome).text_color(isOn ? t.foreground : t.muted).hover((s) => s.bg(t.hover)).cursor_pointer()
        .tooltip(isOn ? "Back to the tab before (⌥⌘F)" : `Chartroom, full size (⌥⌘F)${panel() ? " · beside the terminals: ⌥⇧⌘F" : ""}`)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => this.toggleFullSize())
        .child(svg(`${ICONS}/layers.svg`).size(14)).child("Chartroom"));
  }

  iconButton(t, id, icon, tip, action) {
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click(action).child(icon);
  }

  // As the Changes panel's header, in line with the tab bar: its name, the project it charts (a
  // button to pick another), and its buttons.
  // Whether the code moved on since the chart.
  isBehind() {
    return Boolean(this.changed && (this.changed.commits > 0 || this.changed.files > 0));
  }

  header(t) {
    const canUpdate = Boolean(this.chart) && !this.isDrawing && !this.isPicking && !this.place?.on;
    const isOwn = this.kind === "chartroom";
    return h_flex().h(42).flex_none().pl(16).pr(8).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().flex_none().font_semibold().child("Chartroom"))
      .child(this.projectButton(t))
      .child(div().flex_1())
      .when(this.isReading && Boolean(this.chart), (el) => el.child(svg(`${ICONS}/spinner.svg`).size(13).flex_none().text_color(t.muted).spin(900)))
      .when(canUpdate, (el) => el.child(this.updateButton(t, isOwn)))
      .when(!isTab() && Boolean(this.place?.cwd), (el) => el.child(this.iconButton(t, "full-size", svg(`${ICONS}/square.svg`).size(13), "Full size, in a tab of its own (f)", () => this.openFullSize())))
      .when(!isTab(), (el) => el.child(this.iconButton(t, "hide", svg(`${ICONS}/x.svg`).size(14), "Close (esc)", () => this.hide())));
  }

  // The header's Update: a word and an icon, lit while the code has moved on since the chart.
  updateButton(t, isOwn) {
    const isBehind = this.isBehind();
    return h_flex().id("redraw").flex_none().h(26).px(8).gap(5).items_center().rounded(6).text_size(12)
      .text_color(isBehind ? t.accent : t.muted).when(isBehind, (el) => el.border_1().border_color(t.accent))
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
      .tooltip(isOwn ? "Update the chart with your Claude: only what changed (u)" : "Draw the chart with your Claude (u)")
      .on_click((_e, cx) => this.draw(cx))
      .child(div().text_size(14).child("↻")).child(isOwn ? "Update" : "Draw");
  }

  // The project charted, with a pin when it was picked rather than followed.
  projectButton(t) {
    const label = this.chart?.name ?? (this.place?.cwd ? baseName(this.place.cwd) : "No project");
    const tip = this.pinned ? `Charting ${this.pinned.folder}: pick another (p)` : "Charting the focused space's project: pick another (p)";
    return h_flex().id("project").flex_shrink_1().min_w(0).max_w(220).h(24).px(6).gap(4).items_center().rounded(6).border_1()
      .border_color(this.isPicking ? t.accent : t.border).text_size(11.5).text_color(this.isPicking ? t.foreground : t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .on_click((_e, cx) => this.togglePicker(cx))
      .when(Boolean(this.pinned), (el) => el.child(svg(`${ICONS}/pin.svg`).size(11).flex_none()))
      .child(div().min_w(0).truncate().child(label))
      .child(svg(`${ICONS}/chevron-down.svg`).size(11).flex_none());
  }

  picker(t) {
    return projectList({
      t,
      rows: pickerRows(this.projects()),
      cursor: this.cursor,
      charted: this.charted,
      pinned: this.pinned,
      focusedFolder: location().cwd,
      home: home(),
      onRow: (row, cx) => this.onRow(row, cx),
    });
  }

  // The way down to this level, each step a way back up to it.
  trail(t, level) {
    const steps = level.trail;
    const crumbs = steps.flatMap((step, index) => {
      const isHere = index === steps.length - 1;
      const crumb = div().id(`trail-${index}`).min_w(0).truncate().px(4).py(1).rounded(5)
        .when(isHere, (el) => el.flex_1().font_medium().text_color(t.foreground))
        .when(!isHere, (el) => el.flex_none().max_w(120).text_color(t.muted).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.goTo(step.part, cx)))
        .child(step.label);
      return index === 0 ? [crumb] : [svg(`${ICONS}/chevron-right.svg`).size(11).flex_none().text_color(t.dim), crumb];
    });
    return h_flex().h(34).flex_none().min_w(0).px(10).gap(4).items_center().border_b(1).border_color(t.border).text_size(12)
      .when(level.focus !== null, (el) => el.child(this.iconButton(t, "up", svg(`${ICONS}/chevron-left.svg`).size(14), "Up a level (⌫)", (_e, cx) => this.up(cx))))
      .children(crumbs)
      .when(Boolean(this.memo?.laid?.lines), (el) => el.child(this.zoomControls(t)))
      .child(this.detailsToggle(t));
  }

  // At the trail's end: the details shown or folded away, as Herdr's own panel button.
  detailsToggle(t) {
    const isShown = !this.detailsFolded;
    return div().id("details-toggle").flex_none().size(24).flex().items_center().justify_center().rounded(6).cursor_pointer()
      .bg(isShown ? t.selected : t.chrome).text_color(isShown ? t.foreground : t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(isShown ? "Fold the details away (d)" : "Show the details (d)")
      .on_click((_e, cx) => this.foldDetails(isShown, cx))
      .child(svg(`${ICONS}/${this.isWide() ? "panel-right" : "panel-left"}.svg`).size(14));
  }

  // The chart, and the details under it, or beside it in a wide view. Nothing is drawn before the
  // view knows its size, so the cards do not glide in from a guessed one.
  chartBody(t, view) {
    const details = this.selected ? detailsOf(view.level, this.selected) : null;
    const isWide = this.isWide();
    const onPick = (card, isOpening, cx) => this.pick(card, isOpening, cx);
    const explain = { record: this.explanation?.card === this.selected ? this.explanation : null, onExplain: (cx) => this.explainSoon(cx, true) };
    const aside = detailsView({ t, details, level: view.level, chart: this.chart, onPick, onOpen: (card, cx) => this.open(card, cx), ask: this.askView(), explain });
    const body = isWide ? h_flex() : v_flex();
    const isDragging = Boolean(this.drag && this.didDrag);
    const map = this.minimap(view);
    // The chart is a map to move around: dragged anywhere, a card too, or moved with the wheel.
    return body.flex_1().min_h(0).min_w(0)
      .child(div().id("chart").flex_1().h_full().min_h(0).min_w(0).relative().overflow_hidden()
        .when(Boolean(view.laid) && isDragging, (el) => el.cursor_grabbing())
        .when(Boolean(view.laid) && !isDragging, (el) => el.cursor_grab())
        .on_size_change((size, cx) => {
          this.viewSize = this.unzoomed(size);
          cx.notify();
        })
        .on_scroll_wheel((e, cx) => this.wheel(e, cx))
        .on_mouse_down("left", (e) => this.pressed(e))
        .on_mouse_move((e, cx) => this.dragged(e, cx))
        .on_mouse_up("left", (_e, cx) => this.released(cx))
        .on_hover((isHovered, cx) => !isHovered && this.released(cx))
        .child(v_flex().absolute().left(-this.pan.x).top(-this.pan.y)
          .when(isWide && Boolean(view.laid), (el) => el.child(this.heading(t, view.level)))
          .child(this.canvas(t, view)))
        .when(Boolean(map), (el) => el.child(minimapView({ t, map, selected: this.selected, lighted: this.lighted(), isDragging: Boolean(this.minimapDrag),
          onPress: (e, cx) => this.minimapPressed(e, cx), onHover: (isHovered, cx) => this.minimapHovered(isHovered, cx) }))))
      .when(isWide && !this.detailsFolded, (el) => el.child(div().flex_none().w(DETAILS_WIDTH).h_full().border_l(1).border_color(t.border).child(aside)))
      .when(!isWide && !this.detailsFolded, (el) => el.child(div().flex_none().h(Math.round(Math.min(300, Math.max(150, this.size.height * 0.36)))).border_t(1).border_color(t.border).child(aside)));
  }

  // The level's cards and lines, or while ELK lays it out a word that it does, or the plain layout
  // with why ELK could not.
  canvas(t, view) {
    if (!this.hasSize) return div();
    if (!view.laid) return h_flex().px(16).py(14).gap(8).items_center().text_size(12).text_color(t.dim)
      .child(svg(`${ICONS}/spinner.svg`).size(12).text_color(t.muted).spin(900)).child("Laying the chart out…");
    if (!view.laid.cards.length) return div().px(16).py(12).text_size(12).text_color(t.dim).child("Nothing on this level.");
    const motion = { levelKey: `${this.levelCount}`, isEntering: this.isEntering, isLitEntering: this.isLitEntering, isMoving: this.isMoving };
    return v_flex()
      .when(Boolean(view.note), (el) => el.child(div().px(16).pt(8).text_size(11.5).text_color(t.dim).child(view.note)))
      .child(chartView({ t, laid: view.laid, selected: this.selected, hovered: this.hovered, lighted: this.lighted(), isInstant: this.isWheeling, onPick: (card, isOpening, cx) => this.pick(card, isOpening, cx), onHover: (id, isHovered, cx) => this.hover(id, isHovered, cx), ...motion }));
  }

  // Over the chart in a wide view: what this level is, what it is called, and what it does.
  heading(t, level) {
    const part = level.focus === null ? null : this.chart.nodes.get(level.focus);
    const cards = level.inside.length + level.outside.length;
    const kind = part ? `${part.kind === "external" ? "outside service" : part.kind ?? "part"} · ${cards} cards` : `the whole app · ${cards} cards`;
    // On a low screen (a laptop's), smaller, and what it does in two lines at most.
    const isLow = (this.viewSize?.height ?? this.size.height) < LOW_VIEW;
    return v_flex().id("heading").on_size_change((size, cx) => this.headingSized(size, cx)).w(Math.min(760, this.chartWidth() - 56)).px(20).pt(isLow ? 12 : 18).pb(4).gap(isLow ? 2 : 4)
      .child(div().text_size(12).text_color(t.dim).child(kind))
      .child(div().text_size(isLow ? 19 : 24).font_semibold().text_color(t.foreground).child(part?.label ?? this.chart.name))
      .when(Boolean(part?.summary ?? this.chart.summary), (el) => el.child(div().text_size(isLow ? 12 : 13).line_height(isLow ? "17px" : "19px").text_color(t.muted)
        .when(isLow, (text) => text.max_h(34).overflow_hidden()).child(part?.summary ?? this.chart.summary)));
  }

  // The wheel or two fingers zoom around the pointer, as a map does; dragging moves the chart. With
  // shift or ⌘ held they move it instead.
  wheel(e, cx) {
    if (!this.memo?.laid) return;
    const m = e.modifiers ?? {};
    const dx = e.delta?.x ?? 0;
    const dy = e.delta?.y ?? 0;
    if (!(m.shift || m.platform) && this.memo.laid.lines) {
      if (Math.abs(dy) >= 0.5) this.wheelZoom(this.zoomNow() * Math.pow(1.0025, dy), e.local_position ?? null, cx);
    } else {
      this.panTo(this.pan.x - dx, this.pan.y - dy);
      cx.notify();
    }
    cx.stop_propagation();
  }

  // At the trail's end: out, the zoom with fit on a click, in.
  zoomControls(t) {
    const button = (id, child, tip, action) => div().id(id).h(22).min_w(22).px(5).flex().items_center().justify_center().rounded(5).text_size(12).text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer().tooltip(tip).on_click(action).child(child);
    return h_flex().flex_none().gap(1).items_center()
      .child(button("zoom-out", "−", "Zoom out (−)", (_e, cx) => this.zoomTo(this.zoomNow() / ZOOM_STEP, cx)))
      .child(button("zoom-fit", `${Math.round(this.zoomNow() * 100)}%`, "Fit the width (0)", (_e, cx) => this.zoomTo(null, cx)))
      .child(button("zoom-in", "+", "Zoom in (+)", (_e, cx) => this.zoomTo(this.zoomNow() * ZOOM_STEP, cx)));
  }

  // No chart to show: no folder, still looking, or a project not charted yet, with how its last
  // drawing ended when it did not end well.
  empty(t) {
    const note = (words) => div().flex_1().min_h(0).px(16).py(12).text_size(12).text_color(t.dim).child(words);
    if (!this.place?.cwd) return note("No folder to chart: focus a terminal in a project, or pick one (p).");
    if (!this.isChecked) return note("Looking for a chart…");
    const ended = this.isDrawing ? "" : endedWords(this.progress, this.log);
    const button = (id, label, isSolid, action) => div().id(id).h(32).px(14).flex().items_center().rounded(8).text_size(12).cursor_pointer()
      .when(isSolid, (el) => el.bg(t.solid).text_color(t.solid_foreground))
      .when(!isSolid, (el) => el.border_1().border_color(t.border).text_color(t.foreground).hover((s) => s.bg(t.hover)))
      .on_click(action).child(label);
    return v_flex().flex_1().min_h(0).px(16).py(14).gap(10)
      .child(div().font_medium().child(`No chart of ${baseName(this.folder ?? this.place.cwd)} yet`))
      .when(Boolean(ended), (el) => el.child(div().text_size(12).line_height("17px").text_color(t.blocked).child(ended)))
      .child(div().text_size(12).line_height("17px").text_color(t.muted)
        .child("The Chartroom reads the code and asks your own Claude to name the app's parts and describe every file. It runs in the background on your subscription and takes a few minutes; the only thing it adds to the project is a .chartroom folder that keeps itself out of git."))
      .child(h_flex().gap(8)
        .when(!this.place.on, (el) => el.child(button("draw", ended ? "Try again" : "Draw the chart", true, (_e, cx) => this.draw(cx))))
        .child(button("pick", "Pick another project", false, (_e, cx) => this.togglePicker(cx))))
      .when(Boolean(this.place.on), (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Drawing a chart needs the project on this computer.")));
  }

  // Only the keys that do something here.
  hints(view) {
    if (this.isPicking) return "↑↓ pick  ·  ↵ chart it  ·  esc back";
    if (view && this.isSearching) return "↑↓ pick  ·  ↵ go there  ·  esc back";
    const close = isTab() ? [] : ["esc close"];
    if (this.isDrawing && !view) return [stepWords(this.progress), "s stop", ...close].join("  ·  ");
    if (!view) return [this.place?.cwd && !this.place.on ? "u draw" : "", "p project", ...close].filter(Boolean).join("  ·  ");
    const card = this.cardOf(view, this.selected);
    const keys = ["↑↓ pick", "/ search"];
    if (card?.isOpenable) keys.push("↵ inside");
    if (view.level.focus !== null) keys.push("⌫ up");
    if (view.laid?.lines) keys.push("−+ zoom");
    if (this.folder && !this.place?.on) keys.push("a ask", "e explain");
    keys.push(`d details ${this.detailsFolded ? "off" : "on"}`);
    keys.push("p project", this.isDrawing ? "s stop" : "u update");
    if (!isTab()) keys.push("f full size");
    return [...keys, ...close].join("  ·  ");
  }
}
