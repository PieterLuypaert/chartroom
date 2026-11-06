import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { levelOf, readChart } from "../mods/chartroom/model.js";
import { layOutLevels } from "../draw/lay.js";

const chart = readChart(readFileSync(new URL("./tide-tables.json", import.meta.url), "utf8"));
const bandOf = (card) => (!card.isInside ? (card.side === "above" ? 0 : 2) : 1);
const levelFor = (focus, direction) => {
  const level = levelOf(chart, focus);
  return {
    key: `${focus}:${direction}`,
    direction,
    cards: [...level.inside, ...level.outside].map((card) => ({ id: card.id, band: bandOf(card), w: card.isInside ? 200 : 150, h: card.isInside ? 54 : 32 })),
    lines: level.lines.map((line) => ({ key: line.key, from: line.from, to: line.to })),
  };
};
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const boxes = (level, laid) => level.cards.map((card) => ({ ...card, x: laid.cards[card.id][0], y: laid.cards[card.id][1] }));
const onEdge = (box, [x, y]) => (Math.abs(x - box.x) < 1.5 || Math.abs(x - box.x - box.w) < 1.5 || Math.abs(y - box.y) < 1.5 || Math.abs(y - box.y - box.h) < 1.5);

describe("layOutLevels", async () => {
  const right = levelFor("api", "RIGHT");
  const down = levelFor("api", "DOWN");
  const layouts = await layOutLevels([right, down, levelFor(null, "RIGHT")]);

  test("lays every level asked out in one go", () => {
    expect(Object.keys(layouts).sort()).toEqual(["api:DOWN", "api:RIGHT", "null:RIGHT"]);
    for (const laid of Object.values(layouts)) expect(laid.error).toBeUndefined();
  });

  test("puts what uses the part first, what is inside it in the middle and what it uses last", () => {
    const x = (id) => layouts["api:RIGHT"].cards[id][0];
    expect(x("n:site")).toBeLessThan(x("n:api.routes"));
    expect(x("n:jobs")).toBeLessThan(x("n:api.routes"));
    expect(x("n:api.store")).toBeLessThan(x("n:db"));
    const y = (id) => layouts["api:DOWN"].cards[id][1];
    expect(y("n:site")).toBeLessThan(y("n:api.routes"));
    expect(y("n:api.store")).toBeLessThan(y("n:db"));
  });

  test("keeps the cards apart and inside the level's size", () => {
    for (const [level, laid] of [[right, layouts["api:RIGHT"]], [down, layouts["api:DOWN"]]]) {
      const placed = boxes(level, laid);
      for (const [i, a] of placed.entries()) {
        expect(a.x + a.w).toBeLessThanOrEqual(laid.width);
        expect(a.y + a.h).toBeLessThanOrEqual(laid.height);
        for (const b of placed.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
      }
    }
  });

  test("runs every line at right angles from the edge of one card to the edge of the other", () => {
    const placed = new Map(boxes(right, layouts["api:RIGHT"]).map((box) => [box.id, box]));
    for (const line of right.lines) {
      const points = layouts["api:RIGHT"].lines[line.key];
      expect(points.length).toBeGreaterThanOrEqual(2);
      expect(onEdge(placed.get(line.from), points[0])).toBe(true);
      expect(onEdge(placed.get(line.to), points.at(-1))).toBe(true);
      for (let i = 1; i < points.length; i += 1) expect(points[i][0] === points[i - 1][0] || points[i][1] === points[i - 1][1]).toBe(true);
    }
  });

  test("gives each line its own port on a card", () => {
    const ends = right.lines.filter((line) => line.from === "f:api/src/index.ts").map((line) => layouts["api:RIGHT"].lines[line.key][0].join(","));
    expect(new Set(ends).size).toBe(ends.length);
  });

  test("says which level it could not lay out, and lays out the rest", async () => {
    const broken = { key: "broken", direction: "RIGHT", cards: [{ id: "a", band: 1, w: Number.NaN, h: 10 }], lines: [] };
    const result = await layOutLevels([broken, levelFor("site", "RIGHT")]);
    expect(result["site:RIGHT"].error).toBeUndefined();
    expect(Object.keys(result)).toContain("broken");
  });
});

describe("draw/lay.js", () => {
  test("answers on stdout when run with the levels as its argument", () => {
    const run = Bun.spawnSync(["bun", join(import.meta.dir, "..", "draw", "lay.js"), JSON.stringify({ levels: [levelFor(null, "DOWN")] })]);
    expect(run.exitCode).toBe(0);
    expect(Object.keys(JSON.parse(run.stdout.toString()).layouts)).toEqual(["null:DOWN"]);
  });

  test("says what was wrong with what it was given", () => {
    const run = Bun.spawnSync(["bun", join(import.meta.dir, "..", "draw", "lay.js"), "{nope"]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr.toString()).toContain("the levels could not be laid out");
  });
});
