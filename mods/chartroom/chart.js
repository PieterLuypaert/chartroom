// The Chartroom's drawing, in the look of the Herdr app's own panels: a level as cards with the lines
// between them, and beside or under it the card picked, with what it uses and what uses it.
import { div, svg, PathBuilder } from "gpui-kit";
import { h_flex, Input, Popup, Scrollbar, TextView, v_flex, v_virtual_list } from "gpui-base";
import { MODELS, modelLabel } from "./models.js";

// Herdr's own icons: the app draws no asset reached through the link install.sh makes.
const ICONS = "mods/workspace-chrome";
// Each kind of card: the word under its name and Herdr's icon for it.
const KINDS = {
  ui: { word: "app", icon: "monitor" },
  service: { word: "server", icon: "terminal" },
  worker: { word: "background jobs", icon: "clock" },
  feature: { word: "feature", icon: "folder" },
  library: { word: "shared code", icon: "layers" },
  data: { word: "data", icon: "archive" },
  config: { word: "setup", icon: "settings" },
  test: { word: "tests", icon: "circle-check" },
  external: { word: "outside service", icon: "server" },
  file: { word: "file", icon: "file-text" },
  misc: { word: "other", icon: "folder" },
};
const LINE_WIDTH = 1.2;
// A level with more lines than this draws them faintly until a card is picked or pointed at, so
// its shape reads before its every link does.
const BUSY_LINES = 18;
const LIT_LINE_WIDTH = 1.8;
const ROW_HEIGHT = 28;
const FOUND_ROW = 40;
const FOUND_SHOWN = 10;

const kindOf = (card) => KINDS[card.kind] ?? KINDS.misc;
const iconOf = (card) => `${ICONS}/${kindOf(card).icon}.svg`;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
// A colour, thinly: hex with an alpha, as the agents list draws a label's ground.
const thin = (color, alpha) => (/^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : color);

// The line under a card's name: what it is and how big, or for a file its folder and endpoints.
function subline(card) {
  if (card.kind === "file") {
    const folder = card.path.split("/").slice(-3, -1).join("/");
    return [folder, card.routes.length ? plural(card.routes.length, "endpoint") : ""].filter(Boolean).join(" · ");
  }
  const files = card.stats?.files;
  return files ? `${kindOf(card).word} · ${plural(files, "file")}` : kindOf(card).word;
}

// The level's cards and lines. With ELK's layout (laid.lines): three bands with their words over
// them, lines at right angles with rounded corners meeting each card at a port dot of their own,
// cards inside the part with what they do, and slim pills for the cards outside it. With the plain
// layout (laid.curves) when ELK could not lay the level out: curves with arrows and small cards.
// The picked card's lines are lit and the others step back; a card under the pointer lights its
// own lines too.
//
// Moving runs natively: a level fades in when it is new (`levelKey` changed and `isEntering`), the
// picked card's lines fade in, and cards glide to new places while the view is resized or zoomed,
// the other lines stepping aside meanwhile (`isMoving`) as they are drawn at the new places at once.
//
// An answer shown lights the cards it is about (`lighted`) and the lines between them.
export function chartView({ t, laid, selected, hovered, lighted = new Set(), isInstant = false, onPick, onHover, levelKey, isEntering, isLitEntering, isMoving }) {
  const lines = laid.lines ?? laid.curves;
  const touches = (line, id) => Boolean(id) && (line.from === id || line.to === id);
  const isLighted = (line) => lighted.has(line.from) && lighted.has(line.to);
  const lit = lines.filter((line) => touches(line, selected) || isLighted(line));
  const isLit = new Set(lit);
  const hot = lines.filter((line) => !isLit.has(line) && touches(line, hovered));
  const zoom = laid.zoom ?? 1;
  const isElk = Boolean(laid.lines);
  const isFocused = Boolean(selected || hovered || lighted.size);
  const all = geometryOf(laid, lines, zoom);
  const card = (box) => (isElk ? elkCard : plainCard)(t, { ...box, isLighted: lighted.has(box.id), isInstant }, box.id === selected, onPick, onHover, zoom, laid.direction);
  const litKey = `${selected}-${lighted.size}`;
  return div().id(`level-${levelKey}`).relative().when(isElk, (el) => el.w(laid.width)).when(!isElk, (el) => el.w_full()).h(laid.height)
    .opacity(isEntering ? 0 : 1).transition("opacity", FADE)
    .children([
      ...(laid.bands ?? []).map((band) => div().absolute().left(band.x).top(band.y + 9 * zoom).w(band.w).h(1).bg(t.border)),
      ...painted(all.strokes, thin(t.dim, quietAlpha(lines.length > BUSY_LINES, isFocused)), "lines", isMoving),
      ...painted(strokePaths(hot, LINE_WIDTH), thin(t.accent, "90"), `hot-${hovered}`, false),
      ...painted(strokePaths(lit, LIT_LINE_WIDTH), t.accent, `lit-${litKey}`, isLitEntering),
      ...laid.cards.map(card),
      ...(isElk ? [...painted(all.rings, [t.chrome, t.dim], "ports", isMoving), ...painted(ringPaths(lit, zoom), [t.chrome, t.accent], `lit-ports-${litKey}`, isLitEntering)] : []),
      ...(laid.bands ?? []).map((band) => div().absolute().left(band.x).top(band.y).px(6 * zoom).bg(t.chrome).rounded(4)
        .text_size(11 * zoom).font_medium().text_color(t.dim).child(`${band.label}  ${band.count}`)),
    ]);
}

