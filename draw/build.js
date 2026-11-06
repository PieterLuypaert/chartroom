// The chart the panel reads (.chartroom/chart.json): the parts and outside services as nodes, the
// files and endpoints with their names, and every link, by file and by part.
import { routeKey } from "./describe.js";
import { OTHER_ID } from "./parts.js";

export const CHART_SCHEMA = "chartroom/chart@1";
// The part for files no part's patterns match.
const OTHER = { id: OTHER_ID, parent: null, label: "Other files", kind: "misc", summary: "Files no part claims yet.", paths: [] };

const baseName = (path) => path.slice(path.lastIndexOf("/") + 1);
const nameFromPath = (path) => baseName(path).replace(/\.[^.]+$/, "").replace(/[-_.]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());

export function buildChart({ scan, parts, owner, described, generatedAt = new Date().toISOString() }) {
  const unassigned = scan.files.filter((file) => !owner.get(file.path));
  const allParts = unassigned.length ? [...parts.parts, OTHER] : parts.parts;
  const ownerOf = (path) => owner.get(path) ?? OTHER.id;
  const stats = statsOf(scan.files, allParts, ownerOf);
  return {
    schema: CHART_SCHEMA,
    meta: { generatedAt, root: scan.root, rootName: scan.name, repos: scan.repos, isCut: scan.isCut, drawnBy: "claude", counts: { files: scan.files.length, loc: scan.files.reduce((sum, file) => sum + file.loc, 0), unassigned: unassigned.length } },
    project: parts.project,
    nodes: [
      ...allParts.map((part) => ({ id: part.id, parent: part.parent, label: part.label, kind: part.kind, summary: part.summary, paths: part.paths, stats: stats.get(part.id) })),
      ...parts.outside.map((one) => ({ id: one.id, parent: null, label: one.label, kind: "external", summary: one.summary, packages: one.packages, hosts: one.hosts, stats: { files: 0, loc: 0 } })),
    ],
    files: scan.files.map((file) => {
      const about = described.files[file.path];
      return { p: file.path, n: ownerOf(file.path), r: file.repo, l: file.lang, loc: file.loc, name: about?.name || nameFromPath(file.path), d: about?.d || file.doc || "" };
    }),
    routes: scan.routes.map((route) => {
      const about = described.endpoints[routeKey(route)];
      return { f: route.file, m: route.m, p: route.p, l: route.line, name: about?.name || `${route.m} ${route.p}`, d: about?.d || "" };
    }),
    links: linksOf(scan, parts),
  };
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

// The scan's links between files, a link from each file to the outside services its packages and
// addresses are theirs, and the links Claude named between parts.
function linksOf(scan, parts) {
  const links = scan.links.map((link) => ({ a: `f:${link.a}`, b: `f:${link.b}`, k: link.k, w: link.w, labels: link.labels }));
  for (const file of scan.files) {
    for (const one of parts.outside) {
      const packages = file.packages.filter((pkg) => one.packages.some((name) => sameOrUnder(pkg, name)));
      const hosts = file.hosts.filter((host) => one.hosts.some((name) => host === name.toLowerCase() || host.endsWith(`.${name.toLowerCase()}`)));
      if (packages.length) links.push({ a: `f:${file.path}`, b: `n:${one.id}`, k: "import", w: packages.length, labels: packages });
      if (hosts.length) links.push({ a: `f:${file.path}`, b: `n:${one.id}`, k: "http", w: hosts.length, labels: hosts });
    }
  }
  for (const link of parts.links) links.push({ a: `n:${link.from}`, b: `n:${link.to}`, k: "link", w: 1, labels: [link.label] });
  return links;
}

const sameOrUnder = (pkg, name) => pkg.toLowerCase() === name.toLowerCase() || pkg.toLowerCase().startsWith(`${name.toLowerCase().replace(/\/?\*?$/, "")}/`);
