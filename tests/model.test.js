import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cardIdOn, detailsOf, isExplanationCurrent, levelOf, pickerItems, projectsOf, readChart, trailOf } from "../mods/chartroom/model.js";

const text = readFileSync(new URL("./tide-tables.json", import.meta.url), "utf8");
const chart = readChart(text);
const ids = (cards) => cards.map((card) => card.id);
const pairs = (level) => level.lines.map((line) => `${line.from} > ${line.to}`).sort();

describe("readChart", () => {
  test("says when the file is not JSON", () => {
    expect(() => readChart("{nope")).toThrow("the chart is not valid JSON");
  });

  test("says which format it found when it is not one it reads", () => {
    expect(() => readChart(JSON.stringify({ schema: "other/graph@1" }))).toThrow("the chart is other/graph@1, and the Chartroom reads chartroom/chart@1");
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

  test("finds a file through its endpoints as through its path", () => {
    const level = levelOf(chart, "api.routes");
    const into = level.lines.filter((line) => line.to === "f:api/src/routes/tides.ts").map((line) => line.from).sort();
    expect(into).toEqual(["n:api", "n:jobs", "n:site"]);
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

describe("levelOf, kept", () => {
  test("gives the same level for the same chart and part, without working it out again", () => {
    expect(levelOf(chart, "api")).toBe(levelOf(chart, "api"));
    expect(levelOf(chart, "gone")).toBe(levelOf(chart, null));
  });

  test("works a level out afresh for a chart read again, the same as before", () => {
    const again = readChart(text);
    expect(levelOf(again, "api")).not.toBe(levelOf(chart, "api"));
    expect(levelOf(again, "api")).toEqual(levelOf(chart, "api"));
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

describe("pickerItems", () => {
  const spaces = [
    { id: "s1", name: "tide-tables", folder: "/code/tide-tables", machine: null },
    { id: "s3", name: "tide-tables", folder: "/code/tide-tables", machine: "vps" },
  ];
  const shape = (items) => items.map((one) => (one.kind === "heading" ? `# ${one.label}` : `${one.project.label} @${one.row}`));

  test("puts the spaces' projects under Spaces and the folders picked by hand under Folders", () => {
    const items = pickerItems(projectsOf(spaces, ["/code/harbour"]));
    expect(shape(items)).toEqual(["# Spaces", "tide-tables @1", "tide-tables @2", "# Folders", "harbour @3"]);
  });

  test("numbers each project by its row in the picker, after the row that follows the focus", () => {
    expect(pickerItems(projectsOf(spaces, [])).filter((one) => one.kind === "project").map((one) => one.row)).toEqual([1, 2]);
  });

  test("shows only the headings that have projects under them", () => {
    expect(shape(pickerItems(projectsOf([], ["/code/harbour"])))).toEqual(["# Folders", "harbour @1"]);
    expect(pickerItems([])).toEqual([]);
  });
});

describe("cardIdOn", () => {
  test("finds the card a part or file shows as on a level", () => {
    expect(cardIdOn(chart, null, "f:api/src/store/db.ts")).toBe("n:api");
    expect(cardIdOn(chart, "api", "f:api/src/store/db.ts")).toBe("n:api.store");
    expect(cardIdOn(chart, "api.store", "f:api/src/store/db.ts")).toBe("f:api/src/store/db.ts");
    expect(cardIdOn(chart, "api", "n:site.pages")).toBe("n:site");
  });

  test("finds the file an endpoint is in, or the part around it", () => {
    expect(cardIdOn(chart, "api.routes", "r:0")).toBe("f:api/src/routes/tides.ts");
    expect(cardIdOn(chart, null, "r:0")).toBe("n:api");
  });

  test("is nothing for what the chart does not have", () => {
    expect(cardIdOn(chart, null, "f:nowhere.ts")).toBeNull();
    expect(cardIdOn(chart, null, "n:gone")).toBeNull();
    expect(cardIdOn(chart, null, "r:9")).toBeNull();
  });

  test("is nothing for the part the level shows", () => {
    expect(cardIdOn(chart, "api", "n:api")).toBeNull();
  });
});

describe("isExplanationCurrent", () => {
  const drawnAt = (generatedAt, revs) => readChart(JSON.stringify({
    schema: "chartroom/chart@1",
    meta: { generatedAt },
    nodes: [{ id: "api", parent: null, label: "Server", rev: revs.api }],
    files: [{ p: "api/index.ts", n: "api", name: "Start", rev: revs.file }],
    links: [],
  }));
  const updated = drawnAt("2026-11-08", { api: "a2", file: "f1" });

  test("keeps an explanation while its card's rev is the same, after an update too", () => {
    expect(isExplanationCurrent(updated, { card: "f:api/index.ts", rev: "f1", chart: "2026-11-07" })).toBe(true);
    expect(isExplanationCurrent(updated, { card: "n:api", rev: "a1", chart: "2026-11-07" })).toBe(false);
  });

  test("keeps one written before cards had a rev only on the chart it was written for", () => {
    expect(isExplanationCurrent(updated, { card: "n:api", chart: "2026-11-08" })).toBe(true);
    expect(isExplanationCurrent(updated, { card: "n:api", chart: "2026-11-07" })).toBe(false);
  });

  test("keeps one on a chart drawn before cards had a rev only on the chart it was written for", () => {
    const older = drawnAt("2026-11-07", {});
    expect(isExplanationCurrent(older, { card: "n:api", rev: "a1", chart: "2026-11-07" })).toBe(true);
    expect(isExplanationCurrent(older, { card: "n:api", rev: "a1", chart: "2026-11-06" })).toBe(false);
  });
});
