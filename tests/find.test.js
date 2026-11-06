import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chartedFrom, FIND_CHARTS, FIND_MAP, mapFrom, START_DRAW, STOP_DRAW } from "../mods/chartroom/find.js";

// A home with projects in it, and stand-ins for draw/draw.js: one that sleeps, one that records how
// it was started.
const home = realpathSync(mkdtempSync(join(tmpdir(), "chartroom-")));
const write = (path, text) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};
const project = (name, files) => {
  const dir = join(home, "code", name);
  for (const [path, text] of Object.entries(files)) write(join(dir, path), text);
  mkdirSync(join(dir, "src", "deep"), { recursive: true });
  return dir;
};
const sleeper = join(home, "stand-in", "draw", "draw.js");
write(sleeper, "setTimeout(() => {}, 60000);");
const recorder = join(home, "recorder", "draw", "draw.js");
write(recorder, 'import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2] + "/.chartroom/pid", String(process.pid)); writeFileSync(process.argv[2] + "/.chartroom/args", process.argv.slice(2).join(" ")); setTimeout(() => {}, 60000);');
const drawer = Bun.spawn(["bun", sleeper]);
afterAll(() => {
  drawer.kill();
  rmSync(home, { recursive: true, force: true });
});

const floorplanned = project("tide-tables", { "floorplan/graph.json": '{"schema":"floorplan/graph@1"}' });
const drawing = project("harbour", {
  ".chartroom/chart.json": '{"schema":"chartroom/chart@1"}',
  ".chartroom/progress.json": '{\n"step": "describe",\n"done": 3\n}',
  ".chartroom/pid": String(drawer.pid),
  ".chartroom/draw.log": "scanning\n",
  "floorplan/graph.json": '{"schema":"floorplan/graph@1"}',
});
const failed = project("lighthouse", { ".chartroom/progress.json": '{"step":"failed","error":"no claude"}', ".chartroom/draw.log": "line one\nNot logged in\n" });
// A pid that runs, but is no drawing: this test's own.
const stale = project("pier", { ".chartroom/chart.json": '{"schema":"chartroom/chart@1"}', ".chartroom/pid": String(process.pid) });
const bare = project("dock", {});
// A drawing that failed in a folder of projects: the projects below it are not its.
write(join(home, "code", ".chartroom", "progress.json"), '{"step":"failed"}');
// A map in home itself is no project's.
write(join(home, "floorplan", "graph.json"), '{"schema":"floorplan/graph@1"}');

const sh = (script, ...args) => {
  const run = Bun.spawnSync(["sh", "-c", script, "find", ...args], { env: { HOME: home, PATH: process.env.PATH } });
  return { code: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
};
const found = (folder) => mapFrom(sh(FIND_MAP, folder).stdout);

describe("FIND_MAP", () => {
  test("finds floorplan's map from a folder deep inside the project, with no drawing", () => {
    expect(found(join(floorplanned, "src", "deep"))).toEqual({ folder: floorplanned, isDrawing: false, progress: null, log: "", kind: "floorplan", text: '{"schema":"floorplan/graph@1"}' });
  });

  test("prefers the Chartroom's own chart, and tells a running drawing and how far it is", () => {
    expect(found(drawing)).toMatchObject({ folder: drawing, isDrawing: true, progress: { step: "describe", done: 3 }, log: "", kind: "chartroom", text: '{"schema":"chartroom/chart@1"}' });
  });

  test("tells a drawing that ended without a chart, with the end of its log", () => {
    expect(found(failed)).toMatchObject({ folder: failed, isDrawing: false, progress: { step: "failed" }, log: "line one Not logged in", kind: "none", text: "" });
  });

  test("does not take a pid another program runs for a drawing", () => {
    expect(found(stale).isDrawing).toBe(false);
  });

  test("does not hand a project to a folder above it that has only a failed drawing", () => {
    expect(sh(FIND_MAP, bare).code).toBe(3);
  });
});

describe("FIND_CHARTS", () => {
  test("says for each folder where its chart is, if anywhere", () => {
    const charted = chartedFrom(sh(FIND_CHARTS, join(floorplanned, "src"), drawing, failed, bare).stdout);
    expect([...charted]).toEqual([[join(floorplanned, "src"), floorplanned], [drawing, drawing], [failed, null], [bare, null]]);
  });
});

describe("START_DRAW and STOP_DRAW", () => {
  test("start a drawing in the background in the project's folder, and stop it", async () => {
    expect(sh(START_DRAW, bare, recorder, "--update")).toMatchObject({ code: 0, stdout: "started\n" });
    for (let tries = 0; tries < 50 && !existsSync(join(bare, ".chartroom", "args")); tries += 1) await Bun.sleep(100);
    expect(readFileSync(join(bare, ".chartroom", "args"), "utf8")).toBe(`${bare} --update`);
    expect(found(bare).isDrawing).toBe(true);
    expect(sh(START_DRAW, bare, recorder, "")).toMatchObject({ code: 4, stderr: "a drawing runs here already\n" });
    expect(sh(STOP_DRAW, bare).code).toBe(0);
    for (let tries = 0; tries < 50 && found(bare).isDrawing; tries += 1) await Bun.sleep(100);
    expect(found(bare).isDrawing).toBe(false);
  });

  test("say why a drawing does not start", () => {
    expect(sh(START_DRAW, home, recorder, "")).toMatchObject({ code: 4, stderr: "the home folder is not a project: pick one\n" });
    expect(sh(START_DRAW, floorplanned, join(home, "gone.js"), "")).toMatchObject({ code: 4, stderr: `there is no ${join(home, "gone.js")}: run install.sh again\n` });
  });

  test("STOP_DRAW leaves a pid that is no drawing alone", () => {
    expect(sh(STOP_DRAW, stale)).toMatchObject({ code: 1, stderr: "no drawing runs there\n" });
  });
});
