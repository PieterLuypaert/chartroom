// The chart the panel reads (.chartroom/chart.json): the parts and outside services as nodes, the
// files and endpoints with their names, and every link, by file and by part.
import { routeKey } from "./describe.js";
import { OTHER_ID } from "./parts.js";

export const CHART_SCHEMA = "chartroom/chart@1";
// The part for files no part's patterns match.
const OTHER = { id: OTHER_ID, parent: null, label: "Other files", kind: "misc", summary: "Files no part claims yet.", paths: [] };

const baseName = (path) => path.slice(path.lastIndexOf("/") + 1);
const nameFromPath = (path) => baseName(path).replace(/\.[^.]+$/, "").replace(/[-_.]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());

// The chart as .chartroom/chart.json holds it: JSON in ASCII alone, every other character written
// as \uXXXX, and each part, file, endpoint and link on a line of its own after the rest. The panel
// reads a big chart in parts by the byte, which must not end inside a character, and parses it a
// line at a time (mods/chartroom/model.js), so no one slice of its work parses all of it.
const ascii = (text) => text.replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

export function chartText(chart) {
  const lists = Object.entries(chart).filter(([, value]) => Array.isArray(value));
  if (!lists.length) return ascii(JSON.stringify(chart));
  const head = JSON.stringify(Object.fromEntries(Object.entries(chart).filter(([, value]) => !Array.isArray(value))));
  const lines = [`${head.slice(0, -1)},`];
  lists.forEach(([key, list], index) => {
    lines.push(`${JSON.stringify(key)}:[`);
    list.forEach((item, at) => lines.push(`${JSON.stringify(item)}${at < list.length - 1 ? "," : ""}`));
    lines.push(index < lists.length - 1 ? "]," : "]}");
  });
  return ascii(lines.join("\n"));
}

export function buildChart({ scan, parts, owner, described, generatedAt = new Date().toISOString() }) {
  const unassigned = scan.files.filter((file) => !owner.get(file.path));
  const allParts = unassigned.length ? [...parts.parts, OTHER] : parts.parts;
  const ownerOf = (path) => owner.get(path) ?? OTHER.id;
  const stats = statsOf(scan.files, allParts, ownerOf);
  const nodes = [
    ...allParts.map((part) => ({ id: part.id, parent: part.parent, label: part.label, kind: part.kind, summary: part.summary, paths: part.paths, stats: stats.get(part.id) })),
    ...parts.outside.map((one) => ({ id: one.id, parent: null, label: one.label, kind: "external", summary: one.summary, packages: one.packages, hosts: one.hosts, programs: one.programs ?? [], stats: { files: 0, loc: 0 } })),
  ];
  const files = scan.files.map((file) => {
    const about = described.files[file.path];
    return { p: file.path, n: ownerOf(file.path), r: file.repo, l: file.lang, loc: file.loc, name: about?.name || nameFromPath(file.path), d: about?.d || file.doc || "" };
  });
  const links = linksOf(scan, parts);
  const revs = revsOf({ nodes, files, links, hashOf: new Map(scan.files.map((file) => [file.path, file.hash])) });
  return {
    schema: CHART_SCHEMA,
    meta: { generatedAt, root: scan.root, rootName: scan.name, repos: scan.repos, drawnBy: "claude", counts: { files: scan.files.length, loc: scan.files.reduce((sum, file) => sum + file.loc, 0), unassigned: unassigned.length } },
    project: parts.project,
    nodes: nodes.map((node) => ({ ...node, rev: revs.get(`n:${node.id}`) })),
    files: files.map((file) => ({ ...file, rev: revs.get(`f:${file.p}`) })),
    routes: scan.routes.map((route) => {
      const about = described.endpoints[routeKey(route)];
      return { f: route.file, m: route.m, p: route.p, l: route.line, name: about?.name || `${route.m} ${route.p}`, d: about?.d || "" };
    }),
    links,
  };
}

