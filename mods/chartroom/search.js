// Finding a card by name: every part, outside service, file and endpoint of a chart, and those a
// query matches, best first, each with the level it sits on. Plain functions over the chart
// (model.js), so bun tests them without the app. The index is made once per chart: a search runs
// on every key typed, and a 6000-file chart must stay quick to search.
import { inSlices, sliceClock, straight, trailOf } from "./model.js";

const MAX_FOUND = 20;
const baseName = (path) => path.slice(path.lastIndexOf("/") + 1);

// Every card to find: what it is (`ref`, `kind`, `label`), the level it sits on (`focus`) and
// where that is in words (`where`), an endpoint's method and path (`route`), and the words it is
// found by, lowercased once: its name, its path or route, and what it does. In slices, for the
// panel to make it ahead of the first key typed, as on a big chart it takes longer than Herdr lets
// a key wait.
export const searchIndexOf = (chart) => straight(indexSteps(chart));
export const searchIndexInSlices = (chart, pause) => inSlices(indexSteps(chart), pause);

function* indexSteps(chart) {
  const clock = sliceClock();
  const placeOf = placesOf(chart);
  const entry = ({ path = "", about = "", ...card }) => ({ ...card, name: card.label.toLowerCase(), path: path.toLowerCase(), about: about.toLowerCase() });
  const index = [];
  for (const node of chart.nodes.values()) {
    const focus = node.parent ?? null;
    const about = [node.summary, ...(node.packages ?? []), ...(node.hosts ?? [])].join(" ");
    index.push(entry({ ref: `n:${node.id}`, kind: node.kind ?? "misc", label: node.label || node.id, focus, where: placeOf(focus), about }));
  }
  for (const file of chart.files.values()) {
    index.push(entry({ ref: `f:${file.p}`, kind: "file", label: file.name || baseName(file.p), focus: file.n, where: placeOf(file.n), path: file.p, about: file.d ?? "" }));
    if (clock.isDue()) {
      yield;
      clock.restart();
    }
  }
  for (const route of chart.routes) {
    const file = chart.files.get(route.f);
    if (!file) continue;
    const label = route.name || `${route.m} ${route.p}`;
    index.push(entry({ ref: `f:${file.p}`, kind: "endpoint", label, focus: file.n, where: placeOf(file.n), route, path: `${route.m} ${route.p} ${file.p}`, about: route.d ?? "" }));
  }
  return index;
}

// The parts a level is inside, in words ("Server › Orders"), or the app's name for the top level.
function placesOf(chart) {
  const places = new Map();
  return (focus) => {
    if (!places.has(focus)) places.set(focus, trailOf(chart, focus).map((step) => step.label).slice(focus === null ? 0 : 1).join(" › "));
    return places.get(focus);
  };
}

// The cards a query matches, best first and at most MAX_FOUND: every word of it found in a card's
// name, path or route, or what it does. Those whose name starts with the query come first, then
// those whose name holds it, then path or route, then the rest; parts before files and endpoints,
// shorter names first. Only the best are kept while looking, as one letter can match thousands of
// cards and sorting them all takes longer than Herdr lets a view wait.
export function searchChart(index, query) {
  const asked = query.trim().toLowerCase();
  if (!asked) return [];
  const words = asked.split(/\s+/);
  const best = [];
  for (const one of index) {
    if (!words.every((word) => one.name.includes(word) || one.path.includes(word) || one.about.includes(word))) continue;
    const found = { one, order: orderOf(one, asked) };
    if (best.length === MAX_FOUND && !isBefore(found, best.at(-1))) continue;
    let at = best.length;
    while (at > 0 && isBefore(found, best[at - 1])) at -= 1;
    best.splice(at, 0, found);
    if (best.length > MAX_FOUND) best.pop();
  }
  return best.map(({ one }) => one);
}

// How good a match is, as one number: where the query is found, then parts before the rest, then
// shorter names. Names alike in all three go in the order of their letters.
const orderOf = (one, asked) => rankOf(one, asked) * 2048 + (one.ref.startsWith("n:") ? 0 : 1024) + Math.min(one.label.length, 1023);
const isBefore = (a, b) => a.order < b.order || (a.order === b.order && a.one.label < b.one.label);

function rankOf(one, asked) {
  if (one.name.startsWith(asked)) return 0;
  if (one.name.includes(asked)) return 1;
  return one.path.includes(asked) ? 2 : 3;
}
