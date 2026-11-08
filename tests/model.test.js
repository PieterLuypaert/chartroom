import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { chartText } from "../draw/build.js";
import { cardIdOn, detailsOf, impactChain, impactInSlices, impactOf, impactOn, impactSection, isExplanationCurrent, isLevelReady, levelInSlices, levelOf, pickerItems, projectsOf, readChart, readChartInSlices, trailOf } from "../mods/chartroom/model.js";

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

describe("a big chart, in slices", () => {
  // Ten parts of 2000 files each, every file using the next one in its part: 20,000 files and as many
  // links, written as draw/build.js writes a chart.
  const graph = {
    schema: "chartroom/chart@1",
    project: { name: "Armada", summary: "A big app." },
    nodes: Array.from({ length: 10 }, (_, part) => ({ id: `p${part}`, parent: null, label: `Part ${part}`, kind: "feature" })),
    files: Array.from({ length: 20000 }, (_, index) => ({ p: `p${index % 10}/file-${index}.ts`, n: `p${index % 10}`, d: `File ${index}.` })),
    routes: [],
    links: Array.from({ length: 20000 }, (_, index) => ({ a: `f:p${index % 10}/file-${index}.ts`, b: `f:p${(index + 1) % 10}/file-${(index + 1) % 20000}.ts`, w: 1, labels: [] })),
  };
  const text = chartText(graph);

  test("reads it giving the turn between slices, into the chart read in one go", async () => {
    let pauses = 0;
    const chart = await readChartInSlices(text, async () => (pauses += 1), 0);
    expect(pauses).toBeGreaterThan(0);
    const whole = readChart(JSON.stringify(graph));
    expect([...chart.files.keys()]).toEqual([...whole.files.keys()]);
    expect(chart.links).toEqual(whole.links);
  });

  test("works out a level in slices, the same as in one go, and keeps it", async () => {
    const chart = readChart(text);
    expect(isLevelReady(chart, "p3")).toBe(false);
    let pauses = 0;
    const level = await levelInSlices(chart, "p3", async () => (pauses += 1), 0);
    expect(pauses).toBeGreaterThan(0);
    expect(isLevelReady(chart, "p3")).toBe(true);
    expect(levelOf(chart, "p3")).toBe(level);
    expect(level).toEqual(levelOf(readChart(JSON.stringify(graph)), "p3"));
    expect(level.inside).toHaveLength(2000);
  });
});

