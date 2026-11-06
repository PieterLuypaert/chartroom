// The Chartroom in the Herdr app: a chart of a project's code, one level at a time, as cards with
// the lines between them, in a panel on the right of the window. The project is the focused
// space's, or one picked from every space's project and folders chosen by hand. The panel draws
// the chart itself: it starts draw/draw.js in the background, which reads the code and asks the
// person's own Claude for the app's parts and a description of every file, and shows how far it
// is until the chart is there. A map floorplan made shows too. With props {button: true} it is the
// tab bar's button that opens and closes the panel.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { appHome, exec, focused, home, layout, nextCommand, notify, panes, pickFolder, props, run, spaces, theme, watchFolder } from "herdr";
import { detailsOf, levelOf, projectsOf, readChart } from "./model.js";
import { layOut } from "./layout.js";
import { chartView, detailsView } from "./chart.js";
import { chartedFrom, FIND_CHARTS, FIND_MAP, mapFrom, START_DRAW, STOP_DRAW } from "./find.js";
import { pickerRows, projectList } from "./projects.js";
import { endedWords, firstDrawing, stepWords, updateStrip } from "./drawing.js";

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
    const pinned = stored(PINNED, null);
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
    this.handle = cx.focus_handle();
    Object.assign(this, { folder: null, kind: "none", chart: null, text: null, progress: null, log: "", isDrawing: false, focus: null, selected: null });
    this.moveTo(JSON.stringify(this.where()), this.where());
    this.wasShown = isShown();
    if (this.wasShown) this.refresh(cx);
    cx.timer.every(READ_MS, (cx) => {
      if (isShown() && (this.place?.on || !this.chart || this.isDrawing || this.error)) this.refresh(cx);
    });
    // pane.go moves onto the panel too ("focusable" in mod.json).
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "focus") this.handle.focus();
        cx.notify();
      }
    });
  }

  // The button takes no keys: pane.go, which may land on it as on the panel, moves on below it.
  passFocus(cx) {
    cx.spawn(async () => {
      for (;;) if ((await nextCommand()) === "focus") run("pane.go", { direction: "down" });
    });
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
        if ((context !== this.context || this.isStale) && isShown()) this.refresh(cx);
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
    if (found.folder !== this.folder) Object.assign(this, { chart: null, text: null, focus: null, selected: null });
    Object.assign(this, { folder: found.folder, kind: found.kind, progress: found.progress, log: found.log, isDrawing: found.isDrawing, error: "" });
    if (found.kind === "none") Object.assign(this, { chart: null, text: null });
    else if (found.text !== this.text) this.show(found.folder, found.text, result.stdout.length);
    this.watch(place, cx);
  }

  show(folder, text, length) {
    try {
      this.chart = readChart(text);
    } catch (error) {
      if (length >= MAX_OUTPUT * 0.9) throw new Error(`the chart in ${folder} is bigger than the 8 MiB the Chartroom reads`);
      throw error;
    }
    this.text = text;
    if (!this.chart.nodes.has(this.focus)) this.focus = null;
  }

  forget() {
    Object.assign(this, { folder: null, kind: "none", chart: null, text: null, progress: null, log: "", isDrawing: false, focus: null, selected: null, error: "" });
  }

  // Reads again when the chart or the drawing's progress changes: in .chartroom while the panel's
  // own chart is drawn or shown, in floorplan/ for floorplan's. Another machine's is read on the timer.
  watch(place, cx) {
    const dir = `${this.folder}/${this.kind === "floorplan" && !this.isDrawing ? "floorplan" : ".chartroom"}`;
    if (place.on || this.watched === dir) return;
    this.watched = dir;
    const count = ++this.watchCount;
    cx.spawn(async (cx) => {
      try {
        while (this.watchCount === count) {
          const paths = await watchFolder(dir);
          if (this.watchCount === count && isShown() && paths.some((path) => path === dir || WATCHED.test(path))) this.refresh(cx);
        }
      } catch (error) {
        if (this.watchCount === count) this.watched = null;
        console.log(`chartroom: stopped watching ${dir}: ${error}`);
      }
    });
  }

  // The checkout this mod is linked from (install.sh links it), whose draw/ draws the charts.
  async drawScript() {
    if (this.script) return this.script;
    const result = await exec("sh", ["-c", 'cd "$1" && pwd -P', "where", `${appHome()}/mods/${MOD}`]);
    const folder = result.stdout.trim();
    if (result.code !== 0 || !folder.endsWith("/mods/chartroom")) throw new Error("the Chartroom draws charts from its checkout: link the mod with install.sh");
    this.script = `${folder.slice(0, -"/mods/chartroom".length)}/draw/draw.js`;
    return this.script;
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
        const script = await this.drawScript();
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

  // The level shown and where its cards go, worked out again only when one of those changes.
  view() {
    const width = Math.round(this.size.width);
    const memo = this.memo;
    if (memo?.chart === this.chart && memo.focus === this.focus && memo.width === width) return memo;
    const level = levelOf(this.chart, this.focus);
    this.memo = { chart: this.chart, focus: this.focus, width, level, laid: layOut(level, width) };
    return this.memo;
  }

  cardOf(view, id) {
    return [...view.level.inside, ...view.level.outside].find((card) => card.id === id) ?? null;
  }

  pick(card, isOpening, cx) {
    if (isOpening && card.isOpenable) return this.open(card, cx);
    this.selected = card.id;
    cx.notify();
  }

  open(card, cx) {
    if (!card?.isOpenable) return;
    this.focus = card.part;
    this.selected = null;
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
    cx.notify();
    return true;
  }

  // Back to a level on the trail, with the part on the way down from it picked.
  goTo(part, cx) {
    let child = this.focus;
    for (let depth = 0; child !== null && depth < 64 && (this.chart.nodes.get(child)?.parent ?? null) !== part; depth += 1) child = this.chart.nodes.get(child)?.parent ?? null;
    this.focus = part;
    this.selected = child === null ? null : `n:${child}`;
    cx.notify();
  }

  step(view, by) {
    const cards = view.laid.cards;
    if (!cards.length) return;
    const at = cards.findIndex((card) => card.id === this.selected);
    const next = at < 0 ? (by > 0 ? 0 : cards.length - 1) : Math.min(cards.length - 1, Math.max(0, at + by));
    this.selected = cards[next].id;
  }

  projects() {
    return projectsOf(spaces(), this.picked);
  }

  // The list of projects in place of the chart, or the chart again.
  togglePicker(cx) {
    this.isPicking = !this.isPicking;
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

  hide() {
    const pane = focused()?.pane;
    run("layout.hide", { id: BLOCK });
    if (pane) run("pane.focus", { pane });
  }

  onKey(e, cx) {
    const m = e.modifiers ?? {};
    if (m.platform || m.control || m.alt) return;
    if (this.isPicking ? this.pickerKey(e.key, cx) : this.chartKey(e.key, cx)) {
      cx.stop_propagation();
      cx.notify();
    }
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
    const view = this.chart ? this.view() : null;
    if (view && (k === "down" || k === "right")) this.step(view, 1);
    else if (view && (k === "up" || k === "left")) this.step(view, -1);
    else if (view && k === "enter") this.open(this.cardOf(view, this.selected), cx);
    else if (view && k === "backspace") this.up(cx);
    else if (k === "escape") {
      if (!view || !this.up(cx)) this.hide();
    } else if (k === "p") this.togglePicker(cx);
    else if (k === "u") this.draw(cx);
    else if (k === "s") this.stop(cx);
    else return false;
    return true;
  }

  // Opened by the key or the button: read the chart and take the keyboard.
  watchShown(cx) {
    const shown = isShown();
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
    if (isShown() && JSON.stringify(this.where()) !== this.context) this.refresh(cx);
    const view = this.chart && !this.isPicking ? this.view() : null;
    const failed = this.progress?.step === "failed" && !this.isDrawing && this.chart ? endedWords(this.progress, this.log) : "";
    const error = this.isPicking ? "" : this.error || failed;
    return v_flex().id("chartroom").track_focus(this.handle).size_full().min_h(0).bg(t.chrome).text_size(13).text_color(t.foreground)
      .on_size_change((size, cx) => {
        this.size = size;
        cx.notify();
      })
      .on_key_down((e, cx) => this.onKey(e, cx))
      .on_mouse_down("left", () => this.handle.focus())
      .child(this.header(t))
      .when(Boolean(view), (el) => el.child(this.trail(t, view.level)))
      .when(Boolean(view) && this.isDrawing, (el) => el.child(updateStrip({ t, progress: this.progress, onStop: (cx) => this.stop(cx) })))
      .when(Boolean(error), (el) => el.child(div().flex_none().px(16).py(6).text_size(12).line_height("17px").text_color(t.blocked).child(error)))
      .child(this.body(t, view))
      // As the status bar beside it.
      .child(h_flex().flex_none().h(28).px(14).items_center().border_t(1).border_color(t.border).text_size(11.8).text_color(t.dim)
        .child(div().truncate().child(this.hints(view))));
  }

  body(t, view) {
    if (this.isPicking) return this.picker(t);
    if (view) return this.chartBody(t, view);
    if (this.isDrawing) return firstDrawing({ t, name: baseName(this.folder ?? this.place.cwd), progress: this.progress, onStop: (cx) => this.stop(cx) });
    return this.empty(t);
  }

  // The tab bar's button, drawn as the tab bar draws Files and Changes, in the tab bar's row; the
  // last block of the row keeps the tab bar's own room on its right.
  button(t) {
    const isOn = isShown();
    const isLast = find(layout(), "tabs-row")?.children?.at(-1)?.id === BUTTON;
    return h_flex().size_full().pr(isLast ? 10 : 3).items_center().justify_end().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id(BUTTON).h(26).px(8).gap(5).flex_none().items_center().rounded(6).text_size(12)
        .bg(isOn ? t.selected : t.chrome).text_color(isOn ? t.foreground : t.muted).hover((s) => s.bg(t.hover)).cursor_pointer()
        .tooltip(panel() ? "Chartroom (⌥⌘F)" : "Add the Chartroom's panel with install.sh")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => panel() && run("layout.toggle", { id: BLOCK }))
        .child(svg(`${ICONS}/layers.svg`).size(14)).child("Chartroom"));
  }

  iconButton(t, id, icon, tip, action) {
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip).on_click(action).child(icon);
  }

  // As the Changes panel's header, in line with the tab bar: its name, the project it charts (a
  // button to pick another), and its buttons.
  header(t) {
    const canUpdate = Boolean(this.chart) && !this.isDrawing && !this.isPicking && !this.place?.on;
    return h_flex().h(42).flex_none().pl(16).pr(8).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().flex_none().font_semibold().child("Chartroom"))
      .child(this.projectButton(t))
      .child(div().flex_1())
      .when(this.isReading && Boolean(this.chart), (el) => el.child(svg(`${ICONS}/spinner.svg`).size(13).flex_none().text_color(t.muted).spin(900)))
      .when(canUpdate, (el) => el.child(this.iconButton(t, "redraw", svg(`${ICONS}/square-pen.svg`).size(14),
        this.kind === "chartroom" ? "Update the chart with your Claude: only what changed (u)" : "Draw the chart with your Claude (u)", (_e, cx) => this.draw(cx))))
      .child(this.iconButton(t, "hide", svg(`${ICONS}/x.svg`).size(14), "Close (esc)", () => this.hide()));
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
      .children(crumbs);
  }

  chartBody(t, view) {
    const details = this.selected ? detailsOf(view.level, this.selected) : null;
    const detailsHeight = Math.round(Math.min(300, Math.max(150, this.size.height * 0.36)));
    const onPick = (card, isOpening, cx) => this.pick(card, isOpening, cx);
    const chart = view.laid.cards.length
      ? chartView({ t, laid: view.laid, selected: this.selected, onPick })
      : div().px(16).py(12).text_size(12).text_color(t.dim).child("Nothing on this level.");
    return v_flex().flex_1().min_h(0)
      .child(div().id("chart").flex_1().min_h(0).overflow_y_scrollbar().child(chart))
      .child(div().flex_none().h(detailsHeight).border_t(1).border_color(t.border)
        .child(detailsView({ t, details, level: view.level, chart: this.chart, onPick, onOpen: (card, cx) => this.open(card, cx) })));
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
    if (this.isDrawing && !view) return `${stepWords(this.progress)}  ·  s stop  ·  esc close`;
    if (!view) return [this.place?.cwd && !this.place.on ? "u draw" : "", "p project", "esc close"].filter(Boolean).join("  ·  ");
    const card = this.cardOf(view, this.selected);
    const keys = ["↑↓ pick"];
    if (card?.isOpenable) keys.push("↵ inside");
    if (view.level.focus !== null) keys.push("⌫ up");
    keys.push("p project", this.isDrawing ? "s stop" : "u update");
    return [...keys, "esc close"].join("  ·  ");
  }
}