// How strongly the lines not lit are drawn: fainter on a busy level, and fainter still while a
// card's own lines are lit.
const quietAlpha = (isBusy, isFocused) => (isBusy ? (isFocused ? "26" : "4a") : isFocused ? "60" : "b0");

const FADE = { duration: 180, easing: "ease-out" };
const GLIDE = { duration: 220, easing: "ease-out" };
const RADIUS = 9;

// Every line of a layout and the ring at each of its ends, built once for that layout and kept:
// building them is most of what a busy level takes to draw, and a hover or a pick only draws the
// few lines it lights over them. A path is fixed geometry; its colour is given when it is painted.
const built = new WeakMap();
function geometryOf(laid, lines, zoom) {
  if (!built.has(laid)) built.set(laid, { strokes: strokePaths(lines, LINE_WIDTH), rings: laid.lines ? ringPaths(lines, zoom) : [] });
  return built.get(laid);
}

// A layout's lines built ahead of its first render, where the layout was worked out outside one.
export const prebuildLines = (laid) => geometryOf(laid, laid.lines ?? laid.curves, laid.zoom ?? 1);

// Paths as one layer over the chart, each in its colour (one for all, or one each).
function painted(paths, colors, id, isHidden) {
  return paths.map((path, index) => window.paint_path(path, Array.isArray(colors) ? colors[index] : colors).id(`${id}-${index}`).absolute().top(0).left(0).size_full()
    .opacity(isHidden ? 0 : 1).transition("opacity", FADE));
}

// Lines as paths: right-angled routes with their corners rounded, or curves with arrowheads.
function strokePaths(lines, width) {
  if (!lines.length) return [];
  let stroke = PathBuilder.stroke(width);
  let heads = PathBuilder.fill();
  let hasHeads = false;
  for (const line of lines) {
    if (line.points) stroke = rounded(stroke, line.points);
    else {
      stroke = stroke.move_to(line.start[0], line.start[1]).cubic_bezier_to(line.end[0], line.end[1], line.c1[0], line.c1[1], line.c2[0], line.c2[1]);
      heads = heads.add_polygon(line.arrow, true);
      hasHeads = true;
    }
  }
  return hasHeads ? [stroke.build(), heads.build()] : [stroke.build()];
}

// A route through its corners, each corner a short curve instead of a sharp turn.
function rounded(builder, points) {
  let path = builder.move_to(points[0][0], points[0][1]);
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const into = Math.hypot(cx - px, cy - py);
    const out = Math.hypot(nx - cx, ny - cy);
    if (into < 0.5 || out < 0.5) continue;
    const r = Math.min(RADIUS, into / 2, out / 2);
    path = path.line_to(cx - ((cx - px) / into) * r, cy - ((cy - py) / into) * r).curve_to(cx + ((nx - cx) / out) * r, cy + ((ny - cy) / out) * r, cx, cy);
  }
  const last = points.at(-1);
  return path.line_to(last[0], last[1]);
}

