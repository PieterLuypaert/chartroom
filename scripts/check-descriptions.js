// How true the chart's descriptions are, measured: for each project folder given, a sample of its
// files that have not changed since their drawing is described again with draw/describe.js as it is
// now, and a stronger model reads each file whole and judges the description against it: right,
// partly (true but missing the file's main job, or too vague), or wrong (says what the code does
// not do). With --compare, the chart's own descriptions of the same files are judged too, so a
// change to describing can be measured before and after on the same files.
//
//   bun scripts/check-descriptions.js [--sample 10] [--compare] <folder>...
//
// It runs on the person's own Claude (a describing call for each part in the sample, and one or two
// judging calls a folder),
// so only by hand: no test runs it. The sample is the same every time for the same files.
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { askClaude } from "../draw/claude.js";
import { DESCRIBE_SCHEMA, describePrompt, digestOf, headOf, usesOf } from "../draw/describe.js";
import { scan } from "../draw/scan.js";

const JUDGE_MODEL = "claude-opus-5-5";
const DESCRIBE_MODEL = process.env.CHARTROOM_DESCRIBE_MODEL || "sonnet";
const MAX_CHARS = 15000;
const VERDICTS = ["right", "partly", "wrong"];
const JUDGE_SCHEMA = {
  type: "object",
  required: ["files"],
  properties: { files: { type: "array", items: { type: "object", required: ["path", "verdict", "reason"], properties: { path: { type: "string" }, verdict: { type: "string", enum: VERDICTS }, reason: { type: "string" } } } } },
};

const args = process.argv.slice(2);
const isCompare = args.includes("--compare");
const sampleAt = args.indexOf("--sample");
const perFolder = sampleAt >= 0 ? Number(args[sampleAt + 1]) : 10;
const folders = args.filter((arg, index) => !arg.startsWith("--") && index !== sampleAt + 1);
if (!folders.length) throw new Error("usage: bun scripts/check-descriptions.js [--sample 10] [--compare] <folder>...");

// The files described in the folder's chart and unchanged since, in an order fixed by their paths.
function sampleOf(folder, chart, state, count) {
  const unchanged = chart.files.filter((file) => {
    if (!file.d || !existsSync(join(folder, file.p))) return false;
    return state.files?.[file.p]?.hash === Bun.hash(readFileSync(join(folder, file.p), "utf8")).toString(16);
  });
  const order = (file) => Number(Bun.hash(`seed:${file.p}`) % 1000003n);
  return { unchanged: unchanged.length, sample: unchanged.sort((a, b) => order(a) - order(b)).slice(0, count) };
}

// The sampled files described again, as a drawing describes them now.
async function describedAgain(folder, chart, sample) {
  const scanned = await scan(folder);
  const { uses, usedBy } = usesOf(scanned.links);
  const byPath = new Map(scanned.files.map((file) => [file.path, file]));
  const parts = new Map(chart.nodes.map((node) => [node.id, node]));
  const digestFor = async (one) => {
    const file = byPath.get(one.p);
    const routes = scanned.routes.filter((route) => route.file === one.p);
    return digestOf(file, { uses: uses.get(one.p) ?? [], usedBy: usedBy.get(one.p) ?? 0, routes, head: headOf(await readFile(join(folder, one.p), "utf8")) });
  };
  // A part's files together, with that part's summary, as a drawing describes them.
  const byPart = new Map();
  for (const one of sample) byPart.set(one.n, [...(byPart.get(one.n) ?? []), one]);
  const described = new Map();
  await Promise.all([...byPart].map(async ([part, files]) => {
    const digests = await Promise.all(files.map(digestFor));
    const answer = await askClaude({ cwd: folder, prompt: describePrompt({ project: chart.project ?? { name: chart.name, summary: "" }, part: parts.get(part), digests }), schema: DESCRIBE_SCHEMA, model: DESCRIBE_MODEL });
    for (const file of answer.files) described.set(file.path, { name: file.name, d: file.description });
  }));
  return described;
}