// The tide tables' links, which way each goes (a uses b):
//   home.tsx, port.tsx  -import->  client.ts  -http->  tides.ts, ports.ts  -import->  db.ts  -> the db
//   index.ts  -import->  tides.ts, ports.ts;  fetch.py  -http GET /tides/:port->  tides.ts;  fetch.py -import-> notify.py -> mail
describe("impactOf", () => {
  const steps = (impact) => Object.fromEntries([...impact.affected].map(([ref, one]) => [ref, one.steps]));
  const chain = (impact, ref) => {
    const out = [ref];
    for (let at = impact.affected.get(ref)?.from; at; at = impact.affected.get(at)?.from) out.push(at);
    return out;
  };

  test("finds the files that use a file, any number of steps away, each at its fewest steps", () => {
    const impact = impactOf(chart, "f:api/src/store/db.ts");
    expect(steps(impact)).toEqual({
      "f:api/src/routes/tides.ts": 1,
      "f:api/src/routes/ports.ts": 1,
      "f:api/src/index.ts": 2,
      "f:site/src/kit/client.ts": 2,
      "f:jobs/fetch.py": 2,
      "f:site/src/pages/home.tsx": 3,
      "f:site/src/pages/port.tsx": 3,
    });
  });

  test("keeps the file each was reached from, so the shortest chain back to the source can be told", () => {
    const impact = impactOf(chart, "f:api/src/store/db.ts");
    const back = chain(impact, "f:site/src/pages/home.tsx");
    expect(back).toHaveLength(4);
    expect(back[1]).toBe("f:site/src/kit/client.ts");
    expect(back.at(-1)).toBe("f:api/src/store/db.ts");
  });

  test("counts a request answered by an endpoint, with the link that carries it", () => {
    const impact = impactOf(chart, "f:api/src/routes/tides.ts");
    expect(steps(impact)).toMatchObject({ "f:site/src/kit/client.ts": 1, "f:api/src/index.ts": 1, "f:jobs/fetch.py": 1, "f:site/src/pages/home.tsx": 2 });
    expect(impact.affected.get("f:jobs/fetch.py").via.labels).toEqual(["GET /tides/:port"]);
    expect(impact.affected.get("f:site/src/kit/client.ts").via.k).toBe("http");
  });

  test("takes a part as all of its files, and does not count them", () => {
    const impact = impactOf(chart, "n:api");
    expect([...impact.sources].sort()).toEqual(["f:api/src/index.ts", "f:api/src/routes/ports.ts", "f:api/src/routes/tides.ts", "f:api/src/store/db.ts", "n:api"]);
    expect(steps(impact)).toEqual({ "f:site/src/kit/client.ts": 1, "f:jobs/fetch.py": 1, "f:site/src/pages/home.tsx": 2, "f:site/src/pages/port.tsx": 2 });
  });

  test("takes an outside service as what uses it, then what depends on that", () => {
    expect(steps(impactOf(chart, "n:db"))).toMatchObject({ "f:api/src/store/db.ts": 1, "f:api/src/routes/tides.ts": 2, "f:site/src/pages/home.tsx": 4 });
  });

  test("walks forwards to what the source relies on, with uses", () => {
    expect(steps(impactOf(chart, "f:site/src/pages/home.tsx", { direction: "uses" }))).toEqual({
      "f:site/src/kit/client.ts": 1,
      "f:api/src/routes/tides.ts": 2,
      "f:api/src/routes/ports.ts": 2,
      "f:api/src/store/db.ts": 3,
      "n:db": 4,
    });
  });

  test("ends on links that go round in a circle, each file at its fewest steps", () => {
    const round = readChart(JSON.stringify({
      schema: "chartroom/chart@1",
      nodes: [{ id: "p", parent: null, label: "P", kind: "feature" }],
      files: ["a", "b", "c"].map((name) => ({ p: `${name}.ts`, n: "p" })),
      links: [["a", "b"], ["b", "c"], ["c", "a"]].map(([a, b]) => ({ a: `f:${a}.ts`, b: `f:${b}.ts`, k: "import", w: 1 })),
    }));
    expect(steps(impactOf(round, "f:a.ts"))).toEqual({ "f:c.ts": 1, "f:b.ts": 2 });
  });

  test("works the same in slices, giving the turn between them", async () => {
    let pauses = 0;
    const impact = await impactInSlices(chart, "f:api/src/store/db.ts", {}, async () => (pauses += 1), 0);
    expect(pauses).toBeGreaterThan(0);
    expect(steps(impact)).toEqual(steps(impactOf(chart, "f:api/src/store/db.ts")));
  });
});

describe("impactOn", () => {
  const placed = (on) => Object.fromEntries([...on.cards].map(([id, one]) => [id, { steps: one.steps, files: one.files }]));
  test("shows each affected card on a level at its fewest steps, with its files, and the source's cards apart", () => {
    const on = impactOn(chart, levelOf(chart, "site"), impactOf(chart, "f:site/src/kit/client.ts"));
    expect([...on.sources]).toEqual(["n:site.kit"]);
    expect(placed(on)).toEqual({ "n:site.pages": { steps: 1, files: 2 } });
    expect(on.counts).toEqual({ parts: 1, files: 2 });
  });

  test("lights the lines from each affected card towards the source", () => {
    const on = impactOn(chart, levelOf(chart, null), impactOf(chart, "f:api/src/store/db.ts"));
    expect([...on.sources]).toEqual(["n:api"]);
    expect(placed(on)).toEqual({ "n:site": { steps: 2, files: 3 }, "n:jobs": { steps: 2, files: 1 } });
    expect([...on.lines].sort()).toEqual(["n:jobs>n:api", "n:site>n:api"]);
    expect(on.counts).toEqual({ parts: 5, files: 7 });
  });

  test("keeps the affected files with no card on the level apart, by the part they are in", () => {
    const level = levelOf(chart, "site.pages");
    const on = impactOn(chart, level, impactOf(chart, "f:api/src/store/db.ts"));
    expect(placed(on)).toEqual({ "f:site/src/pages/home.tsx": { steps: 3, files: 1 }, "f:site/src/pages/port.tsx": { steps: 3, files: 1 }, "n:site.kit": { steps: 2, files: 1 } });
    expect(on.elsewhere.map(({ part, steps, files }) => ({ part, steps, files }))).toEqual([
      { part: "api.routes", steps: 1, files: 2 },
      { part: "api", steps: 2, files: 1 },
      { part: "jobs", steps: 2, files: 1 },
    ]);
  });
});

