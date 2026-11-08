import { describe, expect, test } from "bun:test";
import { grabOf, hasRoomFor, isWorthShowing, MINIMAP, minimapOf, panAt, shadeOf } from "../mods/chartroom/minimap.js";

// Two cards whose box, padded, is 1000 by 300 from the chart's top-left corner.
const WIDE = [
  { id: "a", band: 1, x: 24, y: 24, w: 200, h: 80 },
  { id: "b", band: 2, x: 776, y: 246, w: 200, h: 30 },
];
const VIEW = { width: 500, height: 150 };

const expectBox = (box, expected) => {
  for (const key of Object.keys(expected)) expect(box[key]).toBeCloseTo(expected[key]);
};

describe("minimapOf", () => {
  test("has nothing to draw without cards", () => {
    expect(minimapOf([], { view: VIEW, pan: { x: 0, y: 0 } })).toBeNull();
  });

  test("fits a wide level in the width, keeping its proportions", () => {
    const map = minimapOf(WIDE, { view: VIEW, pan: { x: 0, y: 0 } });
    expect(map.width).toBeCloseTo(MINIMAP.maxWidth);
    expect(map.height).toBeCloseTo(54);
    expect(map.scale).toBeCloseTo(0.18);
    expectBox(map.cards[0], { x: 4.32, y: 4.32, w: 36, h: 14.4 });
    expect(map.cards.map((card) => [card.id, card.band])).toEqual([["a", 1], ["b", 2]]);
  });

  test("keeps a tall level at least its least width, in the middle of it", () => {
    const map = minimapOf([{ id: "a", band: 1, x: 24, y: 24, w: 52, h: 952 }], { view: VIEW, pan: { x: 0, y: 0 } });
    expect(map.width).toBe(MINIMAP.minSide);
    expect(map.height).toBeCloseTo(MINIMAP.maxHeight);
    const [card] = map.cards;
    expect(card.x + card.w / 2).toBeCloseTo(map.width / 2);
  });

  test("never draws a card smaller than a speck", () => {
    const map = minimapOf([...WIDE, { id: "tiny", band: 0, x: 500, y: 100, w: 4, h: 4 }], { view: VIEW, pan: { x: 0, y: 0 } });
    const tiny = map.cards.find((card) => card.id === "tiny");
    expect(tiny.w).toBe(MINIMAP.minCard);
    expect(tiny.h).toBe(MINIMAP.minCard);
  });

  test("frames the part of the chart in view, moved and sized with it", () => {
    const map = minimapOf(WIDE, { view: VIEW, pan: { x: 250, y: 75 } });
    expectBox(map.viewport, { x: 45, y: 13.5, w: 90, h: 27 });
  });

  test("cuts the frame at the edges when the chart is dragged past them", () => {
    const map = minimapOf(WIDE, { view: VIEW, pan: { x: -200, y: 0 } });
    expectBox(map.viewport, { x: 0, y: 0, w: 54, h: 27 });
  });

  test("leaves the cards where they are under a heading, and shows the heading taking part of the view", () => {
    const plain = minimapOf(WIDE, { view: { width: 1000, height: 300 }, pan: { x: 0, y: 0 } });
    const headed = minimapOf(WIDE, { view: { width: 1000, height: 300 }, pan: { x: 0, y: 0 }, top: 130 });
    const { x, y, w, h } = plain.cards[0];
    expectBox(headed.cards[0], { x, y, w, h });
    expectBox(headed.viewport, { x: 0, y: 0, w: 180, h: 30.6 });
  });
});

describe("panAt", () => {
  test("puts the minimap's point in the middle of the view", () => {
    const map = minimapOf(WIDE, { view: VIEW, pan: { x: 0, y: 0 } });
    const pan = panAt(map, { x: 90, y: 27 }, VIEW);
    expect(pan.x).toBeCloseTo(250);
    expect(pan.y).toBeCloseTo(75);
  });

  test("gives back the pan from the middle of its own frame", () => {
    const pan = { x: 320, y: 40 };
    const map = minimapOf(WIDE, { view: VIEW, pan, top: 130 });
    const back = panAt(map, { x: map.inView.x + map.inView.w / 2, y: map.inView.y + map.inView.h / 2 }, VIEW);
    expect(back.x).toBeCloseTo(pan.x);
    expect(back.y).toBeCloseTo(pan.y);
  });
});

