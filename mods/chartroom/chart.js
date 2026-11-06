// The Chartroom's drawing, in the look of the Herdr app's own panels: a level as cards with the lines
// between them, and beside or under it the card picked, with what it uses and what uses it.
import { div, svg, PathBuilder } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

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
export function chartView({ t, laid, selected, hovered, onPick, onHover, levelKey, isEntering, isLitEntering, isMoving }) {
  const lines = laid.lines ?? laid.curves;
  const touches = (line, id) => Boolean(id) && (line.from === id || line.to === id);
  const lit = lines.filter((line) => touches(line, selected));
  const hot = lines.filter((line) => !touches(line, selected) && touches(line, hovered));
  const quiet = lines.filter((line) => !touches(line, selected) && !touches(line, hovered));
  const zoom = laid.zoom ?? 1;
  const isElk = Boolean(laid.lines);
  const card = (box) => (isElk ? elkCard : plainCard)(t, box, box.id === selected, onPick, onHover, zoom, laid.direction);
  return div().id(`level-${levelKey}`).relative().when(isElk, (el) => el.w(laid.width)).when(!isElk, (el) => el.w_full()).h(laid.height)
    .opacity(isEntering ? 0 : 1).transition("opacity", FADE)
    .children([
      ...(laid.bands ?? []).map((band) => div().absolute().left(band.x).top(band.y + 9 * zoom).w(band.w).h(1).bg(t.border)),
      ...strokes(quiet, thin(t.dim, quietAlpha(lines.length > BUSY_LINES, Boolean(selected || hovered))), LINE_WIDTH, "lines", isMoving),
      ...strokes(hot, thin(t.accent, "90"), LINE_WIDTH, `hot-${hovered}`, false),
      ...strokes(lit, t.accent, LIT_LINE_WIDTH, `lit-${selected}`, isLitEntering),
      ...laid.cards.map(card),
      ...(isElk ? [...ports(t, [...quiet, ...hot], t.dim, zoom, "ports", isMoving), ...ports(t, lit, t.accent, zoom, `lit-ports-${selected}`, isLitEntering)] : []),
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

// Lines as one layer: right-angled routes with their corners rounded, or curves with arrowheads.
function strokes(lines, color, width, id, isHidden) {
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
  const paths = hasHeads ? [stroke.build(), heads.build()] : [stroke.build()];
  return paths.map((path, index) => window.paint_path(path, color).id(`${id}-${index}`).absolute().top(0).left(0).size_full()
    .opacity(isHidden ? 0 : 1).transition("opacity", FADE));
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

// A small ring where each line meets a card, on the panel's ground.
function ports(t, lines, color, zoom, id, isHidden) {
  if (!lines.length) return [];
  const r = Math.max(2.4, 3.2 * zoom);
  const ring = ([x, y]) => Array.from({ length: 12 }, (_, i) => [x + r * Math.cos((i * Math.PI) / 6), y + r * Math.sin((i * Math.PI) / 6)]);
  let ground = PathBuilder.fill();
  let edge = PathBuilder.stroke(1.2);
  for (const line of lines) {
    for (const point of [line.points[0], line.points.at(-1)]) {
      ground = ground.add_polygon(ring(point), true);
      edge = edge.add_polygon(ring(point), true);
    }
  }
  return [[ground.build(), t.chrome], [edge.build(), color]].map(([path, paint], index) => window.paint_path(path, paint).id(`${id}-${index}`).absolute().top(0).left(0).size_full()
    .opacity(isHidden ? 0 : 1).transition("opacity", FADE));
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
function framed(el, t, box, isSelected, onPick, onHover) {
  return el.id(`card-${box.id}`).absolute().left(box.x).top(box.y).w(box.w).h(box.h)
    .transition("left", GLIDE).transition("top", GLIDE).transition("width", GLIDE)
    .border_1().border_color(isSelected ? t.accent : t.border).cursor_pointer().hover((s) => s.bg(t.hover))
    .tooltip(box.summary || box.label)
    .on_hover((isHovered, cx) => onHover?.(box.id, isHovered, cx))
    .on_click((event, cx) => onPick(box, event.click_count >= 2, cx));
}

const chevron = (t, size) => svg(`${ICONS}/chevron-right.svg`).size(size).flex_none().text_color(t.dim);

// A card on ELK's layout. Inside the part: its icon on a tile, its name, and in a wide view two lines
// of what it does, else what it is. Outside it: a slim pill with its icon and name.
function elkCard(t, box, isSelected, onPick, onHover, zoom, direction) {
  const ground = isSelected ? t.selected : box.isInside && box.kind !== "external" ? t.background : t.chrome;
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

// Under the chart: the card picked, or the level itself while none is.
export function detailsView({ t, details, level, chart, onPick, onOpen }) {
  const body = details ? cardDetails(t, details, onPick, onOpen) : levelDetails(t, level, chart);
  return v_flex().id("details").size_full().overflow_y_scrollbar().px(8).py(8).gap(2).children(body);
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
    div().px(8).pt(6).text_size(11.5).text_color(t.dim).child("Pick a card to see what it uses and what uses it. Double-click one with › to go inside."),
  ];
}

function cardDetails(t, { card, uses, usedBy }, onPick, onOpen) {
  return [
    head(t, card.label, kindOf(card).word, card.isOpenable ? openButton(t, card, onOpen) : null),
    text(t, card.summary),
    ...(card.kind === "file" ? fileFacts(t, card) : []),
    ...section(t, "Uses", uses, "to", onPick),
    ...section(t, "Used by", usedBy, "from", onPick),
  ];
}

// A name and a pill, as the Changes panel heads its list.
function head(t, title, pill, action = null) {
  return h_flex().h(ROW_HEIGHT).flex_none().px(8).gap(8).items_center()
    .child(div().min_w(0).truncate().font_semibold().child(title))
    .when(Boolean(pill), (el) => el.child(div().flex_none().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(pill)))
    .child(div().flex_1())
    .when(Boolean(action), (el) => el.child(action));
}

function text(t, words) {
  return div().px(8).pb(4).text_size(12).line_height("17px").text_color(t.muted).child(words || "No description yet.");
}

function openButton(t, card, onOpen) {
  return h_flex().id("details-open").flex_none().h(24).pl(8).pr(4).gap(2).items_center().rounded(6).text_size(12).text_color(t.muted)
    .hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer().tooltip("Go inside (↵)")
    .on_click((_e, cx) => onOpen(card, cx))
    .child("Inside").child(svg(`${ICONS}/chevron-right.svg`).size(13));
}

function fileFacts(t, card) {
  return [
    div().px(8).pb(4).text_size(11).text_color(t.dim).truncate().child(`${card.path} · ${plural(card.loc, "line")}`),
    ...card.routes.map((route) => h_flex().h(24).flex_none().px(8).gap(8).items_center().text_size(12)
      .child(div().flex_none().px(5).rounded(4).bg(thin(t.accent, "26")).text_size(10.5).font_semibold().text_color(t.accent).child(route.m))
      .child(div().flex_none().max_w(180).truncate().text_color(t.foreground).child(route.p))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(route.name ?? ""))),
  ];
}

// What a card uses or what uses it: each other card on a row, with what the links carry.
function section(t, title, ends, side, onPick) {
  if (!ends.length) return [];
  return [
    div().px(8).pt(8).pb(2).text_size(11).font_medium().text_color(t.dim).child(`${title}  ${ends.length}`),
    ...ends.map(({ card, line }) => h_flex().id(`${side}-${card.id}`).h(ROW_HEIGHT).flex_none().px(8).gap(8).items_center().rounded(7)
      .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => onPick(card, false, cx))
      .child(svg(iconOf(card)).size(13).flex_none().text_color(t.muted))
      .child(div().flex_none().max_w(170).truncate().child(card.label))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(line.labels.join(" · ") || plural(line.weight, "link")))),
  ];
}
