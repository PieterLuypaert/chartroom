// The Chartroom in the Herdr app: the map floorplan draws of a project, one level at a time, as
// cards with the lines between them, in a panel on the right of the window. The project is the
// focused space's, or one picked from the list of every space's project and folders chosen by
// hand. Its map is floorplan/graph.json in the project's folder or the nearest folder above it, read
// again whenever floorplan writes it. With props {button: true} it is the tab bar's button that
// opens and closes the panel.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, focused, home, knownAgents, layout, nextCommand, notify, panes, pickFolder, props, run, spaces, theme, watchFolder, window as appWindow } from "herdr";
import { detailsOf, levelOf, projectsOf, readChart } from "./model.js";
import { layOut } from "./layout.js";
import { chartView, detailsView } from "./chart.js";
import { chartedFrom, FIND_CHARTS, FIND_MAP } from "./find.js";
import { pickerRows, projectList } from "./projects.js";

// The layout block the panel lives in, and the tab bar's button: install.sh adds both.
const BLOCK = "chartroom";
const BUTTON = "chartroom-button";
const ICONS = "mods/workspace-chrome";
// While shown, how often a map on another machine (which cannot be watched) is read again, and
// how often the project is looked in again while it has no map yet.
const READ_MS = 15000;
// What a new Claude tab is asked, to draw the map or to bring it up to date.
const DRAW_TASK = "Make me a floorplan of this app.";
const UPDATE_TASK = "Update the floorplan.";
// exec hands back at most 8 MiB, so a bigger map arrives cut short.
const MAX_OUTPUT = 8 * 1024 * 1024;
// Kept in localStorage: the project picked (null: follow the focused space), and the folders
// chosen by hand, the latest first.
const PINNED = "pinned";
const PICKED = "picked";
const MAX_PICKED = 8;

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
    // Each project's map folder as FIND_CHARTS last said, by project key.
    this.charted = new Map();
    this.context = null;
    this.place = null;
    // What each project showed, to come back to: its map and where in it.
    this.views = new Map();
    this.size = { width: 460, height: 600 };
    this.handle = cx.focus_handle();
    this.moveTo(JSON.stringify(this.where()), this.where());
    this.wasShown = isShown();
    if (this.wasShown) this.refresh(cx);
    cx.timer.every(READ_MS, (cx) => {
      if (isShown() && (this.place?.on || !this.chart)) this.refresh(cx);
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

  moveTo(context, place) {
    if (this.context) this.views.set(this.context, { folder: this.folder, chart: this.chart, text: this.text, focus: this.focus, selected: this.selected });
    const view = this.views.get(context);
    this.context = context;
    this.place = place;
    this.folder = view?.folder ?? null;
    this.chart = view?.chart ?? null;
    this.text = view?.text ?? null;
    this.focus = view?.focus ?? null;
    this.selected = view?.selected ?? null;
    this.error = "";
    this.isChecked = Boolean(view);
    this.watched = null;
  }

  refresh(cx) {
    const place = this.where();
    const context = JSON.stringify(place);
    if (context !== this.context) this.moveTo(context, place);
    if (!place.cwd || this.isReading) return;
    this.isReading = true;
    cx.spawn(async (cx) => {
      try {
        await this.read(context, place, cx);
      } catch (error) {
        if (context === this.context) this.error = `The chart could not be read: ${error.message ?? error}`;
      } finally {
        this.isReading = false;
        if (context === this.context) this.isChecked = true;
        else if (isShown()) this.refresh(cx);
        cx.notify();
      }
    });
  }

  async read(context, place, cx) {
    const result = await exec("sh", ["-c", FIND_MAP, "find", place.cwd], { on: place.on });
    if (context !== this.context) return;
    if (result.code === 3) return this.forget();
    if (result.code !== 0) throw new Error(result.stderr.trim() || `looking for floorplan/graph.json ended with ${result.code}`);
    const cut = result.stdout.indexOf("\n");
    const folder = result.stdout.slice(0, cut);
    const text = result.stdout.slice(cut + 1);
    if (text !== this.text) this.show(folder, text, result.stdout.length);
    this.folder = folder;
    this.error = "";
    this.watch(place, cx);
  }

  show(folder, text, length) {
    try {
      this.chart = readChart(text);
    } catch (error) {
      if (length >= MAX_OUTPUT * 0.9) throw new Error(`${folder}/floorplan/graph.json is bigger than the 8 MiB the Chartroom reads`);
      throw error;
    }
    this.text = text;
    if (!this.chart.nodes.has(this.focus)) this.focus = null;
  }

  forget() {
    this.folder = null;
    this.chart = null;
    this.text = null;
    this.error = "";
  }

  // Reads the map again when floorplan writes it. A map on another machine is read on the timer.
  watch(place, cx) {
    const dir = `${this.folder}/floorplan`;
    if (place.on || this.watched === dir) return;
    this.watched = dir;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === dir) {
          const paths = await watchFolder(dir);
          if (this.watched === dir && isShown() && paths.some((path) => path === dir || path.endsWith("/graph.json"))) this.refresh(cx);
        }
      } catch (error) {
        if (this.watched === dir) this.watched = null;
        console.log(`chartroom: stopped watching ${dir}: ${error}`);
      }
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
    this.focus = this.chart.nodes.get(from)?.parent ?? null;
    this.selected = `n:${from}`;
    cx.notify();
    return true;
  }

  // Back to a level on the trail, with the part on the way down from it picked.
  goTo(part, cx) {
    let child = this.focus;
    while (child !== null && (this.chart.nodes.get(child)?.parent ?? null) !== part) child = this.chart.nodes.get(child)?.parent ?? null;
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

  // Asks each machine which of its projects have a map, all of a machine's projects at once.
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
          if (result.code !== 0) throw new Error(result.stderr.trim() || `looking for maps ended with ${result.code}`);
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

  // The space a new Claude tab for this project goes in: the project's own, else one that starts
  // in its folder, else the one shown.
  spaceFor(place) {
    const list = spaces();
    return place.space ?? list.find((one) => one.folder === place.cwd && (one.machine ?? null) === place.on)?.id ?? list.find((one) => one.active)?.id ?? null;
  }

  // A new Claude tab, asked to draw the project's map, or to bring it up to date. Without a map
  // yet it starts at the top of the project's repository.
  draw(cx) {
    const place = this.place;
    if (!place?.cwd) return;
    const task = this.chart ? UPDATE_TASK : DRAW_TASK;
    cx.spawn(async () => {
      try {
        let folder = this.folder;
        if (!folder) {
          const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: place.cwd, on: place.on });
          folder = top.code === 0 ? top.stdout.trim() : place.cwd;
        }
        const claude = (await knownAgents({ on: place.on })).find((agent) => agent.run?.[0] === "claude");
        run("tab.new", { space: this.spaceFor(place), folder, name: "chart", argv: claude?.run ?? ["claude"], task });
      } catch (error) {
        notify({ title: "Chartroom", body: `Claude did not start: ${error.message ?? error}`, level: "error" });
      }
    });
  }

  // floorplan's own map, with its questions and its walkthroughs, in the browser.
  openInBrowser() {
    if (!this.folder || this.place?.on) return;
    const page = `${this.folder}/floorplan/index.html`;
    exec(appWindow()?.platform === "macos" ? "open" : "xdg-open", [page])
      .catch((error) => notify({ title: "Chartroom", body: `${page} did not open: ${error.message ?? error}`, level: "error" }));
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
    else if (k === "o") this.openInBrowser();
    else if (k === "u") this.draw(cx);
    else return false;
    return true;
  }

  // Opened by the key or the button: read the map and take the keyboard.
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
    return v_flex().id("chartroom").track_focus(this.handle).size_full().min_h(0).bg(t.chrome).text_size(13).text_color(t.foreground)
      .on_size_change((size, cx) => {
        this.size = size;
        cx.notify();
      })
      .on_key_down((e, cx) => this.onKey(e, cx))
      .on_mouse_down("left", () => this.handle.focus())
      .child(this.header(t))
      .when(Boolean(view), (el) => el.child(this.trail(t, view.level)))
      .when(Boolean(this.error) && !this.isPicking, (el) => el.child(div().flex_none().px(16).py(6).text_size(12).line_height("17px").text_color(t.blocked).child(this.error)))
      .child(this.isPicking ? this.picker(t) : view ? this.body(t, view) : this.empty(t))
      // As the status bar beside it.
      .child(h_flex().flex_none().h(28).px(14).items_center().border_t(1).border_color(t.border).text_size(11.8).text_color(t.dim)
        .child(div().truncate().child(this.hints(view))));
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
    const canBrowse = Boolean(this.folder) && !this.place?.on && !this.isPicking;
    return h_flex().h(42).flex_none().pl(16).pr(8).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().flex_none().font_semibold().child("Chartroom"))
      .child(this.projectButton(t))
      .child(div().flex_1())
      .when(this.isReading && Boolean(this.chart), (el) => el.child(svg(`${ICONS}/spinner.svg`).size(13).flex_none().text_color(t.muted).spin(900)))
      .when(canBrowse, (el) => el.child(this.iconButton(t, "browser", div().text_size(15).child("↗"), "Open floorplan's own map in the browser (o)", () => this.openInBrowser())))
      .when(Boolean(this.place?.cwd) && !this.isPicking, (el) => el.child(this.iconButton(t, "redraw", svg(`${ICONS}/square-pen.svg`).size(14),
        this.chart ? "Ask Claude to update the chart (u)" : "Ask Claude to draw the chart (u)", (_e, cx) => this.draw(cx))))
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

  body(t, view) {
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

  // No map to show: no folder, still looking, or a project floorplan has not charted yet.
  empty(t) {
    const note = (words) => div().flex_1().min_h(0).px(16).py(12).text_size(12).text_color(t.dim).child(words);
    if (!this.place?.cwd) return note("No folder to chart: focus a terminal in a project, or pick one (p).");
    if (!this.isChecked) return note("Looking for a chart…");
    const button = (id, label, isSolid, action) => div().id(id).h(32).px(14).flex().items_center().rounded(8).text_size(12).cursor_pointer()
      .when(isSolid, (el) => el.bg(t.solid).text_color(t.solid_foreground))
      .when(!isSolid, (el) => el.border_1().border_color(t.border).text_color(t.foreground).hover((s) => s.bg(t.hover)))
      .on_click(action).child(label);
    return v_flex().flex_1().min_h(0).px(16).py(14).gap(10)
      .child(div().font_medium().child(`No chart of ${baseName(this.place.cwd)} yet`))
      .child(div().text_size(12).line_height("17px").text_color(t.muted)
        .child("The Chartroom shows the map floorplan makes for Claude Code, kept in a floorplan folder in the project. Ask Claude to draw one, and the chart appears here when it is done."))
      .child(h_flex().gap(8)
        .child(button("draw", "Draw it with Claude", true, (_e, cx) => this.draw(cx)))
        .child(button("pick", "Pick another project", false, (_e, cx) => this.togglePicker(cx))))
      .child(div().text_size(11.5).line_height("16px").text_color(t.dim)
        .child("Needs floorplan in Claude Code: claude plugin marketplace add haydenschmitty/floorplan, then claude plugin install floorplan@floorplan."));
  }

  // Only the keys that do something here.
  hints(view) {
    if (this.isPicking) return "↑↓ pick  ·  ↵ chart it  ·  esc back";
    if (!view) return [this.place?.cwd ? "u draw" : "", "p project", "esc close"].filter(Boolean).join("  ·  ");
    const card = this.cardOf(view, this.selected);
    const keys = ["↑↓ pick"];
    if (card?.isOpenable) keys.push("↵ inside");
    if (view.level.focus !== null) keys.push("⌫ up");
    keys.push("p project", "u update");
    if (this.folder && !this.place?.on) keys.push("o browser");
    return [...keys, "esc close"].join("  ·  ");
  }
}
