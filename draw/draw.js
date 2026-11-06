// Draws a project's chart with the person's own Claude:
//
//   bun draw/draw.js <folder> [--update]
//
// The Chartroom panel runs it in the background. It reads the code, asks Claude for the app's parts,
// then for a name and a description of every file and endpoint, and writes the chart to
// <folder>/.chartroom/chart.json. While it works, .chartroom/progress.json says how far it is and
// .chartroom/pid which process to stop. An update asks only about what changed since the last
// chart, and for the parts again only when many files fit none of them.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { askClaude, stopAll } from "./claude.js";
import { assign, checkParts, PARTS_SCHEMA, partsPrompt } from "./parts.js";
import { batchesOf, describeAll, routeKey } from "./describe.js";
import { buildChart } from "./build.js";
import { scan } from "./scan.js";

// More than this share of files in no part asks Claude for the parts again on an update.
const UNASSIGNED_SHARE = 0.15;
const PARTS_TOOLS = ["Read", "Grep", "Glob"];

const folder = process.argv[2];
const isUpdate = process.argv.includes("--update");
const out = join(folder ?? ".", ".chartroom");
const progress = { pid: process.pid, step: "scan", isUpdate, startedAt: new Date().toISOString(), done: 0, total: 0, note: "", error: null };

// Written whole and then moved into place, so the panel never reads half of one.
async function writeWhole(path, text) {
  await writeFile(`${path}.tmp`, text);
  await rename(`${path}.tmp`, path);
}

// One write at a time, in order: the describing batches report at once. A failed write still
// rejects for its caller, and the next one goes ahead.
let writing = Promise.resolve();
function report(patch) {
  Object.assign(progress, patch, { updatedAt: new Date().toISOString() });
  const text = JSON.stringify(progress);
  writing = writing.catch(() => {}).then(() => writeWhole(join(out, "progress.json"), text));
  return writing;
}

async function readJson(name) {
  const text = await readFile(join(out, name), "utf8").catch(() => null);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    console.log(`chartroom: ${name} is not JSON, so the chart is drawn without it: ${error.message}`);
    return null;
  }
}

// The parts from the last chart, or Claude's when there were none or many files fit none of them.
async function partsFor(scanned, earlier) {
  if (earlier?.parts) {
    const owner = assign(scanned.files, earlier.parts.parts);
    const unassigned = scanned.files.filter((file) => !owner.get(file.path)).length;
    if (unassigned <= UNASSIGNED_SHARE * scanned.files.length) return { parts: earlier.parts, owner };
  }
  await report({ step: "parts", done: 0, total: 0, note: `${scanned.files.length} files in ${scanned.repos.length} repo${scanned.repos.length === 1 ? "" : "s"}` });
  const answer = await askClaude({ cwd: scanned.root, prompt: partsPrompt(scanned, earlier?.parts), schema: PARTS_SCHEMA, tools: PARTS_TOOLS });
  const parts = checkParts(answer);
  return { parts, owner: assign(scanned.files, parts.parts) };
}

// The names and descriptions: the last chart's for files that did not change, Claude's for the rest.
async function describedFor(scanned, parts, owner, earlier) {
  const files = { ...earlier?.files };
  const endpoints = { ...earlier?.endpoints };
  const fresh = scanned.files.filter((file) => files[file.path]?.hash !== file.hash || !files[file.path]?.name);
  const hashOf = new Map(fresh.map((file) => [file.path, file.hash]));
  await report({ step: "describe", done: 0, total: fresh.length, note: "" });
  const partsById = new Map(parts.parts.map((part) => [part.id, part]));
  const answer = await describeAll({ root: scanned.root, project: parts.project, parts: partsById, batches: batchesOf(fresh, owner), scan: scanned, onDone: (done) => report({ done }) });
  if (fresh.length && answer.errors.length && !answer.files.length) throw new Error(answer.errors[0]);
  for (const file of answer.files) if (hashOf.has(file.path)) files[file.path] = { hash: hashOf.get(file.path), name: file.name, d: file.description };
  for (const endpoint of answer.endpoints) endpoints[endpoint.key] = { name: endpoint.name, d: endpoint.description };
  const kept = new Set(scanned.files.map((file) => file.path));
  const keys = new Set(scanned.routes.map(routeKey));
  return {
    files: Object.fromEntries(Object.entries(files).filter(([path]) => kept.has(path))),
    endpoints: Object.fromEntries(Object.entries(endpoints).filter(([key]) => keys.has(key))),
    note: answer.errors.length ? `${answer.errors.length} batch${answer.errors.length === 1 ? "" : "es"} could not be described; an update asks again` : "",
  };
}

async function draw() {
  const scanned = await scan(folder, { onFile: (done, total) => (done % 250 === 0 || done === total) && report({ done, total }) });
  if (!scanned.files.length) throw new Error("there is no code here to chart");
  const earlier = isUpdate ? await readJson("state.json") : null;
  const { parts, owner } = await partsFor(scanned, earlier);
  const described = await describedFor(scanned, parts, owner, earlier);
  await report({ step: "build", note: described.note });
  const chart = buildChart({ scan: scanned, parts, owner, described });
  await writeWhole(join(out, "state.json"), JSON.stringify({ version: 1, parts, files: described.files, endpoints: described.endpoints }));
  await writeWhole(join(out, "chart.json"), JSON.stringify(chart));
  await report({ step: "done", done: progress.total });
}

async function stop() {
  stopAll();
  await report({ step: "stopped" });
  await rm(join(out, "pid"), { force: true });
  process.exit(1);
}

async function main() {
  if (!folder) throw new Error("usage: bun draw/draw.js <folder> [--update]");
  await mkdir(out, { recursive: true });
  // The folder keeps itself out of git, and nothing else in the project is touched.
  await writeFile(join(out, ".gitignore"), "*\n");
  await writeFile(join(out, "pid"), String(process.pid));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    await report({});
    await draw();
  } catch (error) {
    console.error(error);
    await report({ step: progress.step === "stopped" ? "stopped" : "failed", error: error.message });
    process.exitCode = 1;
  } finally {
    await rm(join(out, "pid"), { force: true });
  }
}

await main();