// A small ring where each line meets a card, as two paths: its ground, painted in the panel's
// colour, and its edge. Each ring is a circle of two half arcs, which builds in a quarter of the
// time a twelve-sided polygon took.
function ringPaths(lines, zoom) {
  if (!lines.length) return [];
  const r = Math.max(2.4, 3.2 * zoom);
  const circle = (builder, x, y) => builder.move_to(x + r, y).arc_to(r, r, 0, false, true, x - r, y).arc_to(r, r, 0, false, true, x + r, y).close();
  let ground = PathBuilder.fill();
  let edge = PathBuilder.stroke(1.2);
  for (const line of lines) {
    for (const [x, y] of [line.points[0], line.points.at(-1)]) {
      ground = circle(ground, x, y);
      edge = circle(edge, x, y);
    }
  }
  return [ground.build(), edge.build()];
}

// What a card does, in two lines at most, broken between words to fit its width.
function twoLines(words, width, size) {
  const max = Math.max(8, Math.floor(width / (size * 0.53)));
  const rest = (words || "").split(/\s+/).filter(Boolean);
  let first = "";
  while (rest.length && (first ? first.length + 1 : 0) + rest[0].length <= max) first += (first ? " " : "") + rest.shift();
  return [first || rest.shift() || "", rest.join(" ")].filter(Boolean);
}

// The parts every card shares: its place and size, gliding there, its frame, and picking it.
// A card an answer is about wears the accent too, on a tint of it.
function framed(el, t, box, isSelected, onPick, onHover) {
  return el.id(`card-${box.id}`).absolute().left(box.x).top(box.y).w(box.w).h(box.h)
    .when(!box.isInstant, (card) => card.transition("left", GLIDE).transition("top", GLIDE).transition("width", GLIDE))
    .border_1().border_color(isSelected || box.isLighted ? t.accent : t.border).cursor_pointer().hover((s) => s.bg(t.hover))
    .tooltip(box.summary || box.label)
    .on_hover((isHovered, cx) => onHover?.(box.id, isHovered, cx))
    .on_click((event, cx) => onPick(box, event.click_count >= 2, cx));
}

const chevron = (t, size) => svg(`${ICONS}/chevron-right.svg`).size(size).flex_none().text_color(t.dim);

// A card on ELK's layout. Inside the part: its icon on a tile, its name, and in a wide view two lines
// of what it does, else what it is. Outside it: a slim pill with its icon and name.
function elkCard(t, box, isSelected, onPick, onHover, zoom, direction) {
  const ground = isSelected ? t.selected : box.isLighted ? thin(t.accent, "1c") : box.isInside && box.kind !== "external" ? t.background : t.chrome;
  if (!box.isInside || box.kind === "external") {
    return framed(h_flex(), t, box, isSelected, onPick, onHover).rounded(box.h / 2).bg(ground).px(11 * zoom).gap(7 * zoom).items_center()
      .child(svg(iconOf(box)).size(13 * zoom).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5 * zoom).text_color(t.muted).child(box.label))
      .when(box.isOpenable, (el) => el.child(chevron(t, 11 * zoom)));
  }
  const isTall = direction === "RIGHT";
  const route = box.kind === "file" && isTall ? box.routes?.[0] : null;
  const about = isTall ? twoLines(box.summary || subline(box), box.w - 24 * zoom, 11.8 * zoom).slice(0, route ? 1 : 2) : [subline(box)];
  return framed(v_flex(), t, box, isSelected, onPick, onHover).rounded(9 * zoom).bg(ground).px(11 * zoom).gap(4 * zoom).justify_center()
    .child(h_flex().min_w(0).gap(8 * zoom).items_center()
      .child(div().size(20 * zoom).flex_none().rounded(5 * zoom).bg(t.raised).flex().items_center().justify_center()
        .child(svg(iconOf(box)).size(12 * zoom).text_color(t.muted)))
      .child(div().flex_1().min_w(0).truncate().text_size(13 * zoom).font_semibold().text_color(t.foreground).child(box.label))
      .when(box.isOpenable, (el) => el.child(chevron(t, 12 * zoom))))
    .children(about.map((line) => div().min_w(0).truncate().text_size((isTall ? 11.8 : 11) * zoom).text_color(isTall ? t.muted : t.dim).child(line)))
    .when(Boolean(route), (el) => el.child(routeChip(t, route, box.routes.length - 1, zoom)));
}

// A file's first endpoint as a chip: its method on a tint, its path in the terminals' font, and how
// many more there are.
function routeChip(t, route, more, zoom) {
  return h_flex().min_w(0).gap(6 * zoom).items_center()
    .child(div().flex_none().px(4 * zoom).rounded(3).bg(thin(t.accent, "26")).text_size(9.5 * zoom).font_semibold().text_color(t.accent).child(route.m))
    .child(div().min_w(0).truncate().font_family("JetBrains Mono").text_size(10.5 * zoom).text_color(t.muted).child(route.p))
    .when(more > 0, (el) => el.child(div().flex_none().text_size(10.5 * zoom).text_color(t.dim).child(`+${more}`)));
}

