import { describe, expect, test } from "bun:test";
import { assign, checkParts, globToRegExp, treeOf } from "../draw/parts.js";
import { headOf } from "../draw/describe.js";

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
