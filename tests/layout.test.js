import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CARD_SIZES, columnsFor, DETAILS, detailsSize, elkLevel, fromElk, headingType, layOut, SIZES } from "../mods/chartroom/layout.js";
import { levelOf, readChart } from "../mods/chartroom/model.js";

const chart = readChart(readFileSync(new URL("./tide-tables.json", import.meta.url), "utf8"));
const boxOf = (laid, id) => laid.cards.find((card) => card.id === id);
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const card = (id) => ({ id, label: id, isInside: true });
const line = (from, to) => ({ key: `${from}>${to}`, from, to, weight: 1, labels: [] });

function expectTidy(laid, width) {
  for (const [i, a] of laid.cards.entries()) {
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.x + a.w).toBeLessThanOrEqual(width);
    for (const b of laid.cards.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
  }
  expect(laid.height).toBeGreaterThanOrEqual(Math.max(...laid.cards.map((box) => box.y + box.h)));
}

describe("columnsFor", () => {
  test("fits as many cards as the width takes, from one to eight", () => {
    expect(columnsFor(200)).toBe(1);
    expect(columnsFor(340)).toBe(2);
    expect(columnsFor(460)).toBe(3);
    expect(columnsFor(900)).toBe(6);
    expect(columnsFor(2400)).toBe(8);
  });
});