// A card on the plain layout, as the Changes panel draws a file: its icon and name, and under it
// what it is. An outside card sits on the panel's ground. A double click opens a card that holds
// more.
function plainCard(t, box, isSelected, onPick, onHover) {
  const isInside = box.isInside;
  return framed(v_flex(), t, box, isSelected, onPick, onHover).px(10).gap(2).justify_center().rounded(8)
    .bg(isSelected ? t.selected : isInside ? t.background : t.chrome)
    .child(h_flex().min_w(0).gap(6).items_center()
      .child(svg(iconOf(box)).size(13).flex_none().text_color(isInside ? t.muted : t.dim))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_medium().text_color(isInside ? t.foreground : t.muted).child(box.label))
      .when(box.isOpenable, (el) => el.child(chevron(t, 12))))
    .child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(subline(box)));
}

// The level small in the chart's bottom-left corner (minimap.js places it): each card a block, the
// cards inside the part stronger than those outside it, the picked card and those an answer is about
// in the accent, and a frame round the part in view. A press on it moves the view there.
export function minimapView({ t, map, selected, lighted = new Set(), isDragging, onPress, onHover }) {
  const ground = (card) => (card.id === selected || lighted.has(card.id) ? t.accent : card.band === 1 ? t.dim : t.border);
  const { viewport } = map;
  return div().id("minimap").absolute().left(12).bottom(12).w(map.width).h(map.height).overflow_hidden()
    .rounded(6).border_1().border_color(t.border).bg(t.background)
    .when(isDragging, (el) => el.cursor_grabbing())
    .when(!isDragging, (el) => el.cursor_pointer())
    .on_mouse_down("left", (e, cx) => onPress(e, cx))
    .on_hover((isHovered, cx) => onHover(isHovered, cx))
    .children(map.cards.map((card) => div().absolute().left(card.x).top(card.y).w(card.w).h(card.h).rounded(1.5).bg(ground(card))))
    .when(viewport.w > 0 && viewport.h > 0, (el) => el.child(div().absolute().left(viewport.x).top(viewport.y).w(viewport.w).h(viewport.h)
      .rounded(3).border_1().border_color(t.accent).bg(thin(t.accent, "18"))));
}

// Beside or under the chart: the card picked, or the level itself while none is, the answers to
// what was asked about that card (or level), and at the foot a field to ask the person's own Claude
// about it.
// The details' type: text to read at Herdr's own 13px with room between its lines, labels a step
// under it, and nothing under 11px. Herdr scales a mod's sizes with its zoom, the person's one
// setting for larger panels.
const TYPE = { read: 13, readLine: "20px", strong: 13, label: 12, labelLine: "16px", small: 11 };

export function detailsView({ t, details, level, chart, onPick, onOpen, ask, explain }) {
  const body = details ? cardDetails(t, details, onPick, onOpen, explain) : levelDetails(t, level, chart);
  return v_flex().size_full().min_h(0)
    .child(v_flex().id("details").flex_1().min_h(0).overflow_y_scrollbar().px(8).py(8).gap(2).children(body)
      .children(answers(t, ask)))
    .child(askBar(t, ask));
}

const stopPress = (_e, cx) => cx.stop_propagation();

// A heading over a list in the panel: what it is and how many.
const heading = (t, words) => div().px(8).pt(8).pb(2).text_size(TYPE.small).font_medium().text_color(t.muted).child(words);

function answers(t, ask) {
  if (!ask.asks.length) return [];
  return [
    heading(t, `Asked  ${ask.asks.length}`).pt(10),
    ...ask.asks.map((one) => answerCard(t, one, ask)),
  ];
}

