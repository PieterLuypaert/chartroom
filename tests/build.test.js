import { describe, expect, test } from "bun:test";
import { buildChart } from "../draw/build.js";

// A shop: a website, a server with an orders part inside it, and a mail service. The website's
// page asks the orders part for its list.
const PARTS = {
  project: { name: "Shop", summary: "Sells things." },
  parts: [
    { id: "web", parent: null, label: "Website", kind: "ui", summary: "The shop's pages.", paths: ["web/**"] },
    { id: "api", parent: null, label: "Server", kind: "service", summary: "Answers the website.", paths: ["api/**"] },
    { id: "api.orders", parent: "api", label: "Orders", kind: "feature", summary: "Lists and refunds orders.", paths: ["api/orders/**"] },
    { id: "mail", parent: null, label: "Mail", kind: "service", summary: "Sends the shop's mail.", paths: ["mail/**"] },
  ],
  outside: [],
  links: [],
};
const OWNER = new Map([["web/page.ts", "web"], ["api/index.ts", "api"], ["api/orders/list.ts", "api.orders"], ["api/orders/refund.ts", "api.orders"], ["mail/send.ts", "mail"]]);
const HASHES = { "web/page.ts": "a1", "api/index.ts": "b1", "api/orders/list.ts": "c1", "api/orders/refund.ts": "d1", "mail/send.ts": "e1" };
const PAGE_TO_LIST = { a: "web/page.ts", b: "api/orders/list.ts", k: "http", w: 1, labels: ["GET /orders"] };

function drawn({ hashes = HASHES, links = [PAGE_TO_LIST], generatedAt = "2026-11-07T10:00:00.000Z" } = {}) {
  const files = Object.entries(hashes).map(([path, hash]) => ({ path, repo: "", lang: "js", loc: 10, hash, doc: "", packages: [], hosts: [] }));
  const scan = { root: "/code/shop", name: "shop", repos: [], isCut: false, files, routes: [], links };
  const chart = buildChart({ scan, parts: PARTS, owner: OWNER, described: { files: {}, endpoints: {} }, generatedAt });
  return Object.fromEntries([...chart.nodes.map((node) => [`n:${node.id}`, node.rev]), ...chart.files.map((file) => [`f:${file.p}`, file.rev])]);
}

// The cards whose rev differs between two drawings.
const changed = (before, after) => Object.keys(before).filter((ref) => before[ref] !== after[ref]).sort();

describe("buildChart's rev", () => {
  test("gives every part and file one", () => {
    const revs = drawn();
    expect(Object.keys(revs).length).toBe(9);
    for (const rev of Object.values(revs)) expect(rev).toMatch(/^[0-9a-f]+$/);
  });

  test("is the same for the same code, whenever it is drawn", () => {
    expect(changed(drawn(), drawn({ generatedAt: "2026-11-08T09:00:00.000Z" }))).toEqual([]);
  });

  test("changes for a changed file, its part and the parts around it, and nothing else", () => {
    expect(changed(drawn(), drawn({ hashes: { ...HASHES, "api/orders/refund.ts": "d2" } }))).toEqual(["f:api/orders/refund.ts", "n:api", "n:api.orders"]);
  });

  test("changes for both ends of a new link, and the parts it crosses into and out of", () => {
    const mailToServer = { a: "mail/send.ts", b: "api/index.ts", k: "import", w: 1, labels: ["config"] };
    expect(changed(drawn(), drawn({ links: [PAGE_TO_LIST, mailToServer] }))).toEqual(["f:api/index.ts", "f:mail/send.ts", "n:api", "n:mail"]);
  });
});
