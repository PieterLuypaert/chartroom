import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asksFor, asksFrom, CHANGED, chartedFrom, FIND_ASKS, FIND_CHARTS, FIND_MAP, mapFrom, START_ASK, START_DRAW, STOP_ASK, STOP_DRAW } from "../mods/chartroom/find.js";

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

const mapped = project("tide-tables", { ".chartroom/chart.json": '{"schema":"chartroom/chart@1"}' });
const drawing = project("harbour", {
  ".chartroom/chart.json": '{"schema":"chartroom/chart@1"}',
  ".chartroom/progress.json": '{\n"step": "describe",\n"done": 3\n}',
  ".chartroom/pid": String(drawer.pid),
  ".chartroom/draw.log": "scanning\n"
});
const failed = project("lighthouse", { ".chartroom/progress.json": '{"step":"failed","error":"no claude"}', ".chartroom/draw.log": "line one\nNot logged in\n" });
// A pid that runs, but is no drawing: this test's own.
const stale = project("pier", { ".chartroom/chart.json": '{"schema":"chartroom/chart@1"}', ".chartroom/pid": String(process.pid) });
const bare = project("dock", {});
// A drawing that failed in a folder of projects: the projects below it are not its.
write(join(home, "code", ".chartroom", "progress.json"), '{"step":"failed"}');
// A map in home itself is no project's.
write(join(home, ".chartroom", "chart.json"), '{"schema":"chartroom/chart@1"}');

const sh = (script, ...args) => {
  const run = Bun.spawnSync(["sh", "-c", script, "find", ...args], { env: { HOME: home, PATH: process.env.PATH } });
  return { code: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
};
const found = (folder) => mapFrom(sh(FIND_MAP, folder).stdout);

describe("FIND_MAP", () => {
  test("finds the chart from a folder deep inside the project, with no drawing", () => {
    expect(found(join(mapped, "src", "deep"))).toEqual({ folder: mapped, isDrawing: false, progress: null, log: "", kind: "chartroom", text: '{"schema":"chartroom/chart@1"}' });
  });

  test("tells a running drawing and how far it is", () => {
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
    const charted = chartedFrom(sh(FIND_CHARTS, join(mapped, "src"), drawing, failed, bare).stdout);
    expect([...charted]).toEqual([[join(mapped, "src"), mapped], [drawing, drawing], [failed, null], [bare, null]]);
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
    expect(sh(START_DRAW, mapped, join(home, "gone.js"), "")).toMatchObject({ code: 4, stderr: `there is no ${join(home, "gone.js")}: run install.sh again\n` });
  });

  test("STOP_DRAW leaves a pid that is no drawing alone", () => {
    expect(sh(STOP_DRAW, stale)).toMatchObject({ code: 1, stderr: "no drawing runs there\n" });
  });
});

describe("asks", () => {
  const asked = project("buoy", {});
  const asks = join(asked, ".chartroom", "asks");

  test("START_ASK starts the question in the background, and FIND_ASKS reads the answers newest first", async () => {
    const asker = join(home, "asker", "draw", "ask.js");
    write(asker, 'import { mkdirSync, writeFileSync } from "node:fs"; const [folder, id, q] = process.argv.slice(2); writeFileSync(`${folder}/.chartroom/asks/${id}.json`, JSON.stringify({ id, question: JSON.parse(q).question, status: "done" }));');
    write(join(asks, "1.json"), '{"id":"1",\n"status":"done"}');
    Bun.spawnSync(["touch", "-t", "202001010000", join(asks, "1.json")]);
    write(join(asks, "notes.txt"), "not an answer");
    expect(sh(START_ASK, asked, asker, "2", JSON.stringify({ question: "Why?" }))).toMatchObject({ code: 0, stdout: "started\n" });
    for (let tries = 0; tries < 50 && !existsSync(join(asks, "2.json")); tries += 1) await Bun.sleep(100);
    expect(asksFrom(sh(FIND_ASKS, asked).stdout).map((one) => [one.id, one.question])).toEqual([["2", "Why?"], ["1", undefined]]);
  });

  test("asksFrom leaves out a line that is not an answer yet", () => {
    expect(asksFrom('{"id":"3"}\n{"id":\n\n')).toEqual([{ id: "3" }]);
  });

  describe("asksFor", () => {
    const answers = [
      { id: "6", focus: "api", card: "f:api/user.ts" },
      { id: "5", focus: null, card: "n:api" },
      { id: "4", focus: "api", card: null },
      { id: "3", focus: "ui", card: "n:api" },
      { id: "2", focus: null, card: null },
      { id: "1" },
    ];
    const ids = (found) => found.map((one) => one.id);

    test("a card picked gets only the answers about it, from whichever level it was picked on", () => {
      expect(ids(asksFor(answers, { focus: null, card: "n:api" }))).toEqual(["5", "3"]);
      expect(ids(asksFor(answers, { focus: "api", card: "f:api/user.ts" }))).toEqual(["6"]);
      expect(asksFor(answers, { focus: "api", card: "f:api/other.ts" })).toEqual([]);
    });

    test("with none picked, a level gets only the answers about itself, a record without a focus at the top", () => {
      expect(ids(asksFor(answers, { focus: "api", card: null }))).toEqual(["4"]);
      expect(ids(asksFor(answers, { focus: null, card: null }))).toEqual(["2", "1"]);
      expect(asksFor(answers, { focus: "ui", card: null })).toEqual([]);
    });
  });

  test("STOP_ASK leaves a pid that is no question alone", () => {
    expect(sh(STOP_ASK, String(process.pid))).toMatchObject({ code: 1, stderr: "that question is answered already\n" });
  });
});

describe("CHANGED", () => {
  const repo = project("lantern", {});
  const git = (...args) => Bun.spawnSync(["git", "-C", repo, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  const chartFile = join(repo, ".chartroom", "chart.json");

  test("counts the commits since the chart's head and the files changed after it was written", () => {
    git("init", "-q");
    write(join(repo, "a.ts"), "a");
    write(join(repo, "old.ts"), "old");
    git("add", ".");
    git("commit", "-q", "-m", "one");
    const head = git("rev-parse", "HEAD").stdout.toString().trim();
    write(join(repo, "old.ts"), "changed before the chart");
    Bun.spawnSync(["touch", "-t", "202001010000", join(repo, "old.ts")]);
    write(chartFile, "{}");
    write(join(repo, "a.ts"), "a, changed");
    git("commit", "-q", "-am", "two");
    write(join(repo, "b.ts"), "new");
    Bun.spawnSync(["touch", "-t", "203001010000", join(repo, "b.ts")]);
    expect(sh(CHANGED, repo, chartFile, "", head).stdout).toBe("1 1\n");
  });

  test("counts a head git no longer knows as a commit", () => {
    expect(sh(CHANGED, repo, chartFile, "", "0000000000000000000000000000000000000000").stdout).toBe("1 1\n");
  });
});
