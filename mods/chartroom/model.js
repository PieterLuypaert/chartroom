// What the Chartroom shows, read from the map floorplan writes (floorplan/graph.json): an app's
// parts one level at a time, each part, file or outside service a card, and the links between
// them. Plain functions over plain data, so bun tests them without the app.

export const SCHEMA = "floorplan/graph@1";

// Folders above this many levels up are not searched for a map.
const MAX_FOLDERS = 12;
// Guards the walk up a part's parents against a map whose parents loop.
const MAX_DEPTH = 64;

const push = (map, key, value) => {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
};
const baseName = (path) => path.slice(path.lastIndexOf("/") + 1);

// The map, checked and indexed. Throws an Error that says what is wrong in words a person reads.
export function readChart(text) {
  let graph;
  try {
    graph = JSON.parse(text);
  } catch (error) {
    throw new Error(`floorplan/graph.json is not valid JSON (${error.message})`);
  }
  if (graph?.schema !== SCHEMA) throw new Error(`floorplan/graph.json is ${graph?.schema ?? "in an unknown format"}, and the Chartroom reads ${SCHEMA}`);
  return indexChart(graph);
}

function indexChart(graph) {
  const nodeList = graph.nodes ?? [];
  const fileList = graph.files ?? [];
  const nodes = new Map(nodeList.map((node) => [node.id, node]));
  const children = new Map();
  for (const node of nodeList) push(children, node.parent ?? null, node.id);
  const files = new Map(fileList.map((file) => [file.p, file]));
  const filesOf = new Map();
  for (const file of fileList) push(filesOf, file.n, file.p);
  const routes = graph.routes ?? [];
  const routesOf = new Map();
  routes.forEach((route, index) => push(routesOf, route.f, index));
  const name = graph.project?.name || graph.meta?.rootName || "This app";
  return { name, summary: graph.project?.summary ?? "", meta: graph.meta ?? {}, nodes, children, files, filesOf, routes, routesOf, links: graph.links ?? [] };
}

// The folders a map of `cwd` may be in, nearest first: it and each folder above it, short of home.
export function mapFolders(cwd, home) {
  const out = [];
  let dir = cwd ? cwd.replace(/\/+$/, "") : "";
  while (dir && dir !== home && out.length < MAX_FOLDERS) {
    out.push(dir);
    dir = dir.slice(0, dir.lastIndexOf("/"));
  }
  return out;
}

// A part and the parts it sits in, innermost first.
function lineage(chart, id) {
  const out = [];
  for (let at = id; at != null && chart.nodes.has(at) && out.length < MAX_DEPTH; at = chart.nodes.get(at).parent ?? null) out.push(at);
  return out;
}

// Where a link's end is: the part it belongs to, and its file when it is one.
function spotOf(chart, ref) {
  if (typeof ref !== "string") return null;
  const [kind, rest] = [ref.slice(0, 2), ref.slice(2)];
  if (kind === "n:") return chart.nodes.has(rest) ? { node: rest, file: null } : null;
  const path = kind === "f:" ? rest : kind === "r:" ? chart.routes[Number(rest)]?.f : null;
  const file = path ? chart.files.get(path) : null;
  return file ? { node: file.n, file: file.p } : null;
}

// The card a spot shows as on the level of `focus` (null: the whole app). Inside the focus it is
// the child part it is in, or its own file when the focus holds it directly. Outside, it is the
// part beside the focus or beside one of the parts the focus sits in. The focus itself has none.
function cardOf(chart, focus, spot) {
  const chain = lineage(chart, spot.node);
  if (focus === null) return chain.length ? { id: `n:${chain.at(-1)}`, isInside: true } : null;
  const at = chain.indexOf(focus);
  if (at === 0) return spot.file ? { id: `f:${spot.file}`, isInside: true } : null;
  if (at > 0) return { id: `n:${chain[at - 1]}`, isInside: true };
  const around = new Set(lineage(chart, focus));
  const beside = chain.find((id) => {
    const parent = chart.nodes.get(id).parent ?? null;
    return parent === null || around.has(parent);
  });
  return beside ? { id: `n:${beside}`, isInside: false } : null;
}

function partCard(chart, id, isInside) {
  const node = chart.nodes.get(id);
  const isOpenable = (chart.children.get(id)?.length ?? 0) + (chart.filesOf.get(id)?.length ?? 0) > 0;
  return { id: `n:${id}`, part: id, kind: node.kind ?? "misc", label: node.label || id, summary: node.summary ?? "", stats: node.stats ?? {}, isOpenable, isInside };
}

function fileCard(chart, path) {
  const file = chart.files.get(path);
  const routes = (chart.routesOf.get(path) ?? []).map((index) => chart.routes[index]);
  return { id: `f:${path}`, kind: "file", label: file.name || baseName(path), summary: file.d ?? "", path, loc: file.loc ?? 0, routes, isOpenable: false, isInside: true };
}

// The parts that lead to `focus`, from the app down, each with its name.
export function trailOf(chart, focus) {
  const parts = lineage(chart, focus).reverse().map((id) => ({ part: id, label: chart.nodes.get(id).label || id }));
  return [{ part: null, label: chart.name }, ...parts];
}

// One level: the cards inside the focus, the cards outside it that link to them (`side`: "above"
// for those that only use what is inside, "below" for the rest), and the links between them,
// one line per pair and direction, with how many links it stands for and what they carry.
export function levelOf(chart, focus = null) {
  const at = focus !== null && chart.nodes.has(focus) ? focus : null;
  const inside = [
    ...(chart.children.get(at) ?? []).map((id) => partCard(chart, id, true)),
    ...(at === null ? [] : (chart.filesOf.get(at) ?? []).map((path) => fileCard(chart, path))),
  ];
  const lines = new Map();
  const outside = new Map();
  for (const link of chart.links) {
    const a = spotOf(chart, link.a);
    const b = spotOf(chart, link.b);
    const from = a && cardOf(chart, at, a);
    const to = b && cardOf(chart, at, b);
    if (!from || !to || from.id === to.id || (!from.isInside && !to.isInside)) continue;
    for (const end of [from, to]) if (!end.isInside) outside.set(end.id, outside.get(end.id) ?? { usesIn: false, isUsed: false });
    if (!from.isInside) outside.get(from.id).usesIn = true;
    if (!to.isInside) outside.get(to.id).isUsed = true;
    addLine(lines, from.id, to.id, link);
  }
  const outsideCards = [...outside].map(([id, ends]) => ({ ...partCard(chart, id.slice(2), false), side: ends.isUsed ? "below" : "above" }));
  return { focus: at, trail: trailOf(chart, at), inside, outside: outsideCards, lines: [...lines.values()] };
}

function addLine(lines, from, to, link) {
  const key = `${from}>${to}`;
  const line = lines.get(key) ?? { key, from, to, weight: 0, labels: [] };
  line.weight += link.w ?? 1;
  for (const label of link.labels ?? link.names ?? []) if (!line.labels.includes(label)) line.labels.push(label);
  lines.set(key, line);
}

// A card on a level with what it uses and what uses it, each through the line between them.
export function detailsOf(level, id) {
  const cards = new Map([...level.inside, ...level.outside].map((card) => [card.id, card]));
  const card = cards.get(id);
  if (!card) return null;
  const uses = level.lines.filter((line) => line.from === id).map((line) => ({ card: cards.get(line.to), line }));
  const usedBy = level.lines.filter((line) => line.to === id).map((line) => ({ card: cards.get(line.from), line }));
  return { card, uses, usedBy };
}
