import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asksFor, asksFrom, CHANGED, explainKey, FIND_ASKS, FIND_EXPLAIN, FIND_MAP, mapFrom, START_ASK, START_DRAW } from "../mods/chartroom/find.js";
import { cardIdOn, isExplanationCurrent, levelOf, readChart } from "../mods/chartroom/model.js";
import { elkLevel, fromElk } from "../mods/chartroom/layout.js";
import { minimapOf } from "../mods/chartroom/minimap.js";

// The whole way the panel takes, end to end: the same shell snippets it runs, the real draw/
// scripts in the background, and a fake claude in place of the real one. A project in a home of
// its own is drawn, its levels laid out by ELK, asked about per card and per level, explained,
// and brought up to date after a commit.
const root = join(import.meta.dir, "..");
const script = (name) => join(root, "draw", name);
const work = realpathSync(mkdtempSync(join(tmpdir(), "chartroom-e2e-")));
const home = join(work, "home");
const project = join(home, "code", "tide-tables");
const fakeClaude = join(work, "claude");
const claudeLog = join(work, "claude.log");
const env = { HOME: home, PATH: process.env.PATH, CHARTROOM_CLAUDE: fakeClaude, FAKE_CLAUDE_LOG: claudeLog };
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
const git = (...args) => Bun.spawnSync(["git", "-C", project, "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { env });
const sh = (snippet, ...args) => {
  const run = Bun.spawnSync(["sh", "-c", snippet, "e2e", ...args], { env });
  return { code: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
};
const until = async (what, isDone, ms = 20000) => {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(100)) {
    const value = what();
    if (isDone(value)) return value;
  }
  throw new Error(`timed out after ${ms} ms waiting for ${what}`);
};
const map = () => mapFrom(sh(FIND_MAP, join(project, "web", "src")).stdout);
// A drawing that ended after `since` (the start of the one before it).
const drawn = (since = "") => until(map, (found) => !found.isDrawing && ["done", "failed"].includes(found.progress?.step) && found.progress.startedAt > since);
const asked = () => readFileSync(claudeLog, "utf8").trim().split("\n");
const asks = () => asksFrom(sh(FIND_ASKS, project).stdout);

beforeAll(() => {
  writeFileSync(fakeClaude, `#!/bin/sh\nexec bun ${join(import.meta.dir, "fake-claude.js")} "$@"\n`);
  chmodSync(fakeClaude, 0o755);
  for (const [path, text] of Object.entries(files)) write(path, text);
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "tides");
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("a project drawn, explored, asked about and updated", () => {
  let chart;
  let raw;

  test("Draw the chart: draws in the background, found from a folder deep inside the project", async () => {
    expect(sh(START_DRAW, project, script("draw.js"))).toMatchObject({ code: 0, stdout: "started\n" });
    const found = await drawn();
    expect(found).toMatchObject({ folder: project, kind: "chartroom", progress: { step: "done" } });
    raw = JSON.parse(found.text);
    chart = readChart(found.text);
    expect(chart.name).toBe("Tide Tables");
    expect([...chart.nodes.keys()].sort()).toEqual(["api", "stripe", "web"]);
    expect(asked()[0]).toBe("parts");
  }, 30000);

  test("keeps everything it writes out of git", () => {
    expect(readFileSync(join(project, ".chartroom", ".gitignore"), "utf8")).toBe("*\n");
    expect(git("status", "--porcelain").stdout.toString()).toBe("");
  });

  test("shows the top level and a part's level, laid out by ELK with every card placed and every line drawn", () => {
    const top = levelOf(chart, null);
    const api = levelOf(chart, "api");
    const payload = JSON.stringify({ levels: [elkLevel("top:RIGHT", top, "RIGHT"), elkLevel("api:DOWN", api, "DOWN")] });
    const run = Bun.spawnSync(["bun", script("lay.js"), payload], { env });
    expect(run.exitCode).toBe(0);
    const { layouts } = JSON.parse(run.stdout.toString());
    // As the panel does: ELK's places, with the direction they were asked in.
    const placed = (key, level, direction) => fromElk(level, { ...layouts[key], direction }, { zoom: 1, viewWidth: 1200, insideLabel: level.focus === null ? "Parts" : "Inside" });
    for (const [key, level, direction] of [["top:RIGHT", top, "RIGHT"], ["api:DOWN", api, "DOWN"]]) {
      expect(layouts[key].error).toBeUndefined();
      const laid = placed(key, level, direction);
      expect(laid.cards.length).toBe(level.inside.length + level.outside.length);
      expect(laid.lines.length).toBe(level.lines.length);
      for (const line of laid.lines) expect(line.points.length).toBeGreaterThanOrEqual(2);
    }
    const laid = placed("top:RIGHT", top, "RIGHT");
    expect(laid.bands.map((band) => band.label)).toContain("Parts");
    const minimap = minimapOf(laid.cards, { view: { width: 600, height: 400 }, pan: { x: 0, y: 0 } });
    expect(minimap.cards.length).toBe(laid.cards.length);
    expect(minimap.viewport.w).toBeGreaterThan(0);
  });

  test("Ask: a question about a card and one about the level each stay with what they were asked about", async () => {
    expect(sh(START_ASK, project, script("ask.js"), "1001", JSON.stringify({ question: "What does the api do?", card: "n:api", focus: null })).code).toBe(0);
    expect(sh(START_ASK, project, script("ask.js"), "1002", JSON.stringify({ question: "What is this app?", card: null, focus: null })).code).toBe(0);
    const answers = await until(asks, (found) => found.length === 2 && found.every((one) => one.status === "done"));
    expect(asksFor(answers, { focus: null, card: "n:api" }).map((one) => one.question)).toEqual(["What does the api do?"]);
    expect(asksFor(answers, { focus: null, card: null }).map((one) => one.question)).toEqual(["What is this app?"]);
    expect(asksFor(answers, { focus: null, card: "n:web" })).toEqual([]);
    expect(asksFor(answers, { focus: "api", card: null })).toEqual([]);
    for (const one of answers) {
      expect(one.cards.length).toBeGreaterThan(0);
      for (const ref of one.cards) expect(cardIdOn(chart, null, ref)).not.toBeNull();
    }
  }, 30000);

  const explained = {};
  test("Explain this: keeps the card's explanation with what the card was drawn from", async () => {
    for (const card of ["n:web", "n:api"]) {
      const key = explainKey(card);
      expect(sh(START_ASK, project, script("ask.js"), key, JSON.stringify({ explain: true, card, focus: null })).code).toBe(0);
      explained[card] = await until(() => asksFrom(sh(FIND_EXPLAIN, project, key).stdout)[0], (found) => found?.status === "done");
      expect(explained[card]).toMatchObject({ card, chart: raw.meta.generatedAt, rev: raw.nodes.find((node) => `n:${node.id}` === card).rev });
      expect(explained[card].answer.length).toBeGreaterThan(0);
    }
  }, 30000);

  test("Update: notices a commit, describes only the file that changed, keeps the explanations it did not touch, and is current again", async () => {
    const changed = () => sh(CHANGED, project, join(project, ".chartroom", "chart.json"), ...raw.meta.repos.flatMap((repo) => [repo.path ?? "", repo.head])).stdout.trim();
    expect(changed()).toBe("0 0");
    write("api/src/tides.ts", "/** The tides of one port, high and low. */\nexport function tides(port: string) { return [port]; }\n");
    git("commit", "-q", "-am", "high and low");
    expect(changed()).toBe("1 0");

    truncateSync(claudeLog);
    const before = map().progress.startedAt;
    expect(sh(START_DRAW, project, script("draw.js"), "--update")).toMatchObject({ code: 0, stdout: "started\n" });
    const found = await drawn(before);
    expect(found.progress).toMatchObject({ step: "done", isUpdate: true });
    expect(asked()).toEqual(["describe api/src/tides.ts"]);
    raw = JSON.parse(found.text);
    expect(isExplanationCurrent(readChart(found.text), explained["n:web"])).toBe(true);
    expect(isExplanationCurrent(readChart(found.text), explained["n:api"])).toBe(false);
    expect(changed()).toBe("0 0");
    expect(existsSync(join(project, ".chartroom", "pid"))).toBe(false);
  }, 30000);
});
