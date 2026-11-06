// Where each card of a level goes in a panel this wide, and the curve of each line between them:
// layers from top to bottom, what uses a card above it, the outside cards that use the level on
// top and the ones it uses at the bottom, each layer wrapped into rows that fit the width.

export const SIZES = { pad: 14, gap: 10, layerGap: 40, cardHeight: 52, minCardWidth: 132, maxColumns: 4, portInset: 12, arc: 22, arrowLength: 7, arrowWidth: 3.5 };

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const centreX = (box) => box.x + box.w / 2;

export function columnsFor(width) {
  return clamp(Math.floor((width - 2 * SIZES.pad + SIZES.gap) / (SIZES.minCardWidth + SIZES.gap)), 1, SIZES.maxColumns);
}

// The level placed: its cards with x, y, w and h in reading order, its lines as curves, and the
// height it all takes.
export function layOut(level, width) {
  const columns = columnsFor(width);
  const cardWidth = Math.max(60, (width - 2 * SIZES.pad - (columns - 1) * SIZES.gap) / columns);
  const groups = [
    level.outside.filter((card) => card.side === "above"),
    ...layersOf(level.inside, level.lines),
    level.outside.filter((card) => card.side !== "above"),
  ].filter((group) => group.length);
  const placed = new Map();
  const cards = [];
  let y = SIZES.pad;
  groups.forEach((group, index) => {
    if (index > 0) y += SIZES.layerGap - SIZES.gap;
    const ordered = byNeighbours(group, level.lines, placed);
    for (let start = 0; start < ordered.length; start += columns) {
      const row = ordered.slice(start, start + columns);
      let x = (width - (row.length * cardWidth + (row.length - 1) * SIZES.gap)) / 2;
      for (const card of row) {
        const box = { ...card, x, y, w: cardWidth, h: SIZES.cardHeight };
        placed.set(card.id, box);
        cards.push(box);
        x += cardWidth + SIZES.gap;
      }
      y += SIZES.cardHeight + SIZES.gap;
    }
  });
  const curves = curvesOf(level.lines, placed);
  const bottom = Math.max(0, ...cards.map((box) => box.y + box.h), ...curves.flatMap((curve) => [curve.c1[1], curve.c2[1]]));
  return { cards, curves, height: bottom + SIZES.pad };
}

// The inside cards in layers: each card one layer below the deepest card that uses it, with the
// links that close a loop left out, and the cards no inside link touches in the last layer.
function layersOf(cards, lines) {
  const ids = cards.map((card) => card.id);
  const next = new Map(ids.map((id) => [id, []]));
  const hasIn = new Set();
  for (const line of lines) {
    if (!next.has(line.from) || !next.has(line.to)) continue;
    next.get(line.from).push(line.to);
    hasIn.add(line.to);
  }
  const { kept, order } = withoutLoops(ids, next, hasIn);
  const depth = new Map(ids.map((id) => [id, 0]));
  for (const id of order) for (const to of kept.get(id)) depth.set(to, Math.max(depth.get(to), depth.get(id) + 1));
  const isLinked = (id) => next.get(id).length > 0 || hasIn.has(id);
  const deepest = Math.max(0, ...ids.filter(isLinked).map((id) => depth.get(id)));
  const layers = Array.from({ length: deepest + 1 }, () => []);
  for (const card of cards) layers[isLinked(card.id) ? depth.get(card.id) : deepest].push(card);
  return layers;
}

// A walk from the cards nothing uses first: the links that lead back to a card still being walked
// close a loop and are left out. The order the walk finishes in, reversed, puts every card after
// all that use it.
function withoutLoops(ids, next, hasIn) {
  const kept = new Map(ids.map((id) => [id, []]));
  const state = new Map();
  const finished = [];
  const visit = (id) => {
    state.set(id, "walking");
    for (const to of next.get(id)) {
      if (state.get(to) === "walking") continue;
      kept.get(id).push(to);
      if (!state.has(to)) visit(to);
    }
    state.set(id, "done");
    finished.push(id);
  };
  for (const id of [...ids.filter((one) => !hasIn.has(one)), ...ids]) if (!state.has(id)) visit(id);
  return { kept, order: finished.reverse() };
}