describe("grabOf", () => {
  const moveTo = (map, point) => {
    const grab = grabOf(map, point);
    return panAt(map, { x: point.x - grab.x, y: point.y - grab.y }, VIEW);
  };

  test("keeps the view still on a press on its frame", () => {
    const map = minimapOf(WIDE, { view: VIEW, pan: { x: 250, y: 75 } });
    const pan = moveTo(map, { x: 60, y: 20 });
    expect(pan.x).toBeCloseTo(250);
    expect(pan.y).toBeCloseTo(75);
  });

  test("keeps it still on a frame cut at the edge too", () => {
    const map = minimapOf(WIDE, { view: VIEW, pan: { x: -200, y: 0 } });
    const pan = moveTo(map, { x: 5, y: 10 });
    expect(pan.x).toBeCloseTo(-200);
    expect(pan.y).toBeCloseTo(0);
  });

  test("moves the view's middle to a press beside the frame", () => {
    const map = minimapOf(WIDE, { view: VIEW, pan: { x: 250, y: 75 } });
    expect(grabOf(map, { x: 170, y: 50 })).toEqual({ x: 0, y: 0 });
    const pan = moveTo(map, { x: 171, y: 45 });
    expect(pan.x).toBeCloseTo(171 / 0.18 - 250);
    expect(pan.y).toBeCloseTo(45 / 0.18 - 75);
  });
});

describe("hasRoomFor", () => {
  test("wants a chart area big enough to spare a corner", () => {
    expect(hasRoomFor({ width: 900, height: 600 })).toBe(true);
    expect(hasRoomFor({ width: 300, height: 600 })).toBe(false);
    expect(hasRoomFor({ width: 900, height: 200 })).toBe(false);
  });
});

describe("isWorthShowing", () => {
  const shows = (view, pan) => isWorthShowing(minimapOf(WIDE, { view, pan }));

  test("leaves the minimap out with the whole level in view, or all but a sliver of it", () => {
    expect(shows({ width: 1000, height: 300 }, { x: 0, y: 0 })).toBe(false);
    expect(shows({ width: 950, height: 290 }, { x: 0, y: 0 })).toBe(false);
  });

  test("shows it with only the top half of the level in view", () => {
    expect(shows({ width: 1000, height: 150 }, { x: 0, y: 0 })).toBe(true);
  });

  test("shows it zoomed in on a corner", () => {
    expect(shows({ width: 300, height: 100 }, { x: 700, y: 200 })).toBe(true);
  });

  test("measures the level, not the room round it or the minimap's least width", () => {
    const tall = [{ id: "a", band: 1, x: 24, y: 24, w: 52, h: 952 }];
    expect(isWorthShowing(minimapOf(tall, { view: { width: 100, height: 1000 }, pan: { x: 0, y: 0 } }))).toBe(false);
    expect(isWorthShowing(minimapOf(tall, { view: { width: 100, height: 400 }, pan: { x: 0, y: 0 } }))).toBe(true);
  });
});

describe("shadeOf", () => {
  test("shades the minimap round the part in view: above, below, and either side of it", () => {
    const map = minimapOf(WIDE, { view: VIEW, pan: { x: 250, y: 75 } });
    const boxes = shadeOf(map);
    expect(boxes).toHaveLength(4);
    [{ x: 0, y: 0, w: 180, h: 13.5 }, { x: 0, y: 40.5, w: 180, h: 13.5 }, { x: 0, y: 13.5, w: 45, h: 27 }, { x: 135, y: 13.5, w: 45, h: 27 }].forEach((box, index) => expectBox(boxes[index], box));
  });

  test("leaves out the sides the view reaches, when it is dragged past an edge", () => {
    const boxes = shadeOf(minimapOf(WIDE, { view: VIEW, pan: { x: -200, y: 0 } }));
    expect(boxes).toHaveLength(2);
    expectBox(boxes[0], { x: 0, y: 27, w: 180, h: 27 });
    expectBox(boxes[1], { x: 54, y: 0, w: 126, h: 27 });
  });

  test("shades all of it with the view off the level", () => {
    const map = minimapOf(WIDE, { view: VIEW, pan: { x: 5000, y: 5000 } });
    expect(shadeOf(map)).toEqual([{ x: 0, y: 0, w: map.width, h: map.height }]);
  });
});
