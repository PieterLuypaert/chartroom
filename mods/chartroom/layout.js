// Where each card of a level goes in a panel this wide, and the curve of each line between them:
// layers from top to bottom, what uses a card above it, the outside cards that use the level on
// top and the ones it uses at the bottom, each layer wrapped into rows that fit the width. In a
// wide view the cards keep a width that reads well, and more of them fit on a row.

export const SIZES = { pad: 14, gap: 10, layerGap: 40, cardHeight: 52, minCardWidth: 132, maxCardWidth: 240, maxColumns: 8, portInset: 12, arc: 22, arrowLength: 7, arrowWidth: 3.5 };

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const centreX = (box) => box.x + box.w / 2;

export function columnsFor(width) {
  return clamp(Math.floor((width - 2 * SIZES.pad + SIZES.gap) / (SIZES.minCardWidth + SIZES.gap)), 1, SIZES.maxColumns);
}

// The level placed: its cards with x, y, w and h in reading order, its lines as curves, and the
// height it all takes.
export function layOut(level, width) {
  const columns = columnsFor(width);
  const cardWidth = clamp((width - 2 * SIZES.pad - (columns - 1) * SIZES.gap) / columns, 60, SIZES.maxCardWidth);
  const groups = [
    level.outside.filter((card) => card.side === "above"),
    ...layersOf(level.inside, level.lines),
    level.outside.filter((card) => card.side !== "above"),
  ].filter((group) => group.length);
  const placed = new Map();
  const cards = [];
  const neighbours = neighboursOf(level.lines);
  let y = SIZES.pad;
  groups.forEach((group, index) => {
    if (index > 0) y += SIZES.layerGap - SIZES.gap;
    const ordered = byNeighbours(group, neighbours, placed);
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
// links that point backwards in forwardOrder left out, and the cards no inside link touches in the
// last layer.
function layersOf(cards, lines) {
  const ids = cards.map((card) => card.id);
  const outs = new Map(ids.map((id) => [id, []]));
  const ins = new Map(ids.map((id) => [id, []]));
  for (const line of lines) {
    if (!outs.has(line.from) || !outs.has(line.to)) continue;
    outs.get(line.from).push({ id: line.to, weight: line.weight ?? 1 });
    ins.get(line.to).push({ id: line.from, weight: line.weight ?? 1 });
  }
  const order = forwardOrder(ids, outs, ins);
  const at = new Map(order.map((id, index) => [id, index]));
  const depth = new Map(ids.map((id) => [id, 0]));
  for (const id of order) for (const to of outs.get(id)) if (at.get(to.id) > at.get(id)) depth.set(to.id, Math.max(depth.get(to.id), depth.get(id) + 1));
  const isLinked = (id) => outs.get(id).length > 0 || ins.get(id).length > 0;
  const deepest = Math.max(0, ...ids.filter(isLinked).map((id) => depth.get(id)));
  const layers = Array.from({ length: deepest + 1 }, () => []);
  for (const card of cards) layers[isLinked(card.id) ? depth.get(card.id) : deepest].push(card);
  return layers;
}

// The cards in an order where as little as possible, by the links' weight, points backwards (Eades,
// Lin and Smyth's greedy order): cards that use nothing left go last, cards nothing left uses go
// first, and otherwise the card that uses the most more than it is used goes next. In a loop, the
// lighter way round is the one that gives way. What each card still uses and is used by among the
// cards left is kept up to date as cards are taken, not added up again each round: a level of
// hundreds of cards otherwise takes longer than Herdr lets a view wait.
function forwardOrder(ids, outs, ins) {
  const left = new Set(ids);
  const total = (ends) => ends.reduce((sum, end) => sum + end.weight, 0);
  const uses = new Map(ids.map((id) => [id, total(outs.get(id))]));
  const usedBy = new Map(ids.map((id) => [id, total(ins.get(id))]));
  const take = (id) => {
    left.delete(id);
    for (const end of outs.get(id)) if (left.has(end.id)) usedBy.set(end.id, usedBy.get(end.id) - end.weight);
    for (const end of ins.get(id)) if (left.has(end.id)) uses.set(end.id, uses.get(end.id) - end.weight);
  };
  const head = [];
  // The cards that go last, the one taken last first: taken in turn, each goes before the ones taken before it.
  const tail = [];
  while (left.size) {
    let isMoved = true;
    while (isMoved) {
      isMoved = false;
      for (const id of [...left]) {
        if (uses.get(id) === 0) tail.push(id);
        else if (usedBy.get(id) === 0) head.push(id);
        else continue;
        take(id);
        isMoved = true;
      }
    }
    if (!left.size) break;
    const score = (id) => uses.get(id) - usedBy.get(id);
    const next = [...left].reduce((best, id) => (score(id) > score(best) ? id : best));
    head.push(next);
    take(next);
  }
  return [...head, ...tail.reverse()];
}

// Each card's neighbours: the cards its lines lead to or come from, in the order of the lines.
function neighboursOf(lines) {
  const neighbours = new Map();
  const add = (id, other) => {
    if (!neighbours.has(id)) neighbours.set(id, []);
    neighbours.get(id).push(other);
  };
  for (const line of lines) {
    add(line.from, line.to);
    add(line.to, line.from);
  }
  return neighbours;
}

// The group with the cards linked to ones already placed moved under the middle of those, each
// among the places such cards hold; the rest stay where they were.
function byNeighbours(group, neighbours, placed) {
  const centreOf = (card) => {
    const xs = (neighbours.get(card.id) ?? []).map((id) => placed.get(id)).filter(Boolean).map(centreX);
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

// ---- ELK's layout (draw/lay.js): three bands, lines at right angles

// Each card's size, by the way the chart reads: left to right in a wide view, where cards inside the
// part carry two lines of what they do, and top to bottom in the panel, where they are smaller.
// Outside cards are slim in both.
export const CARD_SIZES = {
  RIGHT: { inside: { w: 236, h: 78 }, outside: { w: 184, h: 36 } },
  DOWN: { inside: { w: 188, h: 50 }, outside: { w: 160, h: 32 } },
};
// The words over each band: what uses the part, what is in it, what it uses.
const BANDS = ["Used by", "Inside", "Uses"];

// An outside service is drawn as outside the part even on the top level, where it is one of the
// app's own nodes: in the band of what is used, as a slim card.
const isOutside = (card) => !card.isInside || card.kind === "external";
export const bandOf = (card) => (isOutside(card) ? (card.side === "above" ? 0 : 2) : 1);
export const sizeOf = (card, direction) => CARD_SIZES[direction][isOutside(card) ? "outside" : "inside"];

// A level as draw/lay.js takes it.
export function elkLevel(key, level, direction) {
  return {
    key,
    direction,
    cards: [...level.inside, ...level.outside].map((card) => ({ id: card.id, band: bandOf(card), ...sizeOf(card, direction) })),
    lines: level.lines.map(({ key: lineKey, from, to }) => ({ key: lineKey, from, to })),
  };
}

// ELK's places as what the chart draws, at `zoom`, in the middle of a view `viewWidth` wide when it
// is narrower: the cards in reading order (band by band, then down, then across), each line's
// corners, and each band's extent and words. A card or line ELK left out is left out.
export function fromElk(level, elk, { zoom = 1, viewWidth = 0, insideLabel = "Inside" } = {}) {
  const width = elk.width * zoom;
  const left = Math.max(0, (viewWidth - width) / 2);
  const at = ([x, y]) => [left + x * zoom, y * zoom];
  const cards = [...level.inside, ...level.outside]
    .filter((card) => elk.cards[card.id])
    .map((card) => {
      const [x, y] = at(elk.cards[card.id]);
      const size = sizeOf(card, elk.direction);
      return { ...card, band: bandOf(card), x, y, w: size.w * zoom, h: size.h * zoom };
    })
    .sort((a, b) => a.band - b.band || (elk.direction === "RIGHT" ? a.y - b.y || a.x - b.x : a.y - b.y || a.x - b.x));
  const lines = level.lines.filter((line) => elk.lines[line.key]).map((line) => ({ ...line, points: elk.lines[line.key].map(at) }));
  return { cards, lines, bands: bandsOf(cards, elk.direction, insideLabel, zoom), width: left + width, height: elk.height * zoom, zoom, direction: elk.direction };
}

// Each band with cards: its words and count, where they go (over the band), and how wide its rule
// under them is.
function bandsOf(cards, direction, insideLabel, zoom) {
  const bands = [];
  for (const band of [0, 1, 2]) {
    const inBand = cards.filter((card) => card.band === band);
    if (!inBand.length) continue;
    const x0 = Math.min(...inBand.map((card) => card.x));
    const x1 = Math.max(...inBand.map((card) => card.x + card.w));
    const y0 = Math.min(...inBand.map((card) => card.y));
    const all = direction === "DOWN" ? { x0: Math.min(...cards.map((card) => card.x)), x1: Math.max(...cards.map((card) => card.x + card.w)) } : { x0, x1 };
    bands.push({ band, label: band === 1 ? insideLabel : BANDS[band], count: inBand.length, x: all.x0, y: Math.max(0, y0 - 24 * zoom), w: all.x1 - all.x0 });
  }
  return bands;
}

// ---- The heading over a level in a wide view

// The heading's sizes at the chart's zoom, as the cards it sits over grow and shrink: what the
// level is (a line in t.muted), its name, and what it does, with room between its lines. Smaller on
// a low screen, where what it does keeps to two lines. The name stops growing at 32px, so a close
// zoom does not turn it into a banner.
export function headingType(zoom = 1, isLow = false) {
  const at = (px) => Math.round(px * zoom * 10) / 10;
  return {
    width: at(760),
    padX: at(20),
    padTop: at(isLow ? 12 : 18),
    padBottom: at(4),
    gap: at(isLow ? 2 : 4),
    kind: at(13),
    name: Math.min(32, at(isLow ? 19 : 24)),
    summary: at(isLow ? 12 : 13),
    summaryLine: at(isLow ? 17 : 20),
    summaryMax: isLow ? at(34) : null,
  };
}

// The details' size: their width beside the chart in a wide view, their height under it in a narrow
// one. The size dragged to, kept between the least and a share of the panel (half its width, 60% of
// its height), so a size dragged on a bigger panel fits the one it is on now; none dragged yet, 340
// wide, or 36% of the height between 150 and 300.
export const DETAILS = { width: 340, minWidth: 260, widthShare: 0.5, minHeight: 120, heightShare: 0.6 };

export function detailsSize({ isWide, panel, dragged = null }) {
  const [size, least, share] = isWide ? [panel.width, DETAILS.minWidth, DETAILS.widthShare] : [panel.height, DETAILS.minHeight, DETAILS.heightShare];
  const wanted = dragged ?? (isWide ? DETAILS.width : Math.min(300, Math.max(150, panel.height * 0.36)));
  return Math.round(Math.min(Math.max(least, size * share), Math.max(least, wanted)));
}
