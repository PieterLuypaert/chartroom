import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { columnsFor, layOut, SIZES } from "../mods/chartroom/layout.js";
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
  test("fits as many cards as the width takes, from one to four", () => {
    expect(columnsFor(200)).toBe(1);
    expect(columnsFor(340)).toBe(2);
    expect(columnsFor(460)).toBe(3);
    expect(columnsFor(1400)).toBe(4);
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
});