// A question and its answer: Claude's words, still coming, or why there are none. A click lights
// the cards it is about on the chart, and again puts them out.
function answerCard(t, one, ask) {
  const isShown = ask.shownId === one.id;
  const body = one.status === "done" ? div().text_size(TYPE.read).line_height(TYPE.readLine).text_color(t.muted).child(TextView.markdown(`answer-text-${one.id}`, one.answer || ""))
    : one.status === "asking" ? h_flex().gap(6).items_center().text_size(TYPE.label).text_color(t.dim).child(svg(`${ICONS}/spinner.svg`).size(11).spin(900)).child("Your Claude is reading the code…")
      : div().text_size(TYPE.label).text_color(t.blocked).child(one.status === "stopped" ? "Stopped." : `No answer: ${one.error ?? "for no reason it gave"}`);
  return v_flex().id(`answer-${one.id}`).mx(2).my(3).px(10).py(8).gap(6).rounded(8).border_1().border_color(isShown ? t.accent : t.border).bg(t.background)
    .when(one.status === "done" && (one.cards?.length ?? 0) > 0, (el) => el.cursor_pointer().hover((s) => s.border_color(t.accent)).on_click((_e, cx) => ask.onShow(one, cx)))
    .child(h_flex().gap(6).items_start()
      .child(div().flex_1().min_w(0).text_size(TYPE.strong).font_medium().text_color(t.foreground).child(one.question))
      .when("model" in one, (el) => el.child(div().flex_none().pt(1).text_size(TYPE.small).text_color(t.dim).child(modelLabel(one.model))))
      .when(one.status === "asking", (el) => el.child(div().id(`stop-${one.id}`).flex_none().text_size(TYPE.small).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", stopPress).on_click((_e, cx) => ask.onStop(one, cx)).child("Stop"))))
    .child(body)
    .when(one.status === "done" && (one.cards?.length ?? 0) > 0, (el) => el.child(div().text_size(TYPE.small).text_color(isShown ? t.accent : t.dim)
      .child(isShown ? `Lit on the chart: ${one.cards.length}` : `${one.cards.length} on the chart: click to light them`)));
}

// The field at the foot: what it asks about, and Enter or the button to ask.
function askBar(t, ask) {
  if (!ask.canAsk) return div().flex_none().px(14).py(8).border_t(1).border_color(t.border).text_size(TYPE.label).text_color(t.dim).child(ask.reason);
  return v_flex().flex_none().px(10).pt(6).pb(10).gap(5).border_t(1).border_color(t.border)
    .child(div().px(2).text_size(TYPE.small).text_color(t.dim).truncate().child(`Ask your Claude about ${ask.subject}`))
    .child(h_flex().gap(6)
      .child(div().id("ask-field").flex_1().min_w(0).h(30).px(10).flex().items_center().rounded(8).border_1().border_color(ask.isTyping ? t.accent : t.border)
        .cursor_text().on_mouse_down("left", stopPress).child(Input.new(ask.field).h_full().text_size(TYPE.read).text_color(t.foreground)))
      .child(modelPicker(t, ask))
      .child(div().id("ask").flex_none().h(30).px(12).flex().items_center().rounded(8).bg(t.solid).text_color(t.solid_foreground).text_size(TYPE.label).cursor_pointer()
        .on_mouse_down("left", stopPress).on_click((_e, cx) => ask.onAsk(cx)).child("Ask")));
}

// The model the question is asked on: a button in the ask bar's look, showing the choice, that
// opens the list over it, each model a row as the project picker draws them, the chosen one checked.
// The open state is the panel's own: a click on the button opens the list, Up, Down, Enter and
// Escape are the list's, and a press anywhere outside it closes it (and goes no further, so a press
// on the button closes it rather than opening it again).
function modelPicker(t, ask) {
  const chosen = MODELS.find((one) => one.id === ask.model) ?? MODELS[0];
  const trigger = h_flex().id("ask-model").flex_none().h(30).px(10).gap(5).items_center().rounded(8).border_1()
    .border_color(ask.isModelOpen ? t.accent : t.border).text_size(TYPE.label).text_color(ask.isModelOpen ? t.foreground : t.muted)
    .role("combo_box").cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("The model your question is asked on (m)")
    .on_click((_e, cx) => ask.onModelOpen(true, cx))
    .child(chosen.label)
    .child(svg(`${ICONS}/chevron-down.svg`).size(12));
  const row = (one, index) => h_flex().id(`ask-model-${index}`).h(ROW_HEIGHT).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer()
    .role("list_box_option").when(index === ask.modelCursor, (el) => el.bg(t.selected).aria_active_descendant()).hover((s) => s.bg(t.hover))
    .on_mouse_down("left", stopPress)
    .on_click((_e, cx) => ask.onModel(one.id, cx))
    .child(div().flex_1().text_size(TYPE.label).text_color(t.foreground).child(one.label))
    .child(one.id === chosen.id ? svg(`${ICONS}/check.svg`).size(13).flex_none().text_color(t.accent) : div().w(13).flex_none());
  const list = v_flex().id("ask-models").role("list_box").track_focus(ask.modelList).w(170).p(4).gap(1).rounded(8).border_1().border_color(t.border).bg(t.background)
    .on_key_down((e, cx) => ask.onModelKey(e, cx))
    .on_mouse_down_out((_e, cx) => {
      cx.stop_propagation();
      ask.onModelOpen(false, cx);
    })
    .child(div().px(8).pt(2).pb(2).text_size(TYPE.small).font_medium().text_color(t.muted).child("Ask on"))
    .children(MODELS.map(row));
  return Popup.new("ask-model-list", trigger).anchor("bottom_right").when(ask.isModelOpen, (el) => el.content(list));
}

function levelDetails(t, level, chart) {
  const part = level.focus === null ? null : level.trail.at(-1);
  const summary = part ? chart.nodes.get(level.focus)?.summary : chart.summary;
  const parts = level.inside.filter((card) => card.kind !== "file").length;
  const files = level.inside.length - parts;
  const counts = [parts ? plural(parts, "part") : "", files ? plural(files, "file") : ""].filter(Boolean).join(" · ");
  return [
    head(t, part?.label ?? chart.name, counts),
    text(t, summary || ""),
    div().px(8).pt(6).text_size(TYPE.label).line_height(TYPE.labelLine).text_color(t.dim).child("Pick a card to see what it uses and what uses it. Double-click one with › to go inside."),
  ];
}

function cardDetails(t, { card, uses, usedBy }, onPick, onOpen, explain) {
  return [
    head(t, card.label, kindOf(card).word, card.isOpenable ? openButton(t, card, onOpen) : null),
    text(t, card.summary),
    ...explained(t, explain),
    ...(card.kind === "file" ? fileFacts(t, card) : []),
    ...section(t, "Uses", uses, "to", onPick),
    ...section(t, "Used by", usedBy, "from", onPick),
  ];
}

// The picked card explained by the person's own Claude: a button to ask for it, on its way, its
// words (Markdown), or why there are none, with a button to try again.
function explained(t, explain) {
  const one = explain?.record;
  if (!one) return [];
  if (one.status === "none" || one.status === "failed" || one.status === "stopped") {
    return [v_flex().mx(4).mt(6).mb(4).gap(5)
      .when(one.status !== "none", (el) => el.child(div().px(4).text_size(TYPE.label).text_color(t.dim).child(`Not explained: ${one.error ?? "it stopped"}`)))
      .child(h_flex().id("explain").min_h(48).px(10).py(8).gap(10).items_center().rounded(10).border_1().border_color(thin(t.accent, "55")).bg(thin(t.accent, "10"))
        .cursor_pointer().hover((s) => s.bg(thin(t.accent, "22")).border_color(t.accent))
        .on_mouse_down("left", stopPress).on_click((_e, cx) => explain.onExplain(cx))
        .child(div().size(28).flex_none().rounded(7).bg(thin(t.accent, "2e")).flex().items_center().justify_center()
          .child(svg(`${ICONS}/${one.status === "none" ? "search" : "square-pen"}.svg`).size(14).text_color(t.accent)))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(TYPE.strong).font_semibold().text_color(t.accent).child(one.status === "none" ? "Explain this" : "Try again"))
          .child(div().text_size(TYPE.label).line_height(TYPE.labelLine).text_color(t.muted).child("Your Claude reads it: what it does, how it works, what to watch out for")))
        .child(div().flex_none().px(6).py(1).rounded(5).border_1().border_color(t.border).bg(t.background).text_size(TYPE.small).font_medium().text_color(t.muted).child("e")))];
  }
  const body = one.status === "done" ? div().text_size(TYPE.read).line_height(TYPE.readLine).text_color(t.foreground).child(TextView.markdown(`explained-${one.id ?? one.card}`, one.answer || ""))
    : one.status === "asking" ? h_flex().gap(6).items_center().text_size(TYPE.label).text_color(t.dim).child(svg(`${ICONS}/spinner.svg`).size(11).spin(900)).child("Your Claude is reading it…")
      : div().text_size(TYPE.label).text_color(t.dim).child(`Not explained: ${one.error ?? "it stopped"}`);
  return [v_flex().mx(4).mt(6).mb(4).px(11).py(9).gap(6).rounded(8).border_1().border_color(thin(t.accent, "55")).bg(thin(t.accent, "12"))
    .child(h_flex().gap(6).items_center()
      .child(div().size(6).flex_none().rounded_full().bg(t.accent))
      .child(div().flex_1().text_size(TYPE.small).font_medium().text_color(t.accent).child(one.model ? `Explained by your Claude · ${modelLabel(one.model)}` : "Explained by your Claude"))
      .when(one.status === "done" && (one.cards?.length ?? 0) > 0, (el) => el.child(div().flex_none().text_size(TYPE.small).text_color(t.dim).child(`${one.cards.length} lit on the chart`))))
    .child(body)];
}

// A name and a pill, as the Changes panel heads its list.
function head(t, title, pill, action = null) {
  return h_flex().min_h(ROW_HEIGHT).flex_none().px(8).gap(8).items_center()
    .child(div().min_w(0).truncate().font_semibold().child(title))
    .when(Boolean(pill), (el) => el.child(div().flex_none().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(TYPE.small).text_color(t.muted).child(pill)))
    .child(div().flex_1())
    .when(Boolean(action), (el) => el.child(action));
}

function text(t, words) {
  return div().px(8).pb(4).text_size(TYPE.read).line_height(TYPE.readLine).text_color(t.muted).child(words || "No description yet.");
}

function openButton(t, card, onOpen) {
  return h_flex().id("details-open").flex_none().h(24).pl(8).pr(4).gap(2).items_center().rounded(6).text_size(TYPE.label).text_color(t.muted)
    .hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer().tooltip("Go inside (↵)")
    .on_click((_e, cx) => onOpen(card, cx))
    .child("Inside").child(svg(`${ICONS}/chevron-right.svg`).size(13));
}

function fileFacts(t, card) {
  return [
    div().px(8).pb(4).text_size(TYPE.small).text_color(t.dim).truncate().child(`${card.path} · ${plural(card.loc, "line")}`),
    ...card.routes.map((route) => h_flex().min_h(24).flex_none().px(8).gap(8).items_center().text_size(TYPE.label)
      .child(div().flex_none().px(5).rounded(4).bg(thin(t.accent, "26")).text_size(TYPE.small).font_semibold().text_color(t.accent).child(route.m))
      .child(div().flex_none().max_w(180).truncate().text_color(t.foreground).child(route.p))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(route.name ?? ""))),
  ];
}

