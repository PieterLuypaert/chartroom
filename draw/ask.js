// Answers a question about a project's chart with the person's own Claude:
//
//   bun draw/ask.js <folder> <id> '{"question": "...", "card": "n:api" | "f:path" | null, "focus": "api" | null}'
//
// The Chartroom panel runs it in the background, as an answer can take longer than the panel may
// wait for a program. It writes .chartroom/asks/<id>.json at once (asking, with its pid to stop
// it), then again with Claude's answer and the parts and files it is about, or with why there is
// none. Claude gets the chart as its map and may read the code with the tools that only read.
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { askClaude, stopAll } from "./claude.js";
import { detailsOf, levelOf, readChart } from "../mods/chartroom/model.js";

const ASK_TOOLS = ["Read", "Grep", "Glob"];
// How much of the chart goes along, and how many answers a project keeps.
const MAX_PARTS = 150;
const MAX_FILES = 80;
const MAX_CARDS = 8;
const KEPT = 20;

const text = { type: "string" };
export const ASK_SCHEMA = { type: "object", required: ["answer", "cards"], properties: { answer: text, cards: { type: "array", items: text } } };

// The project's chart: the Chartroom's own, else floorplan's.
export async function chartIn(folder) {
  for (const path of [join(folder, ".chartroom", "chart.json"), join(folder, "floorplan", "graph.json")]) {
    const found = await readFile(path, "utf8").catch(() => null);
    if (found !== null) return readChart(found);
  }
  throw new Error("this project has no chart to ask about yet");
}

const cardLine = (ref, label, about) => `CARD ${ref}  ${label}${about ? ` — ${about}` : ""}`;

// What Claude is told: who it answers, the app and its parts with the ids to name them by, the card
// asked about with its files or endpoints and what it uses and what uses it, then the question.
export function askPrompt(chart, { question, card, focus }) {
  const parts = [...chart.nodes.values()].slice(0, MAX_PARTS).map((node) => cardLine(`n:${node.id}`, node.label, `${node.kind}${node.parent ? `, in n:${node.parent}` : ""}. ${node.summary ?? ""}`.trim()));
  return [
    `You are answering a question about the code in this folder, for the person who owns the app, who may not read code. Answer in plain everyday words, in at most about 150 words: short paragraphs or a short list, in Markdown. Read the code with your tools where the chart below is not enough, and name a file by its path when it helps.`,
    `In "cards", list the ids (exactly as written after CARD below) of the parts and files your answer is about, at most ${MAX_CARDS}, the most important first.`,
    "",
    `The app: ${chart.name}. ${chart.summary}`,
    "",
    "Its parts:",
    ...parts,
    ...subjectLines(chart, card, focus),
    "",
    `Question: ${question}`,
  ].join("\n");
}

function subjectLines(chart, card, focus) {
  if (!card) return [];
  const level = levelOf(chart, focus);
  const details = detailsOf(level, card);
  const lines = ["", `The question is about this card: ${details ? cardLine(card, details.card.label, details.card.summary) : card}`];
  if (card.startsWith("n:")) {
    const files = [...chart.files.values()].filter((file) => file.n === card.slice(2)).slice(0, MAX_FILES);
    if (files.length) lines.push("Its own files:", ...files.map((file) => cardLine(`f:${file.p}`, file.name || file.p, file.d)));
  } else {
    const routes = chart.routes.filter((route) => route.f === card.slice(2));
    if (routes.length) lines.push("Its endpoints:", ...routes.map((route) => `  ${route.m} ${route.p} — ${route.name ?? ""}`));
  }
  for (const [title, ends] of [["It uses", details?.uses ?? []], ["It is used by", details?.usedBy ?? []]]) {
    if (ends.length) lines.push(`${title}:`, ...ends.map(({ card: other, line }) => `  ${other.label} (${other.id})${line.labels.length ? `: ${line.labels.slice(0, 6).join(", ")}` : ""}`));
  }
  return lines;
}

// Claude's answer with only the cards the chart has, once each.
export function checkAnswer(chart, answer) {
  const isKnown = (ref) => (ref.startsWith("n:") && chart.nodes.has(ref.slice(2))) || (ref.startsWith("f:") && chart.files.has(ref.slice(2)));
  return { answer: answer.answer.trim(), cards: [...new Set(answer.cards.map((ref) => ref.trim()).filter(isKnown))].slice(0, MAX_CARDS) };
}

async function writeWhole(path, value) {
  await writeFile(`${path}.tmp`, JSON.stringify(value));
  await rename(`${path}.tmp`, path);
}

// Only the latest answers stay: their ids are when they were asked.
async function prune(dir) {
  const names = (await readdir(dir)).filter((name) => /^\d+\.json$/.test(name)).sort();
  for (const name of names.slice(0, Math.max(0, names.length - KEPT))) await rm(join(dir, name), { force: true });
}

async function main() {
  const [folder, id, payload] = process.argv.slice(2);
  if (!folder || !/^\d+$/.test(id ?? "") || !payload) throw new Error("usage: bun draw/ask.js <folder> <id> '<question as JSON>'");
  const { question, card = null, focus = null } = JSON.parse(payload);
  const dir = join(folder, ".chartroom", "asks");
  const path = join(dir, `${id}.json`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(folder, ".chartroom", ".gitignore"), "*\n");
  const record = { id, question, card, focus, status: "asking", pid: process.pid, startedAt: new Date().toISOString() };
  await writeWhole(path, record);
  process.on("SIGTERM", async () => {
    stopAll();
    await writeWhole(path, { ...record, status: "stopped", endedAt: new Date().toISOString() });
    process.exit(1);
  });
  try {
    const chart = await chartIn(folder);
    const answer = await askClaude({ cwd: folder, prompt: askPrompt(chart, { question, card, focus }), schema: ASK_SCHEMA, tools: ASK_TOOLS });
    await writeWhole(path, { ...record, status: "done", ...checkAnswer(chart, answer), endedAt: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    await writeWhole(path, { ...record, status: "failed", error: error.message, endedAt: new Date().toISOString() });
    process.exitCode = 1;
  } finally {
    await prune(dir);
  }
}

if (import.meta.main) await main();
