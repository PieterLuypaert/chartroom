import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { levelOf, readChart } from "../mods/chartroom/model.js";

// A small project of two folders, drawn with a fake claude that logs what it is asked.
const work = realpathSync(mkdtempSync(join(tmpdir(), "chartroom-draw-")));
const project = join(work, "tide-tables");
const claudeLog = join(work, "claude.log");
const fakeClaude = join(work, "claude");
const files = {
  "web/src/page.tsx": 'import { tidesOf } from "./client";\nexport default function Page() { return tidesOf("brest"); }\n',
  "web/src/client.ts": "export const tidesOf = (port: string) => fetch(`/api/tides/${port}`);\n",
  "api/src/server.ts": 'import Stripe from "stripe";\nimport { tides } from "./tides";\napp.get("/api/tides/:port", (req, res) => res.json(tides(req.params.port)));\n',
  "api/src/tides.ts": "/** The tides of one port. */\nexport function tides(port: string) { return []; }\n",
};

const write = (path, text) => {
  mkdirSync(join(project, path, ".."), { recursive: true });
  writeFileSync(join(project, path), text);
};

function draw(...flags) {
  const run = Bun.spawnSync(["bun", join(import.meta.dir, "..", "draw", "draw.js"), project, ...flags.filter((flag) => flag !== "fail")], {
    env: { ...process.env, CHARTROOM_CLAUDE: fakeClaude, FAKE_CLAUDE_LOG: claudeLog, FAKE_CLAUDE_FAIL: flags.includes("fail") ? "1" : "", ...(flags.includes("home") ? { HOME: project } : {}) },
  });
  return { code: run.exitCode, err: run.stderr.toString() };
}

const chart = () => readChart(readFileSync(join(project, ".chartroom", "chart.json"), "utf8"));
const progress = () => JSON.parse(readFileSync(join(project, ".chartroom", "progress.json"), "utf8"));
const asked = () => readFileSync(claudeLog, "utf8").trim().split("\n");

beforeAll(() => {
  writeFileSync(fakeClaude, `#!/bin/sh\nexec bun ${join(import.meta.dir, "fake-claude.js")} "$@"\n`);
  chmodSync(fakeClaude, 0o755);
  for (const [path, text] of Object.entries(files)) write(path, text);
  Bun.spawnSync(["git", "init", "-q", project]);
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("draw.js", () => {
  test("draws a chart of the parts Claude named, linked by imports, requests and packages", () => {
    expect(draw()).toMatchObject({ code: 0 });
    const level = levelOf(chart(), null);
    expect(level.inside.map((card) => card.label)).toEqual(["The api", "The web", "Stripe"]);
    expect(level.lines.map((line) => `${line.from} > ${line.to}`).sort()).toEqual(["n:api > n:stripe", "n:web > n:api"]);
    expect(level.lines.find((line) => line.from === "n:web").labels).toEqual(["GET /api/tides/:port"]);
  });

  test("names every file and endpoint as Claude described them", () => {
    const inside = levelOf(chart(), "api").inside;
    expect(inside.map((card) => card.label)).toEqual(["Named server.ts", "Named tides.ts"]);
    expect(inside[0].routes.map((route) => route.name)).toEqual(["Asks /api/tides/:port"]);
  });

  test("ends with its progress done, no pid left, and a folder that keeps itself out of git", () => {
    expect(progress()).toMatchObject({ step: "done", done: 4, total: 4, error: null });
    expect(existsSync(join(project, ".chartroom", "pid"))).toBe(false);
    expect(readFileSync(join(project, ".chartroom", ".gitignore"), "utf8")).toBe("*\n");
    expect(Bun.spawnSync(["git", "-C", project, "status", "--porcelain"]).stdout.toString()).not.toContain(".chartroom");
  });

  test("on an update asks only about the file that changed, and keeps the parts", () => {
    writeFileSync(claudeLog, "");
    write("api/src/tides.ts", "/** The tides of one port, for a week. */\nexport function tides(port: string) { return [1]; }\n");
    expect(draw("--update")).toMatchObject({ code: 0 });
    expect(asked()).toEqual(["describe api/src/tides.ts"]);
    expect(levelOf(chart(), "web").inside.map((card) => card.label)).toEqual(["Named client.ts", "Named page.tsx"]);
  });

  test("asks for the parts again when many files fit none of them", () => {
    writeFileSync(claudeLog, "");
    write("jobs/fetch.ts", 'import { tides } from "../api/src/tides";\nexport const fetchAll = () => tides("brest");\n');
    expect(draw("--update")).toMatchObject({ code: 0 });
    expect(asked()).toEqual(["parts", "describe jobs/fetch.ts"]);
    expect(levelOf(chart(), null).inside.map((card) => card.label)).toContain("The jobs");
  });

  test("leaves a folder another drawing holds alone, without a word in its progress", () => {
    const standIn = join(work, "stand-in", "draw", "draw.js");
    mkdirSync(join(standIn, ".."), { recursive: true });
    writeFileSync(standIn, "setTimeout(() => {}, 60000);");
    const holder = Bun.spawn(["bun", standIn]);
    try {
      writeFileSync(join(project, ".chartroom", "pid"), String(holder.pid));
      const before = readFileSync(join(project, ".chartroom", "progress.json"), "utf8");
      expect(draw("--update")).toMatchObject({ code: 1, err: expect.stringContaining("a drawing of this folder runs already") });
      expect(readFileSync(join(project, ".chartroom", "progress.json"), "utf8")).toBe(before);
      expect(readFileSync(join(project, ".chartroom", "pid"), "utf8")).toBe(String(holder.pid));
    } finally {
      holder.kill();
    }
  });

  test("takes over the pid a drawing that died left", () => {
    writeFileSync(join(project, ".chartroom", "pid"), String(process.pid));
    expect(draw("--update")).toMatchObject({ code: 0 });
    expect(existsSync(join(project, ".chartroom", "pid"))).toBe(false);
  });

  test("does not draw the home folder", () => {
    expect(draw("home")).toMatchObject({ code: 1, err: expect.stringContaining("the home folder is not a project") });
  });

  test("says why it failed when Claude cannot answer", () => {
    expect(draw("fail").code).toBe(1);
    expect(progress()).toMatchObject({ step: "failed", error: expect.stringContaining("Not logged in") });
  });
});