// What a card uses or what uses it: each other card on a row, with what the links carry.
function section(t, title, ends, side, onPick) {
  if (!ends.length) return [];
  return [
    heading(t, `${title}  ${ends.length}`),
    ...ends.map(({ card, line }) => h_flex().id(`${side}-${card.id}`).min_h(ROW_HEIGHT).flex_none().px(8).gap(8).items_center().rounded(7)
      .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => onPick(card, false, cx))
      .child(svg(iconOf(card)).size(13).flex_none().text_color(t.muted))
      .child(div().flex_none().max_w(170).truncate().child(card.label))
      .child(div().flex_1().min_w(0).truncate().text_size(TYPE.label).text_color(t.dim).child(line.labels.join(" · ") || plural(line.weight, "link")))),
  ];
}

// The search field's own keys. A text field binds Up and Down to moving its cursor, and its binding
// takes the key before the panel's on_key_down hears it, so the search binds them, and Escape, to
// actions of its own for a text field inside its context: at the same depth the binding added last
// wins. main.js installs them with cx.bind_keys.
const SEARCH_CONTEXT = "ChartroomSearch";
export const SEARCH_KEYS = [
  { keystroke: "up", action: "chartroom_found_up", context: `${SEARCH_CONTEXT} > Input` },
  { keystroke: "down", action: "chartroom_found_down", context: `${SEARCH_CONTEXT} > Input` },
  { keystroke: "escape", action: "chartroom_search_close", context: `${SEARCH_CONTEXT} > Input` },
];

