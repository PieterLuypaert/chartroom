import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chartedFrom, FIND_CHARTS, FIND_MAP } from "../mods/chartroom/find.js";

// A home with a charted project in it, a folder deep inside that project, and a project without one.
const home = realpathSync(mkdtempSync(join(tmpdir(), "chartroom-")));
const project = join(home, "code", "tide-tables");
const deep = join(project, "api", "src");
const bare = join(home, "code", "harbour");
mkdirSync(join(project, "floorplan"), { recursive: true });
mkdirSync(deep, { recursive: true });
mkdirSync(bare, { recursive: true });
writeFileSync(join(project, "floorplan", "graph.json"), '{"schema":"floorplan/graph@1"}');
// A map in home itself is no project's.
mkdirSync(join(home, "floorplan"));
writeFileSync(join(home, "floorplan", "graph.json"), '{"schema":"floorplan/graph@1"}');
afterAll(() => rmSync(home, { recursive: true, force: true }));

const sh = (script, ...args) => {
  const run = Bun.spawnSync(["sh", "-c", script, "find", ...args], { env: { HOME: home, PATH: process.env.PATH } });
  return { code: run.exitCode, stdout: run.stdout.toString() };
};

describe("FIND_MAP", () => {
  test("prints the folder that holds the map, then the map", () => {
    expect(sh(FIND_MAP, project)).toEqual({ code: 0, stdout: `${project}\n{"schema":"floorplan/graph@1"}` });
  });

  test("finds the map from a folder deep inside the project", () => {
    expect(sh(FIND_MAP, `${deep}/`).stdout.split("\n")[0]).toBe(project);
  });

  test("exits 3 without a map short of home", () => {
    expect(sh(FIND_MAP, bare)).toEqual({ code: 3, stdout: "" });
  });
});

describe("FIND_CHARTS", () => {
  test("says for each folder where its map is, if anywhere", () => {
    const charted = chartedFrom(sh(FIND_CHARTS, deep, bare).stdout);
    expect([...charted]).toEqual([[deep, project], [bare, null]]);
  });
});
