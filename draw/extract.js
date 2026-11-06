// What one file says about itself, read from its text with patterns rather than a parser: what it
// imports, what it defines, the comment at its top, the endpoints it answers and the web requests
// it makes. Patterns catch most of these, not all of them; Claude fills in what they miss.

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
const lineAt = (text, index) => text.slice(0, index).split("\n").length;
const all = (pattern, text) => [...text.matchAll(pattern)];

export function extract(path, text) {
  const lang = langOf(path);
  const by = { js: extractJs, python: extractPython, go: extractGo, php: extractPhp }[lang];
  const found = by ? by(path, text) : { imports: [], defs: [], routes: [], requests: [] };
  return { lang, doc: docOf(text), ...found };
}

// The comment a file opens with, as one short line.
function docOf(text) {
  const head = text.replace(/^(#!.*\n|\s*["']use (strict|client|server)["'];?\s*\n|\s*package .*\n)+/, "").trimStart();
  const block = /^\/\*\*?([\s\S]*?)\*\//.exec(head) ?? /^("""|''')([\s\S]*?)\1/.exec(head);
  const lines = block ? block[block.length - 1].split("\n") : head.match(/^((\/\/|#).*\n?)+/)?.[0].split("\n") ?? [];
  const words = lines.map((line) => line.replace(/^\s*(\/\/+|#+|\*+)\s?/, "").trim()).filter(Boolean).join(" ");
  return words.slice(0, 240);
}

// A URL as a path with its variable parts as :p, the host when it names one, or null when the
// address is all variable.
export function urlOf(raw) {
  let url = raw.replace(/\$\{[^}]*\}|\{[^}]*\}/g, ":p").replace(/[?#].*$/, "").trim();
  let host = null;
  const absolute = /^https?:\/\/([^/:]+)(:\d+)?(.*)$/.exec(url);
  if (absolute) {
    host = absolute[1] === ":p" ? null : absolute[1].toLowerCase();
    url = absolute[3] || "/";
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
  for (const m of all(/\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g, text)) imports.push({ spec: m[1], names: [] });
  const defs = all(/(?:^|\n)\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([\w$]+)/g, text).map((m) => m[1]);
  return { imports, defs: [...new Set(defs)], routes: jsRoutes(path, text), requests: jsRequests(text) };
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
  const routes = all(/\b(?:app|router|server|fastify|hono|routes|r)\.(get|post|put|patch|delete|all)\(\s*(['"`])(\/[^'"`]*)\2/gi, text)
    .map((m) => ({ m: m[1].toUpperCase() === "ALL" ? "ANY" : m[1].toUpperCase(), p: m[3], line: lineAt(text, m.index) }));
  const appRoute = /(?:^|\/)app\/(.*?)\/?route\.[cm]?[jt]sx?$/.exec(path);
  if (appRoute) {
    const url = nextPath(appRoute[1]);
    for (const m of all(/export\s+(?:async\s+function|function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g, text)) routes.push({ m: m[1], p: url, line: lineAt(text, m.index) });
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
  const requests = [];
  const add = (method, raw, index) => {
    const url = urlOf(raw);
    if (url) requests.push({ m: method, ...url, line: lineAt(text, index) });
  };
  for (const m of all(/\b(?:fetch|\$fetch|ofetch|useFetch)\(\s*(['"`])([^'"`]+)\1([^)]*)/g, text)) {
    const method = /method:\s*['"](\w+)['"]/.exec(m[3])?.[1]?.toUpperCase();
    add(METHODS.includes(method) ? method : "ANY", m[2], m.index);
  }
  for (const m of all(/\b(?:axios|ky|got|api|apiClient|client|http|request|instance|\$api)\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/g, text)) add(m[1].toUpperCase(), m[3], m.index);
  return requests;
}

function extractPython(_path, text) {
  const imports = [];
  for (const m of all(/^[ \t]*from\s+(\.*[\w.]*)\s+import\s+\(?([\w*, \t]+)/gm, text)) imports.push({ spec: m[1], names: m[2].split(",").map((name) => name.trim().split(/\s+as\s+/)[0]).filter(Boolean) });
  for (const m of all(/^[ \t]*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)/gm, text)) {
    for (const part of m[1].split(",")) imports.push({ spec: part.trim().split(/\s+as\s+/)[0], names: [] });
  }
  const defs = all(/^(?:async\s+)?(?:def|class)\s+(\w+)/gm, text).map((m) => m[1]).filter((name) => !name.startsWith("_"));
  const routes = [];
  for (const m of all(/@\w+\.(get|post|put|patch|delete|route|api_route)\(\s*['"](\/[^'"]*)['"]([^)]*)\)/g, text)) {
    const listed = /methods\s*=\s*\[\s*['"](\w+)['"]/.exec(m[3])?.[1]?.toUpperCase();
    const method = ["route", "api_route"].includes(m[1]) ? listed ?? "GET" : m[1].toUpperCase();
    routes.push({ m: method, p: m[2].replace(/<(?:\w+:)?(\w+)>/g, ":$1").replace(/\{(\w+)\}/g, ":$1"), line: lineAt(text, m.index) });
  }
  const requests = [];
  for (const m of all(/\b(?:requests|httpx|client|session|self\.client|self\.session)\.(get|post|put|patch|delete)\(\s*f?(['"])([^'"]+)\2/g, text)) {
    const url = urlOf(m[3]);
    if (url) requests.push({ m: m[1].toUpperCase(), ...url, line: lineAt(text, m.index) });
  }
  return { imports, defs: [...new Set(defs)], routes, requests };
}

// PHP: its `use` lines, its classes, and Symfony's #[Route] attributes or @Route annotations, a
// class's own route being the start of its methods' routes.
function extractPhp(_path, text) {
  const imports = all(/^use\s+([\w\\]+)(?:\s+as\s+\w+)?\s*;/gm, text).map((m) => ({ spec: m[1], names: [m[1].split("\\").pop()] }));
  const defs = all(/^(?:final\s+|abstract\s+|readonly\s+)*(?:class|interface|trait|enum)\s+(\w+)/gm, text).map((m) => m[1]);
  const classAt = /^(?:final\s+|abstract\s+|readonly\s+)*class\s+\w+/m.exec(text)?.index ?? -1;
  const found = all(/(?:#\[Route\(|@Route\()\s*(?:path:\s*)?['"](\/?[^'"]*)['"]([^\]\n]*)/g, text).map((m) => ({
    p: m[1],
    m: /methods\s*[:=]\s*[\[{]\s*['"](\w+)['"]/.exec(m[2])?.[1]?.toUpperCase() ?? "ANY",
    isPrefix: m.index < classAt,
    line: lineAt(text, m.index),
  }));
  const prefix = found.find((one) => one.isPrefix)?.p ?? "";
  const routes = found.filter((one) => !one.isPrefix).map((one) => ({ m: one.m, p: `/${[prefix, one.p].join("/").split("/").filter(Boolean).join("/")}`.replace(/\{(\w+)\}/g, ":$1"), line: one.line }));
  return { imports, defs: [...new Set(defs)], routes, requests: [] };
}

function extractGo(_path, text) {
  const imports = [];
  for (const m of all(/^import\s+(?:\w+\s+)?"([^"]+)"/gm, text)) imports.push({ spec: m[1], names: [] });
  for (const block of all(/^import\s*\(([\s\S]*?)\)/gm, text)) for (const m of all(/"([^"]+)"/g, block[1])) imports.push({ spec: m[1], names: [] });
  const defs = all(/^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/gm, text).map((m) => m[1]);
  const routes = [];
  for (const m of all(/\.(?:HandleFunc|Handle)\(\s*"(?:(GET|POST|PUT|PATCH|DELETE)\s+)?(\/[^"]*)"/g, text)) routes.push({ m: m[1] ?? "ANY", p: m[2], line: lineAt(text, m.index) });
  for (const m of all(/\.(GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete)\(\s*"(\/[^"]*)"/g, text)) routes.push({ m: m[1].toUpperCase(), p: m[2].replace(/\{(\w+)\}/g, ":$1"), line: lineAt(text, m.index) });
  const requests = [];
  for (const m of all(/http\.(Get|Post)\(\s*"([^"]+)"/g, text)) {
    const url = urlOf(m[2]);
    if (url) requests.push({ m: m[1].toUpperCase(), ...url, line: lineAt(text, m.index) });
  }
  for (const m of all(/http\.NewRequest(?:WithContext)?\([^,]*?"?(\w+)"?,\s*"([^"]+)"/g, text)) {
    const url = urlOf(m[2]);
    if (url) requests.push({ m: METHODS.includes(m[1].toUpperCase()) ? m[1].toUpperCase() : "ANY", ...url, line: lineAt(text, m.index) });
  }
  return { imports, defs: [...new Set(defs)], routes, requests };
}
