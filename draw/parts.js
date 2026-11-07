// The parts of an app, as Claude sees them from the scan: what to ask, the shape of its answer,
// and which part each file belongs to.

export const KINDS = ["ui", "service", "worker", "feature", "library", "data", "config", "test", "misc"];
const MAX_TREE_LINES = 260;
const MAX_ENDPOINTS = 80;

const text = { type: "string" };
const texts = { type: "array", items: text };
export const PARTS_SCHEMA = {
  type: "object",
  required: ["project", "parts", "outside", "links"],
  properties: {
    project: { type: "object", required: ["name", "summary"], properties: { name: text, summary: text } },
    parts: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "parent", "label", "kind", "summary", "paths"],
        properties: { id: text, parent: { type: ["string", "null"] }, label: text, kind: { enum: KINDS }, summary: text, paths: texts },
      },
    },
    outside: {
      type: "array",
      items: { type: "object", required: ["id", "label", "summary", "packages", "hosts"], properties: { id: text, label: text, summary: text, packages: texts, hosts: texts } },
    },
    links: {
      type: "array",
      items: { type: "object", required: ["from", "to", "label"], properties: { from: text, to: text, label: text } },
    },
  },
};

// What Claude is asked: the project's folders with how much code is in each, its endpoints, the
// packages and outside addresses its code uses, and what a good answer looks like. With the parts
// of an earlier chart, it is asked to keep them where they still fit.
export function partsPrompt(scan, earlier = null) {
  const packages = countBy(scan.files.flatMap((file) => file.packages));
  const hosts = countBy(scan.files.flatMap((file) => file.hosts));
  const endpoints = scan.routes.slice(0, MAX_ENDPOINTS).map((route) => `${route.m} ${route.p}  (${route.file})`);
  return [
    `You are mapping the code in this folder (${scan.name}) so its owner can see how the app fits together. Read what you need (README files, entry points, configuration) with your tools, then answer in the JSON shape asked for.`,
    "",
    "Write for the person who owns the app, who may not read code: plain everyday words about what each part does for the app and its users (\"Takes card payments at checkout\", not \"Stripe API wrapper\").",
    "",
    "What to give:",
    "- project: the app's name as its people would say it, and two or three sentences on what it does and for whom.",
    "- parts: the main parts of the app, 3 to 9 at the top (parent null). Split a big part (more than about 25 files) into 2 to 8 parts inside it (parent: its id), and those again when still big, three levels at most. Each part's id is short, lowercase, and a child's starts with its parent's (\"api\", \"api.billing\"). kind is one of: ui (an app or site people use), service (a server), worker (background jobs), feature, library (shared code), data (storage and records), config (setup), test, misc. paths are glob patterns relative to this folder (\"apps/web/src/**\", \"api/src/routes/*.ts\") that together cover every file listed below; a file goes to the deepest part one of whose patterns matches it.",
    "- outside: the outside services the code really talks to (payments, email, databases, storage, other companies' APIs), each with the packages or hosts below that show it.",
    "- links: only connections the import and request lists cannot show (a queue, a webhook, a schedule, one app calling another by a configured address), from one part or outside service id to another, with a few words on what goes along it.",
    ...(earlier ? ["", "The chart had these parts before. Keep their ids, names and patterns where they still fit, and change only what the code no longer matches:", JSON.stringify(earlier.parts.map(({ id, parent, label, paths }) => ({ id, parent, label, paths })))] : []),
    "",
    `Repos: ${scan.repos.map((repo) => repo.path || ".").join(", ")}`,
    `Code files: ${scan.files.length}`,
    "",
    "Folders, with their code files and lines:",
    ...treeOf(scan.files),
    "",
    `Endpoints (${scan.routes.length}):`,
    ...(endpoints.length ? endpoints : ["(none found)"]),
    "",
    `Packages the code imports, most used first: ${packages.slice(0, 50).map(([name, count]) => `${name} (${count})`).join(", ") || "(none)"}`,
    `Outside addresses the code calls: ${hosts.map(([name]) => name).join(", ") || "(none found)"}`,
  ].join("\n");
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

// The folders as an indented list, each with its files and lines, the biggest kept when it would
// run too long.
export function treeOf(files) {
  const folders = new Map();
  for (const file of files) {
    const parts = file.path.split("/").slice(0, -1);
    for (let depth = 0; depth <= Math.min(parts.length, 5); depth += 1) {
      const key = parts.slice(0, depth).join("/");
      const one = folders.get(key) ?? { files: 0, loc: 0 };
      one.files += 1;
      one.loc += file.loc;
      folders.set(key, one);
    }
  }
  const total = folders.get("")?.files ?? 0;
  const kept = [...folders].filter(([key, one]) => key && (key.split("/").length <= 2 || one.files >= Math.max(3, total / 200)));
  kept.sort((a, b) => b[1].files - a[1].files);
  const shown = new Set(kept.slice(0, MAX_TREE_LINES).map(([key]) => key));
  return [...shown].sort().map((key) => `${"  ".repeat(key.split("/").length - 1)}${key.split("/").pop()}/  ${folders.get(key).files} files, ${folders.get(key).loc} lines`);
}

// The id kept for the files no part claims (build.js): Claude's own part by that name is renamed.
export const OTHER_ID = "other";
const ownId = (id) => (id === OTHER_ID ? `${OTHER_ID}-part` : id);

// Claude's answer made whole: ids unique and none of them the one kept for unclaimed files, every
// parent there, and no part its own parent or ancestor (the part that closes a loop goes to the
// top), so every part sits somewhere on the chart.
export function checkParts(answer) {
  const ids = new Set();
  const parts = [];
  for (const part of answer.parts) {
    const id = ownId(part.id.trim());
    if (!id || ids.has(id)) continue;
    ids.add(id);
    parts.push({ ...part, id, parent: part.parent === null ? null : ownId(part.parent.trim()) });
  }
  for (const part of parts) if (part.parent !== null && !ids.has(part.parent)) part.parent = null;
  breakLoops(parts);
  const outside = [];
  for (const one of answer.outside) {
    const id = ownId(one.id?.trim() ?? "");
    if (!id || ids.has(id)) continue;
    ids.add(id);
    outside.push({ ...one, id });
  }
  const links = answer.links.map((link) => ({ ...link, from: ownId(link.from), to: ownId(link.to) })).filter((link) => ids.has(link.from) && ids.has(link.to) && link.from !== link.to);
  return { project: answer.project, parts, outside, links };
}

function breakLoops(parts) {
  const byId = new Map(parts.map((part) => [part.id, part]));
  for (const part of parts) {
    const seen = new Set([part.id]);
    for (let at = byId.get(part.parent); at; at = byId.get(at.parent)) {
      if (seen.has(at.id)) {
        part.parent = null;
        break;
      }
      seen.add(at.id);
    }
  }
}

// A glob as a pattern: ** any folders, * any name, ? one character, {a,b} either. A path with none
// of these stands for itself and, when it is a folder, everything in it. A leading ./ or / means
// the project's folder, as the paths are relative to it anyway.
export function globToRegExp(written) {
  const glob = written.trim().replace(/^(\.\/|\/)+/, "");
  const escape = (value) => value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  if (!/[*?{]/.test(glob)) return new RegExp(`^${escape(glob.replace(/\/+$/, ""))}(?:/.*)?$`);
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "{" && glob.indexOf("}", i) > i) {
      const end = glob.indexOf("}", i);
      out += `(?:${glob.slice(i + 1, end).split(",").map(escape).join("|")})`;
      i = end;
      continue;
    }
    if (char === "*" && glob[i + 1] === "*") {
      const isFolders = glob[i + 2] === "/";
      out += isFolders ? "(?:.*/)?" : ".*";
      i += isFolders ? 2 : 1;
    } else if (char === "*") out += "[^/]*";
    else if (char === "?") out += "[^/]";
    else out += escape(char);
  }
  return new RegExp(`^${out.replace(/\/$/, "/.*")}$`);
}

// Which part each file belongs to: the deepest part with a pattern that matches it, the first
// one of those when two are as deep. A file no pattern matches belongs to none (null).
export function assign(files, parts) {
  const depthOf = new Map();
  const byId = new Map(parts.map((part) => [part.id, part]));
  const depth = (id, seen = 0) => {
    if (depthOf.has(id)) return depthOf.get(id);
    const parent = byId.get(id)?.parent;
    const value = parent && seen < 10 ? depth(parent, seen + 1) + 1 : 0;
    depthOf.set(id, value);
    return value;
  };
  const matchers = parts.map((part) => ({ id: part.id, depth: depth(part.id), patterns: part.paths.map(globToRegExp) }));
  matchers.sort((a, b) => b.depth - a.depth);
  const owner = new Map();
  for (const file of files) owner.set(file.path, matchers.find((one) => one.patterns.some((pattern) => pattern.test(file.path)))?.id ?? null);
  return owner;
}
