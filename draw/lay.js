// Lays chart levels out with ELK, the Eclipse layout engine: the panel calls
//
//   bun draw/lay.js '<levels as JSON>'
//
// with {levels: [{key, direction, cards: [{id, band, w, h}], lines: [{key, from, to}]}]} and reads
// {layouts: {<key>: {width, height, cards: {<id>: [x, y]}, lines: {<key>: [[x, y], ...]}}}} back.
// A level is three bands in the direction asked ("RIGHT" or "DOWN"): what uses the part (band 0),
// what is inside it (1), what it uses (2). Every line leaves its card through a port of its own
// on the side facing the way the chart reads and comes in on the opposite side, and runs at right
// angles around the cards. A level ELK could not lay out comes back as {error}.
import ELK from "elkjs/lib/elk-api.js";

const SIDES = { RIGHT: ["EAST", "WEST"], DOWN: ["SOUTH", "NORTH"] };

function graphOf(level) {
  const [outSide, inSide] = SIDES[level.direction] ?? SIDES.RIGHT;
  const isRight = level.direction !== "DOWN";
  const ports = new Map(level.cards.map((card) => [card.id, []]));
  const edges = [];
  for (const line of level.lines) {
    if (!ports.has(line.from) || !ports.has(line.to)) continue;
    ports.get(line.from).push({ id: `${line.key}>`, width: 1, height: 1, layoutOptions: { "elk.port.side": outSide } });
    ports.get(line.to).push({ id: `>${line.key}`, width: 1, height: 1, layoutOptions: { "elk.port.side": inSide } });
    edges.push({ id: line.key, sources: [`${line.key}>`], targets: [`>${line.key}`] });
  }
  return {
    id: "level",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": isRight ? "RIGHT" : "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.partitioning.activate": "true",
      "elk.padding": "[top=34,left=16,bottom=20,right=16]",
      "elk.spacing.nodeNode": isRight ? "20" : "14",
      "elk.layered.spacing.nodeNodeBetweenLayers": isRight ? "64" : "44",
      "elk.spacing.edgeEdge": "7",
      "elk.spacing.edgeNode": "12",
      "elk.layered.spacing.edgeNodeBetweenLayers": "14",
      "elk.spacing.portPort": "9",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children: level.cards.map((card) => ({
      id: card.id,
      width: card.w,
      height: card.h,
      ports: ports.get(card.id),
      layoutOptions: { "elk.partitioning.partition": String(card.band), "elk.portConstraints": "FIXED_SIDE", "elk.portAlignment.default": "DISTRIBUTED" },
    })),
    edges,
  };
}

function placesOf(laid) {
  const cards = {};
  for (const child of laid.children ?? []) cards[child.id] = [child.x, child.y];
  const lines = {};
  for (const edge of laid.edges ?? []) {
    const section = edge.sections?.[0];
    if (section) lines[edge.id] = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((point) => [point.x, point.y]);
  }
  return { width: laid.width, height: laid.height, cards, lines };
}

export async function layOutLevels(levels) {
  const elk = new ELK({ workerUrl: Bun.resolveSync("elkjs/lib/elk-worker.min.js", import.meta.dir) });
  const layouts = {};
  try {
    for (const level of levels) {
      try {
        layouts[level.key] = placesOf(await elk.layout(graphOf(level)));
      } catch (error) {
        layouts[level.key] = { error: `ELK could not lay this level out: ${error.message ?? error}` };
      }
    }
  } finally {
    elk.terminateWorker();
  }
  return layouts;
}

if (import.meta.main) {
  try {
    const { levels } = JSON.parse(process.argv[2] ?? "");
    console.log(JSON.stringify({ layouts: await layOutLevels(levels) }));
  } catch (error) {
    console.error(`chartroom: the levels could not be laid out: ${error.message ?? error}`);
    process.exit(1);
  }
}
