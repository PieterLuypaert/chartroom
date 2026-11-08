// What one file says about itself, read from its text with patterns rather than a parser: what it
// imports, what it defines, the comment at its top, the endpoints it answers and the web requests
// it makes, and where its routes are mounted: a prefix for all of its own routes (`prefix`), and
// the routers it mounts at a path (`mounts`, each the imported name of a router and its path). Patterns catch most of these, not all of them; Claude fills in what they miss.

const JS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "vue", "svelte", "astro"];
const LANGS = { python: ["py"], go: ["go"], rust: ["rs"], jvm: ["java", "kt", "kts", "scala", "groovy"], ruby: ["rb"], php: ["php"], csharp: ["cs"], swift: ["swift"], elixir: ["ex", "exs"], dart: ["dart"], shell: ["sh", "bash", "zsh"], sql: ["sql"] };

// The language a file is written in, by its extension, or null for a file that is not code.
export function langOf(path) {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (JS.includes(ext)) return "js";
  for (const [lang, exts] of Object.entries(LANGS)) if (exts.includes(ext)) return lang;
  return null;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
// The line an index of a text is on, by halving over where its lines start, which are counted once
// per text and only when asked: counting the lines before each match instead grows with the square
// of a big file's size.
function lineFinder(text) {
  let starts = null;
  return (index) => {
    if (!starts) {
      starts = [0];
      for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
    }
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= index) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
}
const all = (pattern, text) => [...text.matchAll(pattern)];

export function extract(path, text) {
  const lang = langOf(path);
  const by = { js: extractJs, python: extractPython, go: extractGo, php: extractPhp, jvm: extractJvm, rust: extractRust }[lang];
  const found = by ? by(path, text) : { imports: [], defs: [], routes: [], requests: [] };
  return { lang, doc: docOf(text), prefix: "", mounts: [], ...found, tests: testsOf(lang, text) };
}

// The titles of the tests a file holds, in order and at most MAX_TESTS, so a test file is described
// by all it checks rather than by its first lines: JS/TS describe, it and test with their first
// string (not a call such as /x/.test(…)); Python test_ functions and Test classes; Go Test
// functions; Java and Kotlin methods under @Test; Rust functions under #[test].
const MAX_TESTS = 60;
const TESTS = {
  js: /(?<![.\w$])(?:describe|it|test)(?:\.(?:only|skip|todo|concurrent))?\s*\(\s*(['"`])(.*?)\1/g,
  python: /^[ \t]*(?:async\s+)?def\s+(test_\w+)|^[ \t]*class\s+(Test\w*)/gm,
  go: /^func\s+(Test\w+)\s*\(/gm,
  jvm: /@Test\b[^\n]*\n(?:[ \t]*@[^\n]*\n)*[ \t]*(?:(?:public|private|protected|internal|open|override|suspend|final)\s+)*(?:fun|void)\s+(`[^`\n]+`|\w+)/g,
  rust: /#\[(?:tokio::)?test\][^\n]*\n(?:[ \t]*#\[[^\]\n]*\][ \t]*\n)*[ \t]*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/g,
};

function testsOf(lang, text) {
  const pattern = TESTS[lang];
  if (!pattern) return [];
  const titles = [];
  for (const m of text.matchAll(pattern)) {
    const title = (lang === "js" ? m[2] : m[1] ?? m[2]).replace(/^`|`$/g, "").trim();
    if (title && !titles.includes(title)) titles.push(title);
    if (titles.length === MAX_TESTS) break;
  }
  return titles;
}

// The comment a file opens with, as one short line.
function docOf(text) {
  const head = text.replace(/^(#!.*\n|\s*["']use (strict|client|server)["'];?\s*\n|\s*package .*\n)+/, "").trimStart();
  const block = /^\/\*\*?([\s\S]*?)\*\//.exec(head) ?? /^("""|''')([\s\S]*?)\1/.exec(head);
  const lines = block ? block[block.length - 1].split("\n") : head.match(/^((\/\/|#).*\n?)+/)?.[0].split("\n") ?? [];
  const words = lines.map((line) => line.replace(/^\s*(\/\/+!?|#+|\*+)\s?/, "").trim()).filter(Boolean).join(" ");
  return words.slice(0, 240);
}

// A URL as a path with its variable parts as :p, the host when it names one, or null when the
// address is all variable. A host or port that is a variable (http://${host}/orders,
// http://localhost:${PORT}/api) still leaves the path to match.
export function urlOf(raw) {
  let url = raw.replace(/\$\{[^}]*\}|\{[^}]*\}/g, ":p").replace(/[?#].*$/, "").trim();
  let host = null;
  const absolute = /^(?:https?:)?\/\/([^/]*)(.*)$/.exec(url);
  if (absolute) {
    const name = absolute[1].split(":")[0].toLowerCase();
    host = name || null;
    url = absolute[2] || "/";
  }
  if (url.startsWith(":p/")) url = url.slice(2);
  if (!url.startsWith("/")) return host ? { host, path: "/" } : null;
  return { host, path: url.replace(/\/+$/, "") || "/" };
}

function extractJs(path, text) {
  const imports = [];
  for (const m of all(/(?:^|[;\n])\s*import\s+(?:type\s+)?([\w*{}\s,$]+?)\s+from\s+['"]([^'"]+)['"]/g, text)) imports.push({ spec: m[2], names: importNames(m[1]) });
  for (const m of all(/(?:^|[;\n])\s*import\s+['"]([^'"]+)['"]/g, text)) imports.push({ spec: m[1], names: [] });
  for (const m of all(/(?:^|[;\n])\s*export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g, text)) imports.push({ spec: m[1], names: [] });
  const bound = new Set();
  for (const m of all(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g, text)) {
    imports.push({ spec: m[2], names: [m[1]] });
    bound.add(m[2]);
  }
  for (const m of all(/\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g, text)) if (!bound.has(m[1])) imports.push({ spec: m[1], names: [] });
  const defs = all(/(?:^|\n)\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([\w$]+)/g, text).map((m) => m[1]);
  return { imports, defs: [...new Set(defs)], routes: jsRoutes(path, text), requests: jsRequests(text), mounts: jsMounts(text) };
}

// Routers mounted at a path: Express's app.use("/api", auth, router), Hono's app.route("/api", api),
// Fastify's register(routes, { prefix: "/api" }). The router is the last plain name given.
function jsMounts(text) {
  const mounts = [];
  const add = (prefix, name) => name && mounts.push({ prefix, name: name.split(".")[0] });
  for (const m of all(/\.(?:use|route)\(\s*(['"`])(\/[^'"`]*)\1\s*,([^)]*)\)/g, text)) add(m[2], m[3].split(",").map((one) => one.trim()).filter((one) => /^[\w$.]+$/.test(one)).at(-1));
  for (const m of all(/\.register\(\s*([\w$.]+)\s*,\s*\{[^}]*prefix\s*:\s*(['"`])(\/[^'"`]*)\2/g, text)) add(m[3], m[1]);
  return mounts;
}

function importNames(clause) {
  const names = [];
  const braces = /\{([^}]*)\}/.exec(clause);
  if (braces) for (const part of braces[1].split(",")) {
    const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
    if (name) names.push(name);
  }
  const lead = clause.replace(/\{[^}]*\}/, "").split(",")[0].trim();
  if (lead && !lead.startsWith("*")) names.unshift(lead);
  return names;
}

function jsRoutes(path, text) {
  const lineAt = lineFinder(text);
  const routes = all(/\b(?:app|router|server|fastify|hono|routes|r)\.(get|post|put|patch|delete|all)\(\s*(['"`])(\/[^'"`]*)\2/gi, text)
    .map((m) => ({ m: m[1].toUpperCase() === "ALL" ? "ANY" : m[1].toUpperCase(), p: m[3], line: lineAt(m.index) }));
  const appRoute = /(?:^|\/)app\/(.*?)\/?route\.[cm]?[jt]sx?$/.exec(path);
  if (appRoute) {
    const url = nextPath(appRoute[1]);
    for (const m of all(/export\s+(?:async\s+function|function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g, text)) routes.push({ m: m[1], p: url, line: lineAt(m.index) });
  }
  const pagesApi = /(?:^|\/)pages\/(api\/.*?)\.[cm]?[jt]sx?$/.exec(path);
  if (pagesApi) routes.push({ m: "ANY", p: nextPath(pagesApi[1].replace(/\/index$/, "")), line: 1 });
  return routes;
}

// A Next.js folder path as a URL: groups and slots left out, [id] as :id.
function nextPath(folders) {
  const parts = folders.split("/").filter((part) => part && !/^\(.*\)$/.test(part) && !part.startsWith("@"));
  return `/${parts.map((part) => part.replace(/^\[\.{3}(.+)\]$/, ":$1").replace(/^\[(.+)\]$/, ":$1")).join("/")}`.replace(/\/$/, "") || "/";
}

function jsRequests(text) {
  const lineAt = lineFinder(text);
  const requests = [];
  const add = (method, raw, index) => {
    const url = urlOf(raw);
    if (url) requests.push({ m: method, ...url, line: lineAt(index) });
  };
  for (const m of all(/\b(?:fetch|\$fetch|ofetch|useFetch)\(\s*(['"`])([^'"`]+)\1([^)]*)/g, text)) {
    const method = /method:\s*['"](\w+)['"]/.exec(m[3])?.[1]?.toUpperCase();
    add(METHODS.includes(method) ? method : "ANY", m[2], m.index);
  }
  for (const m of all(/\b(?:axios|ky|got|api|apiClient|client|http|request|instance|\$api)\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/g, text)) add(m[1].toUpperCase(), m[3], m.index);
  return requests;
}

function extractPython(_path, text) {
  const lineAt = lineFinder(text);
  const imports = [];
  // `from x import (a,\n b)` runs over lines, as Black and Ruff write long imports.
  for (const m of all(/^[ \t]*from\s+(\.*[\w.]*)\s+import\s+(\([^)]*\)|[^\n]*)/gm, text)) {
    const names = m[2].replace(/[()\\]/g, " ").replace(/#.*$/gm, "").split(/[,\n]/).map((name) => name.trim().split(/\s+as\s+/)[0]).filter((name) => /^[\w*]+$/.test(name));
    imports.push({ spec: m[1], names });
  }
  for (const m of all(/^[ \t]*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)/gm, text)) {
    for (const part of m[1].split(",")) imports.push({ spec: part.trim().split(/\s+as\s+/)[0], names: [] });
  }
  const defs = all(/^(?:async\s+)?(?:def|class)\s+(\w+)/gm, text).map((m) => m[1]).filter((name) => !name.startsWith("_"));
  const routes = [];
  for (const m of all(/@\w+\.(get|post|put|patch|delete|route|api_route)\(\s*['"](\/[^'"]*)['"]([^)]*)\)/g, text)) {
    const listed = /methods\s*=\s*\[\s*['"](\w+)['"]/.exec(m[3])?.[1]?.toUpperCase();
    const method = ["route", "api_route"].includes(m[1]) ? listed ?? "GET" : m[1].toUpperCase();
    routes.push({ m: method, p: m[2].replace(/<(?:\w+:)?(\w+)>/g, ":$1").replace(/\{(\w+)\}/g, ":$1"), line: lineAt(m.index) });
  }
  const requests = [];
  for (const m of all(/\b(?:requests|httpx|client|session|self\.client|self\.session)\.(get|post|put|patch|delete)\(\s*f?(['"])([^'"]+)\2/g, text)) {
    const url = urlOf(m[3]);
    if (url) requests.push({ m: m[1].toUpperCase(), ...url, line: lineAt(m.index) });
  }
  // A FastAPI router's or a Flask blueprint's own prefix, and the routers mounted elsewhere.
  const prefix = /\b(?:APIRouter\([^)]*?\bprefix|Blueprint\([^)]*?\burl_prefix)\s*=\s*['"](\/[^'"]*)['"]/.exec(text)?.[1] ?? "";
  const mounts = all(/\.(?:include_router|register_blueprint)\(\s*([\w.]+)[^)]*?\b(?:url_)?prefix\s*=\s*['"](\/[^'"]*)['"]/g, text).map((m) => ({ prefix: m[2], name: m[1].split(".")[0] }));
  return { imports, defs: [...new Set(defs)], routes, requests, prefix, mounts };
}

// PHP: its `use` lines, its classes, and Symfony's #[Route] attributes or @Route annotations, a
// class's own route being the start of its methods' routes.
function extractPhp(_path, text) {
  const lineAt = lineFinder(text);
  const imports = all(/^use\s+([\w\\]+)(?:\s+as\s+\w+)?\s*;/gm, text).map((m) => ({ spec: m[1], names: [m[1].split("\\").pop()] }));
  const defs = all(/^(?:final\s+|abstract\s+|readonly\s+)*(?:class|interface|trait|enum)\s+(\w+)/gm, text).map((m) => m[1]);
  const classAt = /^(?:final\s+|abstract\s+|readonly\s+)*class\s+\w+/m.exec(text)?.index ?? -1;
  const found = all(/(?:#\[Route\(|@Route\()\s*(?:path:\s*)?['"](\/?[^'"]*)['"]([^\]\n]*)/g, text).map((m) => ({
    p: m[1],
    m: /methods\s*[:=]\s*[\[{]\s*['"](\w+)['"]/.exec(m[2])?.[1]?.toUpperCase() ?? "ANY",
    isPrefix: m.index < classAt,
    line: lineAt(m.index),
  }));
  const prefix = found.find((one) => one.isPrefix)?.p ?? "";
  const routes = found.filter((one) => !one.isPrefix).map((one) => ({ m: one.m, p: `/${[prefix, one.p].join("/").split("/").filter(Boolean).join("/")}`.replace(/\{(\w+)\}/g, ":$1"), line: one.line }));
  return { imports, defs: [...new Set(defs)], routes, requests: [] };
}

// Java and Kotlin: the package a file declares (`namespace`, as its folder need not match it), its
// imports, and what it defines at its top level, Kotlin's functions and values included, as it
// imports those by name too. A static import or a class inside a class names more than a file;
// the resolver tries the shorter names. Scala and Groovy are left out.
const ANNOTATIONS = String.raw`(?:@[\w.:]+(?:\([^)\n]*\))?\s+)*`;
const JAVA_TYPE = new RegExp(String.raw`^${ANNOTATIONS}(?:(?:public|abstract|final|sealed|non-sealed|strictfp)\s+)*(?:class|interface|enum|record|@interface)\s+(\w+)`, "gm");
const KOTLIN_LEAD = String.raw`^${ANNOTATIONS}(?:(?:public|internal|protected|open|abstract|sealed|data|enum|annotation|inner|value|inline|suspend|operator|infix|tailrec|external|expect|actual|const|lateinit)\s+)*`;
// Type parameters, one level of them nested (<T : Comparable<T>>), and the receiver of an extension.
const KOTLIN_TYPE_PARAMS = String.raw`(?:<(?:[^<>]|<[^<>]*>)*>\s*)?`;
const KOTLIN_TYPE = new RegExp(String.raw`${KOTLIN_LEAD}(?:class|interface|object|fun\s+interface)\s+(\w+)`, "gm");
const KOTLIN_FUN = new RegExp(String.raw`${KOTLIN_LEAD}fun\s+(?!interface\b)${KOTLIN_TYPE_PARAMS}(?:[^(=\n]*\.)?(\w+)\s*\(`, "gm");
const KOTLIN_VALUE = new RegExp(String.raw`${KOTLIN_LEAD}(?:val|var)\s+${KOTLIN_TYPE_PARAMS}(?:[^=:\n]*\.)?(\w+)\s*[:=]`, "gm");

function extractJvm(path, text) {
  if (!/\.(java|kts?)$/.test(path)) return { imports: [], defs: [], routes: [], requests: [] };
  const namespace = /^[ \t]*package\s+([\w.]+)/m.exec(text)?.[1] ?? "";
  const imports = all(/^[ \t]*import\s+(?:static\s+)?(\w+(?:\.\w+)*(?:\.\*)?)/gm, text).map((m) => ({ spec: m[1], names: m[1].endsWith(".*") ? [] : [m[1].split(".").pop()] }));
  const defs = path.endsWith(".java")
    ? all(JAVA_TYPE, text).map((m) => m[1])
    : [KOTLIN_TYPE, KOTLIN_FUN, KOTLIN_VALUE].flatMap((pattern) => all(pattern, text)).sort((a, b) => a.index - b.index).map((m) => m[1]);
  return { imports, defs: [...new Set(defs)], routes: [], requests: [], namespace };
}

// Rust: the modules a file declares in other files (`mod orders;`, read as `self::orders`), what it
// uses, and its public items. Only the lines at the file's top level count: a `use super::*` in an
// inline `mod tests { }` means the file itself, not the module above it.
const RUST_LEAD = String.raw`^(?:#\[[^\]\n]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?`;
const RUST_ITEM = new RegExp(String.raw`^(?:#\[[^\]\n]*\]\s*)*pub(?:\([^)]*\))?\s+(?:(?:async|const|unsafe|extern\s+"[^"]*")\s+)*(?:fn|struct|enum|trait|type|const|static|mod|union)\s+(\w+)`, "gm");

function extractRust(_path, text) {
  const found = [
    ...all(new RegExp(String.raw`${RUST_LEAD}mod\s+(\w+)\s*;`, "gm"), text).map((m) => ({ index: m.index, paths: [`self::${m[1]}`] })),
    ...all(new RegExp(String.raw`${RUST_LEAD}use\s+([^;]+);`, "gm"), text).filter((m) => isUseTree(m[1])).map((m) => ({ index: m.index, paths: usePaths(m[1]) })),
    ...all(new RegExp(String.raw`${RUST_LEAD}extern\s+crate\s+(\w+)`, "gm"), text).map((m) => ({ index: m.index, paths: [m[1]] })),
  ].sort((a, b) => a.index - b.index);
  const imports = found.flatMap((one) => one.paths).map((spec) => ({ spec, names: spec.endsWith("::*") ? [] : [spec.split("::").pop()] }));
  return { imports, defs: [...new Set(all(RUST_ITEM, text).map((m) => m[1]))], routes: [], requests: [] };
}

// Whether text after `use` is a use tree, and not a line of prose in a string that starts with it:
// names, ::, braces, commas and *, with no two words side by side but for `as`.
const isUseTree = (tree) => /^[\w:{},*\s]+$/.test(tree) && !/\w\s+\w/.test(tree.replace(/\s+as\s+\w+/g, ""));

// A use tree as the paths it names: `a::{b, c::{self, d}} as e` is a::b, a::c and a::c::d.
function usePaths(tree) {
  const plain = tree.replace(/\s+as\s+\w+/g, "").replace(/\s+/g, "").replace(/^::/, "");
  const open = plain.indexOf("{");
  if (open < 0) return plain ? [plain] : [];
  const prefix = plain.slice(0, open);
  const parts = [];
  let depth = 0;
  let start = open + 1;
  for (let i = start; i < plain.lastIndexOf("}"); i += 1) {
    if (plain[i] === "{") depth += 1;
    else if (plain[i] === "}") depth -= 1;
    else if (plain[i] === "," && depth === 0) {
      parts.push(plain.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(plain.slice(start, plain.lastIndexOf("}")));
  return parts.flatMap(usePaths).map((path) => (path === "self" ? prefix.replace(/::$/, "") : `${prefix}${path}`)).filter(Boolean);
}

function extractGo(_path, text) {
  const lineAt = lineFinder(text);
  const imports = [];
  for (const m of all(/^import\s+(?:\w+\s+)?"([^"]+)"/gm, text)) imports.push({ spec: m[1], names: [] });
  for (const block of all(/^import\s*\(([\s\S]*?)\)/gm, text)) for (const m of all(/"([^"]+)"/g, block[1])) imports.push({ spec: m[1], names: [] });
  const defs = all(/^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/gm, text).map((m) => m[1]);
  const routes = [];
  for (const m of all(/\.(?:HandleFunc|Handle)\(\s*"(?:(GET|POST|PUT|PATCH|DELETE)\s+)?(\/[^"]*)"/g, text)) routes.push({ m: m[1] ?? "ANY", p: m[2], line: lineAt(m.index) });
  for (const m of all(/\.(GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete)\(\s*"(\/[^"]*)"/g, text)) routes.push({ m: m[1].toUpperCase(), p: m[2].replace(/\{(\w+)\}/g, ":$1"), line: lineAt(m.index) });
  const requests = [];
  for (const m of all(/http\.(Get|Post)\(\s*"([^"]+)"/g, text)) {
    const url = urlOf(m[2]);
    if (url) requests.push({ m: m[1].toUpperCase(), ...url, line: lineAt(m.index) });
  }
  for (const m of all(/http\.NewRequest(?:WithContext)?\([^,]*?"?(\w+)"?,\s*"([^"]+)"/g, text)) {
    const url = urlOf(m[2]);
    if (url) requests.push({ m: METHODS.includes(m[1].toUpperCase()) ? m[1].toUpperCase() : "ANY", ...url, line: lineAt(m.index) });
  }
  return { imports, defs: [...new Set(defs)], routes, requests };
}