describe("impactChain", () => {
  test("names the shortest chain from an affected file back to the source", () => {
    const impact = impactOf(chart, "f:api/src/store/db.ts");
    expect(impactChain(chart, impact, "f:site/src/pages/home.tsx")).toEqual(["Home page", "Server client", "Tide times", "Database client"]);
  });
});

describe("impactOn with only the direct steps", () => {
  test("keeps only what is one step away: cards, lines, files and counts", () => {
    const on = impactOn(chart, levelOf(chart, "api"), impactOf(chart, "f:api/src/store/db.ts"), { steps: 1 });
    expect([...on.cards].map(([id, one]) => [id, one.steps, one.files])).toEqual([["n:api.routes", 1, 2]]);
    expect([...on.lines]).toEqual(["n:api.routes>n:api.store"]);
    expect(on.counts).toEqual({ parts: 1, files: 2 });
  });
});

describe("impactSection", () => {
  const rows = (section) => section.groups.map((group) => [group.label, group.rows.map((row) => [row.label, row.files, row.carries ?? row.through])]);

  test("groups what depends on the source by its steps, each with what carries it or the card it comes through", () => {
    const section = impactSection(chart, levelOf(chart, "api"), impactOf(chart, "f:api/src/store/db.ts"));
    expect(section.title).toBe("Impact of Database client");
    expect(section.counts).toEqual({ parts: 5, files: 7 });
    expect(rows(section)).toEqual([
      ["Directly", [["Requests", 2, ["db"]]]],
      ["Through one more", [["Website", 3, "Requests"], ["Jobs", 1, "Requests"], ["Server start", 1, "Requests"]]],
    ]);
    expect(section.elsewhere).toEqual([]);
    expect(section.tests).toBeNull();
  });

  test("names an endpoint as what carries a request, and gives each row its chain", () => {
    const section = impactSection(chart, levelOf(chart, null), impactOf(chart, "f:api/src/routes/tides.ts"));
    const direct = section.groups[0].rows;
    expect(direct.map((row) => [row.label, row.carries])).toEqual([["Website", ["GET /tides/:port"]], ["Jobs", ["GET /tides/:port"]]]);
    expect(direct[0].chain).toEqual(["Server client", "Tide times"]);
  });

  test("lists what has no card on the level by where it is", () => {
    const section = impactSection(chart, levelOf(chart, "site.pages"), impactOf(chart, "f:api/src/store/db.ts"));
    expect(section.elsewhere.map((one) => [one.where, one.steps, one.files])).toEqual([["Server › Requests", 1, 2], ["Server", 2, 1], ["Jobs", 2, 1]]);
  });

  test("keeps only the direct step with directOnly", () => {
    const section = impactSection(chart, levelOf(chart, "api"), impactOf(chart, "f:api/src/store/db.ts"), { directOnly: true });
    expect(rows(section)).toEqual([["Directly", [["Requests", 2, ["db"]]]]]);
    expect(section.counts).toEqual({ parts: 1, files: 2 });
  });

  test("turned round with uses, says what the source relies on, through the card one step nearer", () => {
    const section = impactSection(chart, levelOf(chart, null), impactOf(chart, "f:site/src/pages/home.tsx", { direction: "uses" }));
    expect(section.title).toBe("What Home page relies on");
    expect(rows(section)).toEqual([
      ["Through one more", [["Server", 3, "Server client"]]],
      ["Through 3 more", [["Database", 0, "Server"]]],
    ]);
  });

  test("puts the tests apart, out of the groups", () => {
    const tested = readChart(JSON.stringify({
      schema: "chartroom/chart@1",
      nodes: [{ id: "app", parent: null, label: "App", kind: "feature" }, { id: "checks", parent: null, label: "Checks", kind: "test" }, { id: "web", parent: null, label: "Web", kind: "ui" }],
      files: [{ p: "app/a.ts", n: "app" }, { p: "checks/a.test.ts", n: "checks" }, { p: "web/page.ts", n: "web" }],
      links: [{ a: "f:checks/a.test.ts", b: "f:app/a.ts", k: "import", w: 1, labels: ["a"] }, { a: "f:web/page.ts", b: "f:app/a.ts", k: "import", w: 1, labels: ["a"] }],
    }));
    const section = impactSection(tested, levelOf(tested, null), impactOf(tested, "f:app/a.ts"));
    expect(rows(section)).toEqual([["Directly", [["Web", 1, ["a"]]]]]);
    expect(section.tests).toEqual({ parts: 1, files: 1 });
  });
});
