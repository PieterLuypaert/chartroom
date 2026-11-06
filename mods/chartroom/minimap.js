// The minimap: the level drawn small in a corner of the chart, with a frame round the part of it in
// view, and a point on it turned back into where the view goes. Places on the chart are in the
// points of what moves when the chart is dragged: the heading over a wide view's chart, then the
// cards; `pan` is how far that is moved, so (pan.x, pan.y) is the chart's point at the view's
// top-left corner.

// At most this big, keeping the level's proportions, never thinner than `minSide`, with `pad` of
// the chart's points round the cards. Shown only on a chart area at least `minView` big.
export const MINIMAP = { maxWidth: 180, maxHeight: 120, minSide: 36, pad: 24, minCard: 2, minView: { width: 360, height: 260 } };

export const hasRoomFor = (view) => view.width >= MINIMAP.minView.width && view.height >= MINIMAP.minView.height;

// The level's cards and the view on it, small: each card's place, the frame round what is in view
// (cut at the minimap's edges), and the scale and origin that put the chart on the minimap. `top`
// is how far the cards sit below the top of what moves, `view` the size of the chart's area.
export function minimapOf(cards, { view, pan, top = 0 }) {
  if (!cards.length) return null;
  const x0 = Math.min(...cards.map((card) => card.x)) - MINIMAP.pad;
  const y0 = Math.min(...cards.map((card) => card.y)) + top - MINIMAP.pad;
  const x1 = Math.max(...cards.map((card) => card.x + card.w)) + MINIMAP.pad;
  const y1 = Math.max(...cards.map((card) => card.y + card.h)) + top + MINIMAP.pad;
  const scale = Math.min(MINIMAP.maxWidth / (x1 - x0), MINIMAP.maxHeight / (y1 - y0));
  const width = Math.max(MINIMAP.minSide, (x1 - x0) * scale);
  const height = Math.max(MINIMAP.minSide, (y1 - y0) * scale);
  const origin = { x: (width - (x1 - x0) * scale) / 2 - x0 * scale, y: (height - (y1 - y0) * scale) / 2 - y0 * scale };
  const small = (card) => ({
    id: card.id,
    band: card.band,
    x: origin.x + card.x * scale,
    y: origin.y + (card.y + top) * scale,
    w: Math.max(MINIMAP.minCard, card.w * scale),
    h: Math.max(MINIMAP.minCard, card.h * scale),
  });
  const inView = { x: origin.x + pan.x * scale, y: origin.y + pan.y * scale, w: view.width * scale, h: view.height * scale };
  return { width, height, scale, origin, cards: cards.map(small), inView, viewport: cut(inView, width, height) };
}

// A box cut to the minimap's edges.
function cut(box, width, height) {
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  return { x, y, w: Math.max(0, Math.min(width, box.x + box.w) - x), h: Math.max(0, Math.min(height, box.y + box.h) - y) };
}

// The pan that puts the minimap's point in the middle of a view `view` big.
export function panAt(map, point, view) {
  return { x: (point.x - map.origin.x) / map.scale - view.width / 2, y: (point.y - map.origin.y) / map.scale - view.height / 2 };
}

// How far a press on the minimap is from the middle of the view's frame, when it is on the frame,
// so dragging it moves the frame without a jump; elsewhere none, and the view's middle goes to it.
export function grabOf(map, point) {
  const { viewport, inView } = map;
  const isOnFrame = point.x >= viewport.x && point.x <= viewport.x + viewport.w && point.y >= viewport.y && point.y <= viewport.y + viewport.h;
  if (!isOnFrame) return { x: 0, y: 0 };
  return { x: point.x - (inView.x + inView.w / 2), y: point.y - (inView.y + inView.h / 2) };
}
