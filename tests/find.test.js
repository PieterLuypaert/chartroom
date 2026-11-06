import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chartedFrom, FIND_CHARTS, FIND_MAP, mapFrom, START_DRAW, STOP_DRAW } from "../mods/chartroom/find.js";

// A home with projects in it: one charted by floorplan, one by the Chartroom while a drawing runs,
// one whose first drawing has not made a chart yet, and one with nothing.
const home = realpathSync(mkdtempSync(join(tmpdir(), "chartroom-")));
const project = (name, files) => {
  const dir = join(home, "code", name);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  mkdirSync(join(dir, "src", "deep"), { recursive: true });
  return dir;
};
const floorplanned = project("tide-tables", { "floorplan/graph.json": '{"schema":"floorplan/graph@1"}' });
const drawing = project("harbour", {
  ".chartroom/chart.json": '{"schema":"chartroom/chart@1"}',
  ".chartroom/progress.json": '{\n"step": "describe",\n"done": 3\n}',
  ".chartroom/pid": String(process.pid),
  "floorplan/graph.json": '{"schema":"floorplan/graph@1"}',
});
const started = project("lighthouse", { ".chartroom/progress.json": '{"step":"failed","error":"no claude"}', ".chartroom/pid": "999999" });
const bare = project("dock", {});
// A map in home itself is no project's.
mkdirSync(join(home, "floorplan"));
writeFileSync(join(home, "floorplan", "graph.json"), '{"schema":"floorplan/graph@1"}');
afterAll(() => rmSync(home, { recursive: true, force: true }));

const sh = (script, ...args) => {
  const run = Bun.spawnSync(["sh", "-c", script, "find", ...args], { env: { HOME: home, PATH: process.env.PATH } });
  return { code: run.exitCode, stdout: run.stdout.toString() };
};

describe("FIND_MAP", () => {
  test("finds floorplan's map from a folder deep inside the project, with no drawing", () => {
    const found = sh(FIND_MAP, join(floorplanned, "src", "deep"));
    expect(found.code).toBe(0);
    expect(mapFrom(found.stdout)).toEqual({ folder: floorplanned, isDrawing: false, progress: null, kind: "floorplan", text: '{"schema":"floorplan/graph@1"}' });
  });

  test("prefers the Chartroom's own chart, and tells a running drawing and how far it is", () => {
    const found = mapFrom(sh(FIND_MAP, drawing).stdout);
    expect(found).toMatchObject({ folder: drawing, isDrawing: true, progress: { step: "describe", done: 3 }, kind: "chartroom", text: '{"schema":"chartroom/chart@1"}' });
  });

  test("finds a project whose drawing ended before it made a chart", () => {
    expect(mapFrom(sh(FIND_MAP, started).stdout)).toMatchObject({ folder: started, isDrawing: false, progress: { step: "failed" }, kind: "none", text: "" });
  });

  test("exits 3 without a chart short of home", () => {
    expect(sh(FIND_MAP, bare)).toEqual({ code: 3, stdout: "" });
  });
});

describe("FIND_CHARTS", () => {
  test("says for each folder where its chart is, if anywhere", () => {
    const charted = chartedFrom(sh(FIND_CHARTS, join(floorplanned, "src"), drawing, started, bare).stdout);
    expect([...charted]).toEqual([[join(floorplanned, "src"), floorplanned], [drawing, drawing], [started, null], [bare, null]]);
  });
});

describe("START_DRAW and STOP_DRAW", () => {
  test("start a drawing in the background in the project's folder, and stop it", async () => {
    const script = join(home, "fake-draw.js");
    writeFileSync(script, 'import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2] + "/.chartroom/pid", String(process.pid)); writeFileSync(process.argv[2] + "/.chartroom/args", process.argv.slice(2).join(" ")); setTimeout(() => {}, 60000);');
    expect(sh(START_DRAW, bare, script, "--update")).toEqual({ code: 0, stdout: "started\n" });
    for (let tries = 0; tries < 50 && !existsSync(join(bare, ".chartroom", "args")); tries += 1) await Bun.sleep(100);
    expect(readFileSync(join(bare, ".chartroom", "args"), "utf8")).toBe(`${bare} --update`);
    expect(mapFrom(sh(FIND_MAP, bare).stdout).isDrawing).toBe(true);
    expect(sh(STOP_DRAW, bare).code).toBe(0);
    for (let tries = 0; tries < 50 && mapFrom(sh(FIND_MAP, bare).stdout).isDrawing; tries += 1) await Bun.sleep(100);
    expect(mapFrom(sh(FIND_MAP, bare).stdout).isDrawing).toBe(false);
  });
});
