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

// Work on a big chart is cut into slices. A step function is a generator that yields once it has
// run SLICE_MS since it last went on: the panel gives Herdr the turn between slices, as Herdr stops
// a script that runs on too long (about 50 ms in a render), while bun and the tests run the steps
// straight through.
const SLICE_MS = 20;
export function sliceClock(sliceMs = SLICE_MS) {
  let start = Date.now();
  return { isDue: () => Date.now() - start >= sliceMs, restart: () => (start = Date.now()) };
}

export function straight(steps) {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

// Runs steps, waiting for `pause` (which gives Herdr the turn) between slices.
export async function inSlices(steps, pause) {
  let step = steps.next();
  while (!step.done) {
    await pause();
    step = steps.next();
  }
  return step.value;
}

// The map, checked and indexed. Throws an Error that says what is wrong in words a person reads.
export const readChart = (text) => straight(chartSteps(text));
export const readChartInSlices = (text, pause, sliceMs) => inSlices(chartSteps(text, sliceMs), pause);

function* chartSteps(text, sliceMs) {
  const clock = sliceClock(sliceMs);
  const graph = yield* graphSteps(text, clock);
  if (!SCHEMAS.includes(graph?.schema)) throw new Error(`the chart is ${graph?.schema ?? "in an unknown format"}, and the Chartroom reads ${SCHEMAS.join(" and ")}`);
  return yield* indexSteps(graph, clock);
}

// A chart written a line per part, file, endpoint and link (draw/build.js's chartText: a first line
// that ends in a comma, then "nodes":[ on its own) is parsed a line at a time, so no slice parses
// tens of megabytes; any other JSON, such as a chart written before on a single line, in one go.
function* graphSteps(text, clock) {
  try {
    const first = text.indexOf("\n");
    const second = text.indexOf("\n", first + 1);
    if (first < 1 || text[first - 1] !== "," || !/^"\w+":\[$/.test(text.slice(first + 1, second))) return JSON.parse(text);
    const graph = JSON.parse(`${text.slice(0, first - 1)}}`);
    let list = null;
    for (let at = first + 1; at < text.length; ) {
      const next = text.indexOf("\n", at);
      const end = next === -1 ? text.length : next;
      const line = text.slice(at, end);
      at = end + 1;
      const opened = /^"(\w+)":\[$/.exec(line);
      if (opened) list = graph[opened[1]] = [];
      else if (line === "]," || line === "]}") list = null;
      else list.push(JSON.parse(line.endsWith(",") ? line.slice(0, -1) : line));
      if (clock.isDue()) {
        yield;
        clock.restart();
      }
    }
    return graph;
  } catch (error) {
    throw new Error(`the chart is not valid JSON (${error.message})`);
  }
}

function* indexSteps(graph, clock) {
  const nodeList = graph.nodes ?? [];
  const nodes = new Map(nodeList.map((node) => [node.id, node]));
  const children = new Map();
  for (const node of nodeList) push(children, node.parent ?? null, node.id);
  const files = new Map();
  const filesOf = new Map();
  for (const file of graph.files ?? []) {
    files.set(file.p, file);
    push(filesOf, file.n, file.p);
    if (clock.isDue()) {
      yield;
      clock.restart();
    }
  }
  const routes = graph.routes ?? [];
  const routesOf = new Map();
  routes.forEach((route, index) => push(routesOf, route.f, index));
  const name = graph.project?.name || graph.meta?.rootName || "This app";
  const chart = { name, summary: graph.project?.summary ?? "", meta: graph.meta ?? {}, nodes, children, files, filesOf, routes, routesOf, links: graph.links ?? [] };
  chart.linksUnder = yield* linksUnderSteps(chart, clock);
  Object.assign(chart, yield* endsSteps(chart, clock));
  return chart;
}

// Which way each link goes, end by end: for every file or node, the links that end in it (`users`:
// who uses it) and those that start from it (`used`: what it uses), each other end with the link
// that joins them. The impact walk goes over these.
function* endsSteps(chart, clock) {
  const users = new Map();
  const used = new Map();
  for (const link of chart.links) {
    const a = endOf(chart, link.a);
    const b = endOf(chart, link.b);
    if (a && b && a !== b) {
      push(users, b, { ref: a, via: link });
      push(used, a, { ref: b, via: link });
    }
    if (clock.isDue()) {
      yield;
      clock.restart();
    }
  }
  return { users, used };
}

// A link's end as the impact walk knows it: a file ("f:<path>"), an endpoint taken to its file, or
// a node ("n:<id>", such as an outside service). Null for one the chart does not have.
function endOf(chart, ref) {
  const spot = spotOf(chart, ref);
  if (!spot) return null;
  return spot.file ? `f:${spot.file}` : `n:${spot.node}`;
}

// The links a part's level can show: those with an end in the part or in a part inside it, in the
// chart's order. A level goes through its own instead of every link: on a project of tens of
// thousands of files, every link takes a level longer than Herdr lets a render wait.
function* linksUnderSteps(chart, clock) {
  const chains = new Map();
  const chainOf = (ref) => {
    const node = spotOf(chart, ref)?.node;
    if (node == null) return [];
    if (!chains.has(node)) chains.set(node, lineage(chart, node));
    return chains.get(node);
  };
  const under = new Map();
  for (const link of chart.links) {
    const from = chainOf(link.a);
    for (const part of from) push(under, part, link);
    for (const part of chainOf(link.b)) if (!from.includes(part)) push(under, part, link);
    if (clock.isDue()) {
      yield;
      clock.restart();
    }
  }
  return under;
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
const levelsOf = (chart) => {
  if (!levelsByChart.has(chart)) levelsByChart.set(chart, new Map());
  return levelsByChart.get(chart);
};
const levelAt = (chart, focus) => (focus !== null && chart.nodes.has(focus) ? focus : null);

// Whether a level is worked out already, so showing it costs a render nothing.
export const isLevelReady = (chart, focus) => levelsOf(chart).has(levelAt(chart, focus));

export function levelOf(chart, focus = null) {
  const at = levelAt(chart, focus);
  const levels = levelsOf(chart);
  if (!levels.has(at)) levels.set(at, straight(levelSteps(chart, at)));
  return levels.get(at);
}

// The same level, worked out in slices with `pause` between them, for the panel to work out ahead
// of the render that shows it.
export async function levelInSlices(chart, focus, pause, sliceMs) {
  const at = levelAt(chart, focus);
  const levels = levelsOf(chart);
  if (!levels.has(at)) {
    const level = await inSlices(levelSteps(chart, at, sliceMs), pause);
    if (!levels.has(at)) levels.set(at, level);
  }
  return levels.get(at);
}

function* levelSteps(chart, at, sliceMs) {
  const clock = sliceClock(sliceMs);
  const inside = [
    ...(chart.children.get(at) ?? []).map((id) => partCard(chart, id, true)),
    ...(at === null ? [] : (chart.filesOf.get(at) ?? []).map((path) => fileCard(chart, path))),
  ];
  const cardOf = cardsOn(chart, at);
  const lines = new Map();
  const outside = new Map();
  for (const link of at === null ? chart.links : chart.linksUnder.get(at) ?? []) {
    if (clock.isDue()) {
      yield;
      clock.restart();
    }
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

// ---- Impact: what depends on a card, any number of steps away

// Everything that depends on `ref` (a file, a part or an outside service), or with `direction:
// "uses"` everything it relies on: each file or node reached, with its fewest steps away, the end it
// was reached from (one step nearer the source) and the link between them. The walk goes ring by
// ring, so each is reached by a shortest way, and once, so links in a circle end it. The source
// (for a part, its files and those of the parts inside it) is not among those reached.
//
// What is reached is also gathered by the part each file is in (a node by itself), as a file shows
// on any level as its part's card, except inside that part: placing an impact on a level then goes
// through the parts, not through every file reached.
export const impactOf = (chart, ref, options = {}) => straight(impactSteps(chart, ref, options));
export const impactInSlices = (chart, ref, options, pause, sliceMs) => inSlices(impactSteps(chart, ref, options, sliceMs), pause);

function* impactSteps(chart, ref, { direction = "usedBy" } = {}, sliceMs) {
  const clock = sliceClock(sliceMs);
  const next = direction === "uses" ? chart.used : chart.users;
  const sources = sourcesOf(chart, ref);
  const affected = new Map();
  const groups = new Map();
  let ring = [...sources];
  for (let steps = 1; ring.length; steps += 1) {
    const reached = [];
    for (const at of ring) {
      for (const one of next.get(at) ?? []) {
        if (sources.has(one.ref) || affected.has(one.ref)) continue;
        affected.set(one.ref, { steps, from: at, via: one.via });
        reached.push(one.ref);
        const part = partOfEnd(chart, one.ref);
        const group = groups.get(part) ?? { steps, files: 0, refs: [] };
        if (one.ref.startsWith("f:")) group.files += 1;
        group.refs.push([one.ref, steps]);
        groups.set(part, group);
      }
      if (clock.isDue()) {
        yield;
        clock.restart();
      }
    }
    ring = reached;
  }
  const sourceGroups = new Map();
  for (const end of sources) push(sourceGroups, partOfEnd(chart, end), end);
  // How many parts (each at the deepest, a node as itself) and files are affected in all.
  const counts = { parts: groups.size, files: [...groups.values()].reduce((sum, group) => sum + group.files, 0) };
  return { source: ref, direction, sources, affected, groups, sourceGroups, counts };
}

// The part a file is in, or a node's own id.
const partOfEnd = (chart, end) => (end.startsWith("f:") ? chart.files.get(end.slice(2)).n : end.slice(2));

// What the walk starts from: a file; a node, and when it is a part, its files and those of every
// part inside it.
function sourcesOf(chart, ref) {
  const sources = new Set();
  const end = endOf(chart, ref);
  if (!end) return sources;
  sources.add(end);
  if (end.startsWith("n:")) {
    const parts = new Set([end.slice(2)]);
    for (const part of parts) {
      for (const path of chart.filesOf.get(part) ?? []) sources.add(`f:${path}`);
      for (const child of chart.children.get(part) ?? []) parts.add(child);
    }
  }
  return sources;
}

// An impact on a level: each card on it with something affected, at the fewest steps of what in it
// is affected and with how many of its files are; the cards that hold the source; the lines from an
// affected card towards the source (or, for "uses", away from it), by their keys; what is affected
// with no card on the level, by the part it is in; and how many parts (each at the deepest) and
// files are affected in all.
export function impactOn(chart, level, impact) {
  const cardOf = cardsOn(chart, level.focus);
  const shown = new Set([...level.inside, ...level.outside].map((card) => card.id));
  const onLevel = (ref) => {
    const card = cardOf(ref);
    return card && shown.has(card.id) ? card.id : null;
  };
  // A part shows as its card; inside the part itself, its files show one by one.
  const ends = (part, refs) => (part === level.focus ? refs : [`n:${part}`]);
  const sources = new Set();
  for (const [part, refs] of impact.sourceGroups) for (const ref of ends(part, refs)) if (onLevel(ref)) sources.add(onLevel(ref));
  const cards = new Map();
  const elsewhere = new Map();
  const place = (id, key, steps, count) => {
    if (id && sources.has(id)) return;
    const [into, at] = id ? [cards, id] : [elsewhere, key];
    const one = into.get(at) ?? (id ? { steps, files: 0 } : { part: key, steps, files: 0 });
    one.steps = Math.min(one.steps, steps);
    one.files += count;
    into.set(at, one);
  };
  for (const [part, group] of impact.groups) {
    if (part === level.focus) for (const [ref, steps] of group.refs) place(onLevel(ref), part, steps, ref.startsWith("f:") ? 1 : 0);
    else place(onLevel(`n:${part}`), part, group.steps, group.files);
  }
  const stepsOf = (id) => (sources.has(id) ? 0 : cards.get(id)?.steps ?? null);
  const isUsedBy = impact.direction !== "uses";
  const lines = new Set(level.lines.filter((line) => {
    const [from, to] = [stepsOf(line.from), stepsOf(line.to)];
    return from !== null && to !== null && (isUsedBy ? from > to : to > from);
  }).map((line) => line.key));
  const away = [...elsewhere.values()].sort((a, b) => a.steps - b.steps || a.part.localeCompare(b.part));
  return { cards, sources, lines, elsewhere: away, counts: impact.counts };
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
