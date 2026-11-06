import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { detailsOf, levelOf, projectsOf, readChart, trailOf } from "../mods/chartroom/model.js";

const text = readFileSync(new URL("./tide-tables.json", import.meta.url), "utf8");
const chart = readChart(text);
const ids = (cards) => cards.map((card) => card.id);
const pairs = (level) => level.lines.map((line) => `${line.from} > ${line.to}`).sort();

describe("readChart", () => {
  test("says when the file is not JSON", () => {
    expect(() => readChart("{nope")).toThrow("floorplan/graph.json is not valid JSON");
  });

  test("says which format it found when it is not one it reads", () => {
    expect(() => readChart(JSON.stringify({ schema: "floorplan/graph@2" }))).toThrow("floorplan/graph.json is floorplan/graph@2, and the Chartroom reads floorplan/graph@1");
  });

  test("names the chart after the project", () => {
    expect(chart.name).toBe("Tide Tables");
  });
});

describe("levelOf the whole app", () => {
  const level = levelOf(chart, null);

  test("shows every top-level part, in the map's order", () => {
    expect(ids(level.inside)).toEqual(["n:site", "n:api", "n:jobs", "n:mail", "n:db"]);
    expect(level.outside).toEqual([]);
  });

  test("draws one line per pair of parts, through links inside them, endpoints and outside services", () => {
    expect(pairs(level)).toEqual(["n:api > n:db", "n:jobs > n:api", "n:jobs > n:mail", "n:site > n:api"]);
  });

  test("counts the links a line stands for and keeps what they carry once", () => {
    const line = level.lines.find((one) => one.key === "n:site>n:api");
    expect(line.weight).toBe(2);
    expect(line.labels).toEqual(["GET /tides/:port", "GET /ports"]);
  });

  test("can open a part with parts or files in it, not an outside service", () => {
    const openable = Object.fromEntries(level.inside.map((card) => [card.id, card.isOpenable]));
    expect(openable).toEqual({ "n:site": true, "n:api": true, "n:jobs": true, "n:mail": false, "n:db": false });
  });
});

describe("levelOf a part", () => {
  const level = levelOf(chart, "api");

  test("shows its parts and the files it holds itself", () => {
    expect(ids(level.inside)).toEqual(["n:api.routes", "n:api.store", "f:api/src/index.ts"]);
  });

  test("puts what only uses it above, and what it uses below", () => {
    const sides = Object.fromEntries(level.outside.map((card) => [card.id, card.side]));
    expect(sides).toEqual({ "n:site": "above", "n:jobs": "above", "n:db": "below" });
  });

  test("links its own cards and the outside ones", () => {
    expect(pairs(level)).toEqual([
      "f:api/src/index.ts > n:api.routes",
      "n:api.routes > n:api.store",
      "n:api.store > n:db",
      "n:jobs > n:api.routes",
      "n:site > n:api.routes",
    ]);
  });

  test("shows a part beside it in the same parent as itself, not as that parent", () => {
    const level = levelOf(chart, "site.kit");
    expect(ids(level.inside)).toEqual(["f:site/src/kit/client.ts"]);
    expect(ids(level.outside).sort()).toEqual(["n:api", "n:site.pages"]);
  });

  test("lists a file's endpoints on its card", () => {
    const level = levelOf(chart, "api.routes");
    const tides = level.inside.find((card) => card.id === "f:api/src/routes/tides.ts");
    expect(tides.routes.map((route) => `${route.m} ${route.p}`)).toEqual(["GET /tides/:port"]);
    expect(tides.label).toBe("Tide times");
  });

  test("falls back to the whole app for a part the map no longer has", () => {
    expect(levelOf(chart, "gone").focus).toBeNull();
  });
});

describe("trailOf", () => {
  test("leads from the app down to the part", () => {
    expect(trailOf(chart, "api.routes").map((step) => step.label)).toEqual(["Tide Tables", "Server", "Requests"]);
  });

  test("is the app alone at the top", () => {
    expect(trailOf(chart, null)).toEqual([{ part: null, label: "Tide Tables" }]);
  });
});

describe("detailsOf", () => {
  const level = levelOf(chart, null);

  test("lists what a card uses and what uses it", () => {
    const details = detailsOf(level, "n:api");
    expect(details.uses.map((one) => one.card.id)).toEqual(["n:db"]);
    expect(details.usedBy.map((one) => one.card.id).sort()).toEqual(["n:jobs", "n:site"]);
  });

  test("is nothing for a card not on the level", () => {
    expect(detailsOf(level, "n:api.routes")).toBeNull();
  });
});

describe("projectsOf", () => {
  const spaces = [
    { id: "s1", name: "tide-tables", folder: "/code/tide-tables", machine: null },
    { id: "s2", name: "review", folder: "/code/tide-tables", machine: null },
    { id: "s3", name: "tide-tables", folder: "/code/tide-tables", machine: "vps" },
    { id: "s4", name: "~", folder: "", machine: null },
  ];

  test("lists each space's folder once per machine, and skips a space without one", () => {
    expect(projectsOf(spaces, []).map((one) => [one.label, one.on, one.space])).toEqual([["tide-tables", null, "s1"], ["tide-tables", "vps", "s3"]]);
  });

  test("adds the folders picked by hand after the spaces, named after the folder", () => {
    const projects = projectsOf(spaces, ["/code/harbour", "/code/tide-tables"]);
    expect(projects.map((one) => one.folder)).toEqual(["/code/tide-tables", "/code/tide-tables", "/code/harbour"]);
    expect(projects.at(-1)).toEqual({ label: "harbour", folder: "/code/harbour", on: null, space: null, key: ":/code/harbour" });
  });
});