// What a card's explanation is written from, as a fingerprint (`rev`), so the explanation is kept
// until that changes: a part's name and summary, the path and hash of every file in it or its
// parts, and the other end of every link across its edge; a file's name, description and hash, and
// the other end of each of its links; an outside service's name, summary and links.
function revsOf({ nodes, files, links, hashOf }) {
  const parentOf = new Map(nodes.map((node) => [node.id, node.parent ?? null]));
  const ownerOf = new Map(files.map((file) => [file.p, file.n]));
  // The cards a link's end is on: its file, if it is one, then each part it sits in.
  const cardsOf = (ref) => {
    const cards = ref.startsWith("f:") ? [ref] : [];
    let id = ref.startsWith("f:") ? ownerOf.get(ref.slice(2)) : ref.slice(2);
    for (let depth = 0; parentOf.has(id) && depth < 10; depth += 1, id = parentOf.get(id)) cards.push(`n:${id}`);
    return cards;
  };
  const about = new Map([...nodes.map((node) => [`n:${node.id}`, [node.label, node.summary]]), ...files.map((file) => [`f:${file.p}`, [file.name, file.d]])]);
  const seen = new Map([...about.keys()].map((ref) => [ref, []]));
  for (const file of files) for (const card of cardsOf(`f:${file.p}`)) seen.get(card).push(`${file.p}:${hashOf.get(file.p)}`);
  for (const link of links) {
    const from = cardsOf(link.a);
    const to = cardsOf(link.b);
    for (const card of from) if (!to.includes(card)) seen.get(card)?.push(`${link.k}>${link.b}`);
    for (const card of to) if (!from.includes(card)) seen.get(card)?.push(`${link.k}<${link.a}`);
  }
  return new Map([...seen].map(([ref, entries]) => [ref, Bun.hash(JSON.stringify([...about.get(ref), ...entries.sort()])).toString(16)]));
}

// Each part's files and lines, its parts' included.
function statsOf(files, parts, ownerOf) {
  const parentOf = new Map(parts.map((part) => [part.id, part.parent]));
  const stats = new Map(parts.map((part) => [part.id, { files: 0, loc: 0 }]));
  for (const file of files) {
    for (let id = ownerOf(file.path), depth = 0; id && stats.has(id) && depth < 10; id = parentOf.get(id), depth += 1) {
      stats.get(id).files += 1;
      stats.get(id).loc += file.loc;
    }
  }
  return stats;
}

// The scan's links between files, a link from each file to the outside services its packages,
// addresses and programs are theirs, and the links Claude named between parts. A service named
// before programs were read has none.
function linksOf(scan, parts) {
  const links = scan.links.map((link) => ({ a: `f:${link.a}`, b: `f:${link.b}`, k: link.k, w: link.w, labels: link.labels }));
  for (const file of scan.files) {
    for (const one of parts.outside) {
      const packages = file.packages.filter((pkg) => one.packages.some((name) => sameOrUnder(pkg, name)));
      const hosts = file.hosts.filter((host) => one.hosts.some((name) => host === name.toLowerCase() || host.endsWith(`.${name.toLowerCase()}`)));
      if (packages.length) links.push({ a: `f:${file.path}`, b: `n:${one.id}`, k: "import", w: packages.length, labels: packages });
      const programs = (file.programs ?? []).filter((name) => (one.programs ?? []).some((program) => program.toLowerCase() === name));
      if (hosts.length) links.push({ a: `f:${file.path}`, b: `n:${one.id}`, k: "http", w: hosts.length, labels: hosts });
      if (programs.length) links.push({ a: `f:${file.path}`, b: `n:${one.id}`, k: "run", w: programs.length, labels: programs });
    }
  }
  for (const link of parts.links) links.push({ a: `n:${link.from}`, b: `n:${link.to}`, k: "link", w: 1, labels: [link.label] });
  return links;
}

const sameOrUnder = (pkg, name) => pkg.toLowerCase() === name.toLowerCase() || pkg.toLowerCase().startsWith(`${name.toLowerCase().replace(/\/?\*?$/, "")}/`);