describe("layOut", () => {
  test("puts what uses a part above it, in layers down to the outside services", () => {
    const laid = layOut(levelOf(chart, null), 460);
    const y = (id) => boxOf(laid, id).y;
    expect(y("n:site")).toBeLessThan(y("n:api"));
    expect(y("n:jobs")).toBeLessThan(y("n:api"));
    expect(y("n:api")).toBeLessThan(y("n:db"));
    expect(y("n:jobs")).toBeLessThan(y("n:mail"));
    expectTidy(laid, 460);
  });

  test("puts the outside cards that use a part on top, and the ones it uses at the bottom", () => {
    const laid = layOut(levelOf(chart, "api"), 460);
    const insideYs = laid.cards.filter((box) => box.isInside).map((box) => box.y);
    expect(boxOf(laid, "n:site").y).toBeLessThan(Math.min(...insideYs));
    expect(boxOf(laid, "n:db").y).toBeGreaterThan(Math.max(...insideYs));
    expectTidy(laid, 460);
  });

  test("lists the cards in reading order", () => {
    const laid = layOut(levelOf(chart, "api"), 460);
    const order = laid.cards.map((box) => [box.y, box.x]);
    expect(order).toEqual([...order].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  });

  test("keeps cards readable in a wide view, the row in the middle", () => {
    const level = { inside: ["a", "b"].map(card), outside: [], lines: [line("a", "b")] };
    const laid = layOut(level, 2400);
    for (const box of laid.cards) {
      expect(box.w).toBe(SIZES.maxCardWidth);
      expect(box.x + box.w / 2).toBeCloseTo(1200);
    }
  });

  test("wraps a layer wider than the panel into rows", () => {
    const level = { inside: ["a", "b", "c", "d", "e"].map(card), outside: [], lines: [] };
    const laid = layOut(level, 340);
    expect(new Set(laid.cards.map((box) => box.y)).size).toBe(3);
    expectTidy(laid, 340);
  });

  test("still lays out a level whose links go round in a loop", () => {
    const level = { inside: ["a", "b", "c"].map(card), outside: [], lines: [line("a", "b"), line("b", "a"), line("b", "c")] };
    const laid = layOut(level, 460);
    const y = (id) => boxOf(laid, id).y;
    expect(y("a")).toBeLessThan(y("b"));
    expect(y("b")).toBeLessThan(y("c"));
  });

  test("breaks a loop on its lighter way round", () => {
    const level = { inside: ["a", "b"].map(card), outside: [], lines: [line("a", "b"), { ...line("b", "a"), weight: 5 }] };
    const laid = layOut(level, 460);
    expect(boxOf(laid, "b").y).toBeLessThan(boxOf(laid, "a").y);
  });

  test("puts the cards no link touches in the last layer", () => {
    const level = { inside: ["lone", "a", "b"].map(card), outside: [], lines: [line("a", "b")] };
    const laid = layOut(level, 460);
    expect(boxOf(laid, "lone").y).toBe(boxOf(laid, "b").y);
  });

  test("runs a line from the bottom of the card that uses to the top of the one used, arrow on the card", () => {
    const laid = layOut(levelOf(chart, null), 460);
    const curve = laid.curves.find((one) => one.key === "n:api>n:db");
    const api = boxOf(laid, "n:api");
    const db = boxOf(laid, "n:db");
    expect(curve.start[1]).toBe(api.y + api.h);
    expect(curve.end[1]).toBe(db.y);
    expect(curve.arrow[0]).toEqual(curve.end);
    expect(curve.arrow[1][1]).toBeLessThan(db.y);
  });

  test("spreads the lines meeting one edge of a card along it", () => {
    const laid = layOut(levelOf(chart, null), 460);
    const ends = laid.curves.filter((one) => one.to === "n:api").map((one) => one.end[0]);
    expect(ends.length).toBe(2);
    expect(new Set(ends).size).toBe(2);
    const api = boxOf(laid, "n:api");
    for (const x of ends) {
      expect(x).toBeGreaterThanOrEqual(api.x + SIZES.portInset);
      expect(x).toBeLessThanOrEqual(api.x + api.w - SIZES.portInset);
    }
  });

  test("is empty for a level with nothing on it", () => {
    expect(layOut({ inside: [], outside: [], lines: [] }, 460)).toEqual({ cards: [], curves: [], height: SIZES.pad });
  });

  test("lays out a level as big as a 6000-file chart's biggest, loops and all: every card once, apart, and every line", () => {
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const inside = Array.from({ length: 800 }, (_, at) => card(`f:src/file-${at}.ts`));
    const lines = new Map();
    while (lines.size < 2400) {
      const [from, to] = [inside[Math.floor(next() * 800)].id, inside[Math.floor(next() * 800)].id];
      if (from !== to) lines.set(`${from}>${to}`, line(from, to));
    }
    const laid = layOut({ inside, outside: [], lines: [...lines.values()] }, 1200);
    expect(new Set(laid.cards.map((box) => box.id)).size).toBe(800);
    expect(laid.cards.filter((a, i) => laid.cards.some((b, j) => j > i && overlaps(a, b))).length).toBe(0);
    expect(laid.curves.length).toBe(2400);
  });
});

describe("fromElk", () => {
  const level = levelOf(chart, "api");
  const elk = {
    direction: "RIGHT",
    width: 800,
    height: 300,
    cards: { "n:site": [16, 40], "n:jobs": [16, 100], "n:api.routes": [300, 40], "n:api.store": [300, 140], "f:api/src/index.ts": [300, 220], "n:db": [600, 140] },
    lines: { "n:api.routes>n:api.store": [[536, 79], [560, 79], [560, 179], [300, 179]] },
  };

  test("places the cards at ELK's places and sizes, at the zoom asked, in the middle of a wider view", () => {
    const laid = fromElk(level, elk, { zoom: 0.5, viewWidth: 600 });
    const site = laid.cards.find((card) => card.id === "n:site");
    expect([site.x, site.y, site.w, site.h]).toEqual([100 + 8, 20, CARD_SIZES.RIGHT.outside.w / 2, CARD_SIZES.RIGHT.outside.h / 2]);
    expect(laid.width).toBe(500);
    expect(laid.lines[0].points[0]).toEqual([100 + 268, 39.5]);
  });

  test("lists the cards band by band, what uses the part first", () => {
    expect(fromElk(level, elk).cards.map((card) => card.id)).toEqual(["n:site", "n:jobs", "n:api.routes", "n:api.store", "f:api/src/index.ts", "n:db"]);
  });

  test("words each band over its cards, with how many there are", () => {
    const bands = fromElk(level, elk, { insideLabel: "Inside Server" }).bands;
    expect(bands.map((band) => [band.label, band.count])).toEqual([["Used by", 2], ["Inside Server", 3], ["Uses", 1]]);
    expect(bands[1]).toMatchObject({ x: 300, y: 16, w: CARD_SIZES.RIGHT.inside.w });
  });

  test("asks draw/lay.js for every card with its band and size, and every line", () => {
    const asked = elkLevel("k", level, "DOWN");
    expect(asked.cards.find((card) => card.id === "n:db")).toEqual({ id: "n:db", band: 2, ...CARD_SIZES.DOWN.outside });
    expect(asked.lines.length).toBe(level.lines.length);
  });
});

describe("headingType", () => {
  test("gives the heading's sizes at 100%: a 13px line, a 24px name, and what it does at 13px on 20px lines", () => {
    expect(headingType(1)).toEqual({ width: 760, padX: 20, padTop: 18, padBottom: 4, gap: 4, kind: 13, name: 24, summary: 13, summaryLine: 20, summaryMax: null });
  });

  test("grows with the zoom as the cards do, the name no larger than 32px", () => {
    expect(headingType(1.49)).toMatchObject({ width: 1132.4, padX: 29.8, kind: 19.4, name: 32, summary: 19.4, summaryLine: 29.8 });
    expect(headingType(0.75)).toMatchObject({ kind: 9.8, name: 18, summary: 9.8, summaryLine: 15 });
  });

  test("is smaller on a low screen, what it does kept to two lines", () => {
    expect(headingType(1, true)).toMatchObject({ padTop: 12, gap: 2, name: 19, summary: 12, summaryLine: 17, summaryMax: 34 });
  });
});

describe("detailsSize", () => {
  const wide = (dragged, width = 1400) => detailsSize({ isWide: true, panel: { width, height: 800 }, dragged });
  const low = (dragged, height = 800) => detailsSize({ isWide: false, panel: { width: 600, height }, dragged });

  test("is the width dragged to beside the chart, kept between its least and half the panel", () => {
    expect(wide(500)).toBe(500);
    expect(wide(100)).toBe(DETAILS.minWidth);
    expect(wide(1000)).toBe(700);
  });

  test("is the height dragged to under the chart, kept between its least and 60% of the panel", () => {
    expect(low(400)).toBe(400);
    expect(low(50)).toBe(DETAILS.minHeight);
    expect(low(700)).toBe(480);
  });

  test("is the default when none was dragged: 340 wide, or 36% of the height between 150 and 300", () => {
    expect(wide(null)).toBe(DETAILS.width);
    expect(low(null, 600)).toBe(216);
    expect(low(null, 300)).toBe(150);
    expect(low(null, 1200)).toBe(300);
  });

  test("keeps a size dragged on a bigger panel within the smaller one it is on now", () => {
    expect(wide(650, 1000)).toBe(500);
    expect(low(400, 500)).toBe(300);
  });
});