// The search in the header, beside the project button: closed, a field-like button that opens it
// (as `/` does), with a `/` keycap to teach the key; open, the same box holding the field, its keys
// those of SEARCH_KEYS, and under it a dropdown over the chart of what it finds. The box wants 220px
// (320px open) and is the first to give way when the header is short, down to its icon.
export function searchBox({ t, field, isOpen, query, found, cursor, width, scroll, onOpen, onPick, onMove, onClose }) {
  const box = h_flex().id("search-box").key_context(SEARCH_CONTEXT).size_full().px(7).gap(6).items_center()
    .rounded(6).border_1().overflow_hidden().text_size(11.5)
    .on_mouse_down("left", stopPress)
    .child(svg(`${ICONS}/search.svg`).size(13).flex_none().text_color(t.muted));
  const popup = (trigger) => Popup.new("search", trigger).w(isOpen ? 320 : 220).flex_shrink(8).min_w(28).h(24);
  if (!isOpen) {
    return popup(box.border_color(t.border).text_color(t.muted).cursor_pointer().role("button")
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Search the chart (/)")
      .on_click((_e, cx) => onOpen(cx))
      .child(div().flex_1().min_w(0).truncate().child("Search"))
      .child(div().flex_none().h(16).px(4).flex().items_center().rounded(4).border_1().border_color(t.border).text_size(10.5).text_color(t.dim).child("/")));
  }
  const withField = box.border_color(t.accent).cursor_text().role("combo_box")
    .on_action("chartroom_found_up", (_e, cx) => onMove(-1, cx))
    .on_action("chartroom_found_down", (_e, cx) => onMove(1, cx))
    .on_action("chartroom_search_close", (_e, cx) => onClose(cx))
    .child(div().flex_1().min_w(0).h_full().flex().items_center().child(Input.new(field).h_full().text_size(12).text_color(t.foreground)));
  return popup(withField).anchor("top_left").content(foundList({ t, query, found, cursor, width, scroll, onPick }));
}

