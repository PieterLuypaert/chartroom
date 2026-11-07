// What the Chartroom shows, read from a project's chart (.chartroom/chart.json, which draw/ makes
// with the person's own Claude): an app's parts one level at a time, each part, file or outside service a card,
// and the links between them. Plain functions over plain data, so bun tests them without the app.

export const SCHEMAS = ["chartroom/chart@1"];

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
    throw new Error(`the chart is not valid JSON (${error.message})`);
  }
  if (!SCHEMAS.includes(graph?.schema)) throw new Error(`the chart is ${graph?.schema ?? "in an unknown format"}, and the Chartroom reads ${SCHEMAS.join(" and ")}`);
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

// The projects to pick a chart from: every space's folder, then the folders picked by hand, each
// once. `key` tells them apart across machines.
export function projectsOf(spaceList, pickedFolders) {
  const out = [];
  const keys = new Set();
  const add = (project) => {
    const key = `${project.on ?? ""}:${project.folder}`;
    if (!project.folder || keys.has(key)) return;
    keys.add(key);
    out.push({ ...project, key });
  };
  for (const space of spaceList) add({ label: space.name, folder: space.folder, on: space.machine ?? null, space: space.id });
  for (const folder of pickedFolders) add({ label: baseName(folder), folder, on: null, space: null });
  return out;
}

// The project picker's scrolling list, in the order it shows them: "Spaces" over the spaces'
// projects, then "Folders" over the folders picked by hand, each project with its row among the
// picker's rows (row 0 follows the focus) so the keys and the list agree.
export function pickerItems(projects) {
  const items = [];
  let heading = null;
  projects.forEach((project, index) => {
    const label = project.space === null ? "Folders" : "Spaces";
    if (label !== heading) items.push({ kind: "heading", label });
    heading = label;
    items.push({ kind: "project", project, row: index + 1 });
  });
  return items;
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

// The card a link's end ("n:<id>", "f:<path>" or "r:<index>") shows as on the level of `focus`
// (null: the whole app). Inside the focus it is the child part it is in, or its own file when the
// focus holds it directly. Outside, it is the part beside the focus or beside one of the parts the
// focus sits in. The focus itself has none. A big chart has tens of thousands of links between a
// few thousand files in a few dozen parts, so each end's card and each part's are worked out once
// per level: Herdr interrupts a render that takes longer than about 50 ms.
function cardsOn(chart, focus) {
  const around = new Set(focus === null ? [] : lineage(chart, focus));
  const byPart = new Map();
  const byRef = new Map();
  const cardOf = (spot) => {
    if (!spot) return null;
    if (focus !== null && spot.node === focus) return spot.file ? { id: `f:${spot.file}`, isInside: true } : null;
    if (!byPart.has(spot.node)) byPart.set(spot.node, partCardOn(chart, focus, around, spot.node));
    return byPart.get(spot.node);
  };
  return (ref) => {
    let card = byRef.get(ref);
    if (card === undefined) {
      card = cardOf(spotOf(chart, ref));
      byRef.set(ref, card);
    }
    return card;
  };
}

// The card a part other than the focus shows as, `around` being the focus and the parts it sits in.
function partCardOn(chart, focus, around, part) {
  const chain = lineage(chart, part);
  if (focus === null) return chain.length ? { id: `n:${chain.at(-1)}`, isInside: true } : null;
  const at = chain.indexOf(focus);
  if (at > 0) return { id: `n:${chain[at - 1]}`, isInside: true };
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
// one line per pair and direction, with how many links it stands for and what they carry. Each is
// worked out once per chart and kept, as a big chart's level takes tens of milliseconds and the
// panel asks for the same ones again (the level shown, those laid out ahead, the one gone back to).
// A level is never changed by those who ask for it.
const levelsByChart = new WeakMap();
export function levelOf(chart, focus = null) {
  const at = focus !== null && chart.nodes.has(focus) ? focus : null;
  if (!levelsByChart.has(chart)) levelsByChart.set(chart, new Map());
  const levels = levelsByChart.get(chart);
  if (!levels.has(at)) levels.set(at, workOutLevel(chart, at));
  return levels.get(at);
}

function workOutLevel(chart, at) {
  const inside = [
    ...(chart.children.get(at) ?? []).map((id) => partCard(chart, id, true)),
    ...(at === null ? [] : (chart.filesOf.get(at) ?? []).map((path) => fileCard(chart, path))),
  ];
  const cardOf = cardsOn(chart, at);
  const lines = new Map();
  const outside = new Map();
  for (const link of chart.links) {
    const from = cardOf(link.a);
    const to = cardOf(link.b);
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

// The card on the level of `focus` that a part or file anywhere in the chart shows as ("n:<id>" or
// "f:<path>"): itself, the part on this level it is inside, or the part beside this level it is in.
// Null for one the chart does not have, and for the focus itself.
export function cardIdOn(chart, focus, ref) {
  const at = focus !== null && chart.nodes.has(focus) ? focus : null;
  return cardsOn(chart, at)(ref)?.id ?? null;
}

// The fingerprint of what a part's or file's explanation is written from (draw/build.js), or null
// for a card the chart does not have, or a chart drawn before cards had one.
export function revOf(chart, ref) {
  if (typeof ref !== "string") return null;
  const card = ref.startsWith("n:") ? chart.nodes.get(ref.slice(2)) : ref.startsWith("f:") ? chart.files.get(ref.slice(2)) : null;
  return card?.rev ?? null;
}

// Whether a kept explanation still holds on this chart: while its card's code and links are as they
// were (the same rev). One written before cards had a rev, or on a chart without them, holds only
// on the chart it was written for.
export function isExplanationCurrent(chart, record) {
  const rev = revOf(chart, record.card);
  if (rev && record.rev) return record.rev === rev;
  return record.chart === (chart.meta?.generatedAt ?? null);
}
