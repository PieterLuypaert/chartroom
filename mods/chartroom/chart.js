// The Chartroom's drawing, in the look of the Herdr app's own panels: a level as cards with curved
// lines between them, and under it the card picked, with what it uses and what uses it.
import { div, svg, PathBuilder } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

// Herdr's own icons: the app draws no asset reached through the link install.sh makes.
const ICONS = "mods/workspace-chrome";
// Each kind of card: the word under its name and Herdr's icon for it.
const KINDS = {
  ui: { word: "app", icon: "monitor" },
  service: { word: "server", icon: "server" },
  worker: { word: "background jobs", icon: "clock" },
  feature: { word: "feature", icon: "folder" },
  library: { word: "shared code", icon: "layers" },
  data: { word: "data", icon: "archive" },
  config: { word: "setup", icon: "settings" },
  test: { word: "tests", icon: "circle-check" },
  external: { word: "outside service", icon: "square" },
  file: { word: "file", icon: "file-text" },
  misc: { word: "other", icon: "folder" },
};
const LINE_WIDTH = 1.2;
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

// The level's cards and lines, at the places layOut gave them. The lines of the card picked are
// drawn over the others in the accent colour.
export function chartView({ t, laid, selected, onPick }) {
  const isLit = (curve) => curve.from === selected || curve.to === selected;
  return div().relative().w_full().h(laid.height)
    .children([
      ...lineLayers(laid.curves.filter((curve) => !isLit(curve)), thin(t.dim, "a0"), LINE_WIDTH),
      ...lineLayers(laid.curves.filter(isLit), t.accent, LIT_LINE_WIDTH),
      ...laid.cards.map((box) => cardView(t, box, box.id === selected, onPick)),
    ]);
}

function lineLayers(curves, color, width) {
  if (!curves.length) return [];
  let stroke = PathBuilder.stroke(width);
  let heads = PathBuilder.fill();
  for (const { start, c1, c2, end, arrow } of curves) {
    stroke = stroke.move_to(start[0], start[1]).cubic_bezier_to(end[0], end[1], c1[0], c1[1], c2[0], c2[1]);
    heads = heads.add_polygon(arrow, true);
  }
  return [stroke.build(), heads.build()].map((path) => window.paint_path(path, color).absolute().top(0).left(0).size_full());
}

// A card as the Changes panel draws a file: its icon and name, and under it what it is. An outside
// card sits on the panel's ground instead of a card's. A double click opens a card that holds more.
function cardView(t, box, isSelected, onPick) {
  const isInside = box.isInside;
  return v_flex().id(`card-${box.id}`).absolute().left(box.x).top(box.y).w(box.w).h(box.h).px(10).gap(2).justify_center()
    .rounded(8).border_1().border_color(isSelected ? t.accent : t.border).bg(isSelected ? t.selected : isInside ? t.background : t.chrome)
    .cursor_pointer().hover((s) => s.bg(t.hover))
    .tooltip(box.summary || box.label)
    .on_click((event, cx) => onPick(box, event.click_count >= 2, cx))
    .child(h_flex().min_w(0).gap(6).items_center()
      .child(svg(iconOf(box)).size(13).flex_none().text_color(isInside ? t.muted : t.dim))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_medium().text_color(isInside ? t.foreground : t.muted).child(box.label))
      .when(box.isOpenable, (el) => el.child(svg(`${ICONS}/chevron-right.svg`).size(12).flex_none().text_color(t.dim))))
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