// What the search finds, in the dropdown under its box: each card a row of two lines, its kind's
// icon, its name, an endpoint's route and what it is, then where it sits. The row under the cursor
// is lit; at most ten show, and past that the list scrolls, by the wheel or to keep the cursor's
// row in view (`scroll`, a VirtualListScrollHandle main.js moves). A row picks on its click, which
// a virtual list reports for the list by the row's key.
function foundList({ t, query, found, cursor, width, scroll, onPick }) {
  const frame = dropdownFrame(t, "found", width);
  if (found.length === 0) {
    const words = query.trim() ? "Nothing on the chart matches." : "A part's or file's name, a folder or file path, or a route such as GET /orders.";
    return frame.child(div().px(8).py(6).text_size(TYPE.label).line_height(TYPE.labelLine).text_color(t.dim).child(words));
  }
  const row = (one, index) => h_flex().id(`found-${index}`).w_full().h(FOUND_ROW).flex_none().px(8).gap(10).items_center().rounded(6).cursor_pointer()
    .role("list_box_option").when(index === cursor, (el) => el.bg(t.selected).aria_active_descendant()).hover((s) => s.bg(t.hover))
    .child(svg(iconOf({ kind: one.kind === "endpoint" ? "file" : one.kind })).size(14).flex_none().text_color(t.muted))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(h_flex().min_w(0).gap(8).items_center()
        .child(div().flex_shrink_1().min_w(0).truncate().text_size(TYPE.label).text_color(t.foreground).child(one.label))
        .when(Boolean(one.route), (el) => el.child(div().flex_shrink_1().min_w(0).max_w(200).child(routeChip(t, one.route, 0, 1))))
        .child(div().flex_1())
        .child(div().flex_none().text_size(TYPE.small).text_color(t.dim).child(one.kind === "endpoint" ? "endpoint" : kindOf(one).word)))
      .child(div().min_w(0).truncate().text_size(TYPE.small).text_color(t.dim).child(one.where)));
  // A row's key leads with its place, as an endpoint shares its file's ref.
  const rows = v_virtual_list("found-rows", found.length, FOUND_ROW, (index) => `${index} ${found[index].ref}`,
    (range) => found.slice(range.start, range.end).map((one, offset) => row(one, range.start + offset)))
    .size_full().track_scroll(scroll)
    .on_item_click((key, cx) => onPick(found[Number(key.slice(0, key.indexOf(" ")))], cx));
  return frame.child(v_flex().relative().h(Math.min(found.length, FOUND_SHOWN) * FOUND_ROW)
    .child(rows)
    .child(Scrollbar.vertical("found-rows").absolute().inset_0()));
}

// The frame of a dropdown over the chart, the search's and the project picker's: 4px under what
// opens it, `width` wide, its lists scrolling inside it. A press inside goes no further.
export function dropdownFrame(t, id, width) {
  return v_flex().id(id).role("list_box").w(width).mt(4).p(4).rounded(8).border_1().border_color(t.border)
    .bg(t.background).shadow_lg()
    .on_mouse_down("left", stopPress);
}