async function judged(folder, chart, sample, descriptions) {
  const parts = new Map(chart.nodes.map((node) => [node.id, node]));
  const blocks = sample.map((file) => {
    const text = readFileSync(join(folder, file.p), "utf8");
    const given = descriptions.get(file.p) ?? { name: "(none)", d: "(none)" };
    const part = parts.get(file.n);
    return [`FILE ${file.p}`, `In part: ${part?.label ?? file.n}: ${part?.summary ?? ""}`, `Name given: ${given.name}`, `Description given: ${given.d}`,
      `Code${text.length > MAX_CHARS ? ` (first ${MAX_CHARS} of ${text.length} characters)` : ""}:`, "```", text.slice(0, MAX_CHARS), "```"].join("\n");
  });
  const prompt = [
    `You are checking the names and one-sentence descriptions an app wrote for source files of the project "${chart.project?.name ?? folder}" (${chart.project?.summary ?? ""}).`,
    "For every FILE below you get its code and the name and description the app gave it. Judge the description against the code alone:",
    "- right: it says correctly and specifically what the file does for the app.",
    "- partly: nothing in it is false, but it misses the file's main job, or is too vague to tell this file from others.",
    "- wrong: it says something the code does not do, or gets the file's job wrong.",
    "Give one short sentence of reason for each, and answer for every file, with its path exactly as given.",
    "",
    ...blocks,
  ].join("\n");
  const answer = await askClaude({ cwd: folder, prompt, schema: JUDGE_SCHEMA, model: JUDGE_MODEL });
  return answer.files;
}

const tally = (verdicts) => Object.fromEntries(VERDICTS.map((verdict) => [verdict, verdicts.filter((one) => one.verdict === verdict).length]));
const words = (counts) => VERDICTS.map((verdict) => `${verdict} ${counts[verdict]}`).join(", ");
const totals = { now: { right: 0, partly: 0, wrong: 0 }, chart: { right: 0, partly: 0, wrong: 0 } };
const misses = [];

await Promise.all(folders.map(async (folder) => {
  const chart = JSON.parse(readFileSync(join(folder, ".chartroom", "chart.json"), "utf8"));
  const state = JSON.parse(readFileSync(join(folder, ".chartroom", "state.json"), "utf8"));
  const { unchanged, sample } = sampleOf(folder, chart, state, perFolder);
  if (!sample.length) return console.log(`${folder}: no file unchanged since its drawing`);
  const again = await describedAgain(folder, chart, sample);
  const now = await judged(folder, chart, sample, again);
  const before = isCompare ? await judged(folder, chart, sample, new Map(sample.map((file) => [file.p, { name: file.name, d: file.d }]))) : null;
  const name = folder.split("/").pop();
  for (const verdict of VERDICTS) {
    totals.now[verdict] += tally(now)[verdict];
    if (before) totals.chart[verdict] += tally(before)[verdict];
  }
  for (const one of now) if (one.verdict !== "right") misses.push(`[${one.verdict}] ${name} ${one.path}\n   now: ${again.get(one.path)?.d}\n   judge: ${one.reason}`);
  console.log(`${name}: ${sample.length} of ${unchanged} files unchanged since drawn | now: ${words(tally(now))}${before ? ` | the chart's: ${words(tally(before))}` : ""}`);
}));

const share = (counts) => {
  const all = VERDICTS.reduce((sum, verdict) => sum + counts[verdict], 0);
  return `${all} files: ${VERDICTS.map((verdict) => `${verdict} ${counts[verdict]} (${Math.round((100 * counts[verdict]) / Math.max(1, all))}%)`).join(", ")}`;
};
console.log(`\nnow: ${share(totals.now)}`);
if (isCompare) console.log(`the chart's: ${share(totals.chart)}`);
if (misses.length) console.log(`\n${misses.join("\n")}`);
