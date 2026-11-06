import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readChart } from "../mods/chartroom/model.js";
import { askPrompt, checkAnswer } from "../draw/ask.js";

const fixture = join(import.meta.dir, "tide-tables.json");
const chart = readChart(readFileSync(fixture, "utf8"));
const work = realpathSync(mkdtempSync(join(tmpdir(), "chartroom-ask-")));
const project = join(work, "tide-tables");
const fakeClaude = join(work, "claude");
const claudeLog = join(work, "claude.log");

function ask(id, question, flags = []) {
  const run = Bun.spawnSync(["bun", join(import.meta.dir, "..", "draw", "ask.js"), project, String(id), JSON.stringify(question)], {
    env: { ...process.env, CHARTROOM_CLAUDE: fakeClaude, FAKE_CLAUDE_LOG: claudeLog, FAKE_CLAUDE_FAIL: flags.includes("fail") ? "1" : "" },
  });
  return { code: run.exitCode, record: JSON.parse(readFileSync(join(project, ".chartroom", "asks", `${id}.json`), "utf8")) };
}

beforeAll(() => {
  writeFileSync(fakeClaude, `#!/bin/sh\nexec bun ${join(import.meta.dir, "fake-claude.js")} "$@"\n`);
  chmodSync(fakeClaude, 0o755);
  mkdirSync(join(project, ".chartroom"), { recursive: true });
  copyFileSync(fixture, join(project, ".chartroom", "chart.json"));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe("askPrompt", () => {
  test("gives Claude the app's parts with the ids to name them by, and the question", () => {
    const prompt = askPrompt(chart, { question: "Where do tides come from?", card: null, focus: null });
    expect(prompt).toContain("CARD n:api  Server — service. Answers the website and the jobs.");
    expect(prompt).toContain("CARD n:api.routes  Requests — feature, in n:api.");
    expect(prompt.endsWith("Question: Where do tides come from?")).toBe(true);
  });

  test("adds the card asked about: its files, what it uses and what uses it", () => {
    const prompt = askPrompt(chart, { question: "What breaks if it goes?", card: "n:api.routes", focus: "api" });
    expect(prompt).toContain("The question is about this card: CARD n:api.routes  Requests");
    expect(prompt).toContain("CARD f:api/src/routes/tides.ts  Tide times — The tides of one port.");
    expect(prompt).toContain("It uses:\n  Storage (n:api.store)");
    expect(prompt).toContain("It is used by:\n  Website (n:site): GET /tides/:port, GET /ports");
  });

  test("lists a file's endpoints", () => {
    expect(askPrompt(chart, { question: "?", card: "f:api/src/routes/tides.ts", focus: "api.routes" })).toContain("Its endpoints:\n  GET /tides/:port — Tides of a port");
  });
});

describe("checkAnswer", () => {
  test("keeps the cards the chart has, once each, and trims the answer", () => {
    expect(checkAnswer(chart, { answer: " Yes. ", cards: ["n:api", "f:jobs/fetch.py", "n:api", "n:gone", "f:gone.ts"] })).toEqual({ answer: "Yes.", cards: ["n:api", "f:jobs/fetch.py"] });
  });
});

describe("draw/ask.js", () => {
  test("answers with Claude's words and the cards it names that the chart has", () => {
    const { code, record } = ask(1001, { question: "What does the server do?", card: "n:api", focus: null });
    expect(code).toBe(0);
    expect(record).toMatchObject({ id: "1001", question: "What does the server do?", card: "n:api", status: "done", answer: "It is about n:site and n:site.pages.", cards: ["n:site", "n:site.pages"] });
    expect(readFileSync(claudeLog, "utf8")).toContain("ask What does the server do?");
  });

  test("says why there is no answer when Claude cannot give one", () => {
    const { code, record } = ask(1002, { question: "Anything?" }, ["fail"]);
    expect(code).toBe(1);
    expect(record).toMatchObject({ status: "failed", error: expect.stringContaining("Not logged in") });
  });

  test("keeps the latest twenty answers of a project", () => {
    const dir = join(project, ".chartroom", "asks");
    for (let id = 1; id <= 25; id += 1) writeFileSync(join(dir, `${id}.json`), "{}");
    ask(2000, { question: "Last one" });
    const kept = readdirSync(dir).filter((name) => name.endsWith(".json"));
    expect(kept.length).toBe(20);
    expect(kept).toContain("2000.json");
  });
});

describe("draw/ask.js explaining a card", () => {
  test("keeps the explanation under the card's key, with the chart it was made for", async () => {
    const { explainKey } = await import("../mods/chartroom/find.js");
    const key = explainKey("n:api");
    const run = Bun.spawnSync(["bun", join(import.meta.dir, "..", "draw", "ask.js"), project, key, JSON.stringify({ explain: true, card: "n:api", focus: null })], { env: { ...process.env, CHARTROOM_CLAUDE: fakeClaude, FAKE_CLAUDE_LOG: claudeLog } });
    expect(run.exitCode).toBe(0);
    const record = JSON.parse(readFileSync(join(project, ".chartroom", "explains", `${key}.json`), "utf8"));
    expect(record).toMatchObject({ id: key, card: "n:api", explain: true, status: "done", cards: ["n:site", "n:site.pages"] });
    expect(record.question).toContain("Explain this card");
  });

  test("refuses an explanation under another card's key", () => {
    const run = Bun.spawnSync(["bun", join(import.meta.dir, "..", "draw", "ask.js"), project, "abc", JSON.stringify({ explain: true, card: "n:api" })], { env: { ...process.env, CHARTROOM_CLAUDE: fakeClaude } });
    expect(run.exitCode).not.toBe(0);
  });
});
