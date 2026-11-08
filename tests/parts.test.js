import { describe, expect, test } from "bun:test";
import { assign, checkParts, globToRegExp, treeOf } from "../draw/parts.js";
import { describePrompt, digestOf, headOf } from "../draw/describe.js";

describe("parts", () => {
  test("puts each file in the deepest part that claims it", () => {
    const parts = [
      { id: "api", parent: null, paths: ["api/**"] },
      { id: "api.rules", parent: "api", paths: ["api/src/rules/**"] },
      { id: "web", parent: null, paths: ["web"] },
    ];
    const owner = assign([{ path: "api/src/rules/pay.ts" }, { path: "api/src/index.ts" }, { path: "web/a.ts" }, { path: "docs/x.ts" }], parts);
    expect([...owner]).toEqual([["api/src/rules/pay.ts", "api.rules"], ["api/src/index.ts", "api"], ["web/a.ts", "web"], ["docs/x.ts", null]]);
  });

  test("matches globs as git does", () => {
    expect(["a/b/c.test.ts", "c.test.ts", "a/c.ts"].map((path) => globToRegExp("**/*.test.ts").test(path))).toEqual([true, true, false]);
    expect(globToRegExp("api/src/*.ts").test("api/src/x/y.ts")).toBe(false);
  });

  test("reads globs however they are written: from ./ or /, with {a,b}", () => {
    expect(globToRegExp("./src/**").test("src/a/b.ts")).toBe(true);
    expect(globToRegExp("/src/**").test("src/a.ts")).toBe(true);
    expect(["src/api/x.ts", "src/web/y.ts", "src/jobs/z.ts"].map((path) => globToRegExp("src/{api,web}/**").test(path))).toEqual([true, true, false]);
  });

  test("makes Claude's answer whole: one of each id, parents that exist, links between known ids", () => {
    const checked = checkParts({
      project: { name: "P", summary: "" },
      parts: [{ id: "api", parent: null }, { id: "api", parent: null }, { id: "api.x", parent: "gone" }],
      outside: [{ id: "api" }, { id: "stripe" }],
      links: [{ from: "api", to: "stripe", label: "pays" }, { from: "api", to: "nowhere", label: "?" }],
    });
    expect(checked.parts.map((part) => [part.id, part.parent])).toEqual([["api", null], ["api.x", null]]);
    expect(checked.outside.map((one) => one.id)).toEqual(["stripe"]);
    expect(checked.links).toEqual([{ from: "api", to: "stripe", label: "pays" }]);
  });

  test("puts a part that is its own parent, or closes a loop of parents, at the top", () => {
    const checked = checkParts({ project: {}, parts: [{ id: "a", parent: "a" }, { id: "b", parent: "c" }, { id: "c", parent: "b" }, { id: "d", parent: "c" }], outside: [], links: [] });
    const parentOf = Object.fromEntries(checked.parts.map((part) => [part.id, part.parent]));
    expect(parentOf.a).toBeNull();
    expect([parentOf.b, parentOf.c].filter((parent) => parent === null).length).toBe(1);
    expect(parentOf.d).toBe("c");
  });

  test("renames a part called other, which is kept for the files no part claims", () => {
    const checked = checkParts({ project: {}, parts: [{ id: "other", parent: null }, { id: "other.misc", parent: "other" }], outside: [], links: [{ from: "other", to: "other.misc", label: "x" }] });
    expect(checked.parts.map((part) => [part.id, part.parent])).toEqual([["other-part", null], ["other.misc", "other-part"]]);
    expect(checked.links).toEqual([{ from: "other-part", to: "other.misc", label: "x" }]);
  });

  test("sums the folders' files and lines for the prompt", () => {
    const tree = treeOf([{ path: "api/src/a.ts", loc: 10 }, { path: "api/src/b.ts", loc: 5 }, { path: "web/c.ts", loc: 1 }]);
    expect(tree).toEqual(["api/  2 files, 15 lines", "  src/  2 files, 15 lines", "web/  1 files, 1 lines"]);
  });
});

describe("headOf", () => {
  test("keeps a file's first lines past its imports", () => {
    expect(headOf('import a from "a";\n\nexport function go() {\n  return a;\n}\n')).toEqual(["export function go() {", "  return a;", "}"]);
  });
});

describe("digestOf", () => {
  const file = (facts) => ({ path: "src/tides.test.ts", loc: 120, doc: "", defs: [], tests: [], ...facts });
  const facts = { uses: [], usedBy: 0, routes: [], head: [] };

  test("lists every name a file defines, up to 60, and says how many more", () => {
    const defs = Array.from({ length: 70 }, (_, index) => `name${index}`);
    const line = digestOf(file({ defs }), facts).split("\n").find((one) => one.includes("defines:"));
    expect(line).toBe(`  defines: ${defs.slice(0, 60).join(", ")} and 10 more`);
  });

  test("lists the tests a file holds by their titles", () => {
    const digest = digestOf(file({ tests: ["reads a port", "skips a storm, quietly"] }), facts);
    expect(digest).toContain("  tests: reads a port; skips a storm, quietly");
  });
});

describe("describePrompt", () => {
  test("asks Claude to say only what the code and the facts shown say a file does", () => {
    const prompt = describePrompt({ project: { name: "Tide Tables", summary: "Tides." }, part: null, digests: [] });
    expect(prompt).toContain("Say only what the code and the facts shown say it does");
  });
});
