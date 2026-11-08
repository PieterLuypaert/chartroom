// A plain-English name and description for every file and endpoint, asked of Claude one batch of
// a part's files at a time, several batches at once. Each file goes with a short digest of what
// the scan saw in it and its first lines, so a batch is one quick answer without tools.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { askClaude } from "./claude.js";

// Adds a value to the list a map keeps under a key, in place: copying the list for each value grows
// with the square of a big project's size.
const push = (map, key, value) => {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
};

const BATCH = 40;
const AT_ONCE = 4;
const HEAD_LINES = 24;
const MAX_LINE = 160;
// Describing is many small answers, so it runs on a faster model than finding the parts.
const MODEL = process.env.CHARTROOM_DESCRIBE_MODEL || "sonnet";

const text = { type: "string" };
const answers = (key) => ({ type: "array", items: { type: "object", required: [key, "name", "description"], properties: { [key]: text, name: text, description: text } } });
export const DESCRIBE_SCHEMA = { type: "object", required: ["files", "endpoints"], properties: { files: answers("path"), endpoints: answers("key") } };

export const routeKey = (route) => `${route.m} ${route.p} @ ${route.file}`;
const baseName = (path) => path.slice(path.lastIndexOf("/") + 1);

// The files in batches, each batch one part's files.
export function batchesOf(files, owner) {
  const byPart = new Map();
  for (const file of files) {
    const part = owner.get(file.path) ?? null;
    push(byPart, part, file);
  }
  const batches = [];
  for (const [part, list] of byPart) for (let start = 0; start < list.length; start += BATCH) batches.push({ part, files: list.slice(start, start + BATCH) });
  return batches;
}

// Which files each file uses, and how many use it, from the scan's links.
export function usesOf(links) {
  const uses = new Map();
  const usedBy = new Map();
  for (const link of links) {
    push(uses, link.a, link.b);
    usedBy.set(link.b, (usedBy.get(link.b) ?? 0) + 1);
  }
  return { uses, usedBy };
}

export function describePrompt({ project, part, digests }) {
  return [
    `You are naming the files of ${project.name}: ${project.summary}`,
    part ? `These files are in its part "${part.label}": ${part.summary}` : "These files are in no part yet.",
    "",
    "For every file below, give a short name (two to five words, as the app's owner would say it: \"Checkout page\", \"Card payments\") and one sentence on what it does for the app and the people who use it, in plain everyday words. For every endpoint, the same: what asking it does. Use the path or key exactly as given, and answer for all of them.",
    "Say only what the code and the facts shown say it does: all it defines and every test it holds are listed, so let the sentence cover the file as a whole, not only its first lines. Leave out what you could only guess from a file's name or folder, or from the name of a parameter or option: one counts only where the code shown uses it.",
    "",
    ...digests,
  ].join("\n");
}

// At most `most` of a list, joined, and how many more there are.
const upTo = (list, most, joiner) => list.slice(0, most).join(joiner) + (list.length > most ? ` and ${list.length - most} more` : "");
const MAX_NAMES = 60;
const MAX_TITLE = 100;

// What the scan saw in a file, and its first lines past the imports: every name it defines and every
// test it holds (up to 60 each), so a big file is described by all it holds.
export function digestOf(file, { uses, usedBy, routes, head }) {
  const lines = [`FILE ${file.path} (${file.loc} lines)`];
  if (file.doc) lines.push(`  comment: ${file.doc}`);
  if (file.defs.length) lines.push(`  defines: ${upTo(file.defs, MAX_NAMES, ", ")}`);
  if (file.tests?.length) lines.push(`  tests: ${upTo(file.tests.map((title) => title.slice(0, MAX_TITLE)), MAX_NAMES, "; ")}`);
  if (uses.length) lines.push(`  uses: ${[...new Set(uses.map(baseName))].slice(0, 10).join(", ")}`);
  if (file.programs?.length) lines.push(`  runs: ${file.programs.join(", ")}`);
  if (usedBy) lines.push(`  used by ${usedBy} file${usedBy === 1 ? "" : "s"}`);
  for (const route of routes) lines.push(`  ENDPOINT ${routeKey(route)}`);
  if (head.length) lines.push("  starts with:", ...head.map((line) => `    ${line}`));
  return lines.join("\n");
}

export function headOf(source) {
  return source.split("\n")
    .filter((line) => line.trim() && !/^\s*(import\b|export\s+\*?\s*\{?[^(]*\bfrom\b|from\s+\S+\s+import\b|use\s+[\w\\]+;|package\s|#!|<\?php|["']use (strict|client|server)["'])/.test(line))
    .slice(0, HEAD_LINES)
    .map((line) => line.slice(0, MAX_LINE));
}

// Every batch described, AT_ONCE at a time. A batch Claude could not do is left out and its error
// kept; the files in it are asked for again on the next update.
export async function describeAll({ root, project, parts, batches, scan, onDone }) {
  const { uses, usedBy } = usesOf(scan.links);
  const routesOf = new Map();
  for (const route of scan.routes) push(routesOf, route.file, route);
  const result = { files: [], endpoints: [], errors: [] };
  let next = 0;
  let done = 0;
  const work = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      try {
        const digests = await Promise.all(batch.files.map(async (file) => digestOf(file, { uses: uses.get(file.path) ?? [], usedBy: usedBy.get(file.path) ?? 0, routes: routesOf.get(file.path) ?? [], head: headOf(await readFile(join(root, file.path), "utf8")) })));
        const answer = await askClaude({ cwd: root, prompt: describePrompt({ project, part: parts.get(batch.part), digests }), schema: DESCRIBE_SCHEMA, model: MODEL });
        result.files.push(...answer.files);
        result.endpoints.push(...answer.endpoints);
      } catch (error) {
        if (error.isFinal) throw error;
        result.errors.push(error.message);
      }
      done += batch.files.length;
      await onDone(done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, batches.length) }, work));
  return result;
}