// The group with the cards linked to ones already placed moved under the middle of those, each
// among the places such cards hold; the rest stay where they were.
function byNeighbours(group, lines, placed) {
  const centreOf = (card) => {
    const xs = lines
      .flatMap((line) => (line.from === card.id ? [line.to] : line.to === card.id ? [line.from] : []))
      .map((id) => placed.get(id))
      .filter(Boolean)
      .map(centreX);
    return xs.length ? xs.reduce((sum, x) => sum + x, 0) / xs.length : null;
  };
  const keyed = group.map((card, index) => ({ card, index, at: centreOf(card) }));
  const known = keyed.filter((one) => one.at !== null);
  const sorted = [...known].sort((a, b) => a.at - b.at || a.index - b.index);
  const out = group.slice();
  known.forEach((one, k) => {
    out[one.index] = sorted[k].card;
  });
  return out;
}

// Which edges of the two cards a line leaves and reaches: down from the bottom to the top, up from
// the top to the bottom, and along a row from bottom to bottom, under the cards.
function sidesOf(from, to) {
  if (to.y >= from.y + from.h) return ["bottom", "top"];
  if (to.y + to.h <= from.y) return ["top", "bottom"];
  return ["bottom", "bottom"];
}

// Each line as a curve. The lines that meet one edge of a card are spread along it, ordered by
// where their other end is, so they do not all meet in one point.
function curvesOf(lines, placed) {
  const drawn = lines.filter((line) => placed.has(line.from) && placed.has(line.to));
  const ports = new Map();
  const ends = drawn.map((line) => {
    const from = placed.get(line.from);
    const to = placed.get(line.to);
    const [fromSide, toSide] = sidesOf(from, to);
    const start = { box: from, side: fromSide, other: centreX(to) };
    const end = { box: to, side: toSide, other: centreX(from) };
    for (const port of [start, end]) {
      const key = `${port.box.id}:${port.side}`;
      if (!ports.has(key)) ports.set(key, []);
      ports.get(key).push(port);
    }
    return { line, start, end };
  });
  for (const group of ports.values()) {
    group.sort((a, b) => a.other - b.other);
    group.forEach((port, index) => {
      const { box } = port;
      const x = box.x + (box.w * (index + 1)) / (group.length + 1);
      port.x = clamp(x, box.x + SIZES.portInset, box.x + box.w - SIZES.portInset);
      port.y = port.side === "bottom" ? box.y + box.h : box.y;
    });
  }
  return ends.map(({ line, start, end }) => curve(line, start, end));
}

function curve(line, start, end) {
  const isArc = start.side === end.side;
  const reach = isArc ? SIZES.arc : Math.max(16, Math.abs(end.y - start.y) / 2);
  const away = (port) => (port.side === "bottom" ? reach : -reach);
  const c1 = [start.x, start.y + away(start)];
  const c2 = [end.x, end.y + away(end)];
  return { ...line, start: [start.x, start.y], c1, c2, end: [end.x, end.y], arrow: arrowAt([end.x, end.y], c2) };
}

// A small triangle with its tip on the card, pointing the way the curve arrives.
function arrowAt(tip, from) {
  const dx = tip[0] - from[0];
  const dy = tip[1] - from[1];
  const length = Math.hypot(dx, dy) || 1;
  const [ux, uy] = [dx / length, dy / length];
  const back = [tip[0] - ux * SIZES.arrowLength, tip[1] - uy * SIZES.arrowLength];
  return [tip, [back[0] - uy * SIZES.arrowWidth, back[1] + ux * SIZES.arrowWidth], [back[0] + uy * SIZES.arrowWidth, back[1] - ux * SIZES.arrowWidth]];
}
