// Where each import leads, and which endpoint answers each web request. Paths are relative to the
// project's folder, with "/" between folders; a repo is the folder its files sit under ("" for a
// project that is one repo).

const JS_EXTS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "vue", "svelte", "astro"];
const NODE_BUILTINS = new Set(["assert", "async_hooks", "buffer", "child_process", "cluster", "crypto", "dns", "events", "fs", "http", "http2", "https", "module", "net", "os", "path", "perf_hooks", "process", "querystring", "readline", "stream", "string_decoder", "timers", "tls", "url", "util", "v8", "vm", "worker_threads", "zlib"]);
const PYTHON_STDLIB = new Set(["abc", "argparse", "asyncio", "base64", "collections", "contextlib", "copy", "csv", "dataclasses", "datetime", "decimal", "email", "enum", "functools", "glob", "hashlib", "hmac", "http", "importlib", "inspect", "io", "itertools", "json", "logging", "math", "operator", "os", "pathlib", "pickle", "random", "re", "secrets", "shutil", "signal", "socket", "sqlite3", "string", "subprocess", "sys", "tempfile", "textwrap", "threading", "time", "traceback", "typing", "unittest", "urllib", "uuid", "warnings", "zoneinfo", "__future__"]);

export const dirOf = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
export const joinPath = (...parts) => normalize(parts.filter(Boolean).join("/"));

function normalize(path) {
  const out = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

// The package an import names, as npm or PyPI knows it, or null for one of the language's own.
export function packageOf(spec, lang) {
  if (lang === "js") {
    if (spec.startsWith("node:") || spec.startsWith("bun:")) return null;
    const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    return NODE_BUILTINS.has(name) ? null : name;
  }
  if (lang === "python") {
    const name = spec.split(".")[0];
    return name && !PYTHON_STDLIB.has(name) ? name : null;
  }
  if (lang === "go") return spec.includes(".") ? spec.split("/").slice(0, 3).join("/") : null;
  if (lang === "php") return spec.includes("\\") && !spec.startsWith("App\\") ? spec.split("\\")[0] : null;
  return null;
}

// The resolver for a project: given a file and one of its imports, the files it leads to, or the
// package it names. `aliases` are the TypeScript paths of each folder with a tsconfig, `goModules`
// the module of each folder with a go.mod; a file uses those of the folders it is in, nearest first.
export function resolverFor(files, { aliases = [], goModules = [], psr4 = [] } = {}) {
  const paths = new Set(files.map((file) => file.path));
  const pythonModules = pythonIndex(files);
  const goDirs = new Map();
  for (const file of files) {
    if (file.lang !== "go" || file.path.endsWith("_test.go")) continue;
    const dir = dirOf(file.path);
    goDirs.set(dir, [...(goDirs.get(dir) ?? []), file.path]);
  }
  const jsFile = (base) => {
    if (paths.has(base)) return base;
    for (const ext of JS_EXTS) if (paths.has(`${base}.${ext}`)) return `${base}.${ext}`;
    for (const ext of JS_EXTS) if (paths.has(`${base}/index.${ext}`)) return `${base}/index.${ext}`;
    const stripped = base.replace(/\.(js|jsx|mjs|cjs)$/, "");
    return stripped !== base ? jsFile(stripped) : null;
  };
  return (file, spec, names = []) => {
    if (file.lang === "js") return resolveJs(file, spec, jsFile, around(aliases, file.path));
    if (file.lang === "python") return resolvePython(file, spec, pythonModules, names);
    if (file.lang === "go") return resolveGo(spec, goDirs, around(goModules, file.path)[0]);
    if (file.lang === "php") return resolvePhp(spec, paths, around(psr4, file.path));
    return { files: [], pkg: null };
  };
}

// The entries of the folders a path is in, the nearest folder's first.
const around = (entries, path) => entries.filter((entry) => !entry.dir || path.startsWith(`${entry.dir}/`)).sort((a, b) => b.dir.length - a.dir.length);

function resolveJs(file, spec, jsFile, aliases) {
  if (spec.startsWith(".")) {
    const found = jsFile(joinPath(dirOf(file.path), spec));
    return { files: found ? [found] : [], pkg: null };
  }
  for (const alias of aliases) {
    if (alias.isExact ? spec !== alias.prefix : !spec.startsWith(alias.prefix)) continue;
    for (const target of alias.targets) {
      const found = jsFile(joinPath(target, spec.slice(alias.prefix.length)));
      if (found) return { files: [found], pkg: null };
    }
  }
  if (/^[~@#]\//.test(spec)) {
    for (const root of ["src", ""]) {
      const found = jsFile(joinPath(file.repo, root, spec.slice(2)));
      if (found) return { files: [found], pkg: null };
    }
  }
  return { files: [], pkg: packageOf(spec, "js") };
}

function resolvePhp(spec, paths, roots) {
  for (const root of roots) {
    if (!spec.startsWith(root.prefix)) continue;
    const path = joinPath(root.target, `${spec.slice(root.prefix.length).split("\\").join("/")}.php`);
    if (paths.has(path)) return { files: [path], pkg: null };
  }
  return { files: [], pkg: packageOf(spec, "php") };
}

// composer.json's PSR-4 roots: each namespace and the folder its classes are in.
export function psr4Of(composerText, dir) {
  let composer;
  try {
    composer = JSON.parse(composerText);
  } catch (error) {
    console.log(`chartroom: the composer.json in ${dir || "the project's folder"} was left out: ${error.message}`);
    return [];
  }
  const roots = { ...composer?.autoload?.["psr-4"], ...composer?.["autoload-dev"]?.["psr-4"] };
  return Object.entries(roots).flatMap(([prefix, targets]) => [targets].flat().map((target) => ({ dir, prefix, target: joinPath(dir, target) })));
}

// The module a go.mod names, for the files in `dir`.
export function goModuleOf(goModText, dir) {
  const module = /^module\s+(\S+)/m.exec(goModText)?.[1];
  return module ? { dir, module } : null;
}

// Every Python module by its dotted name, from the repo's top and from a src folder.
function pythonIndex(files) {
  const modules = new Map();
  for (const file of files) {
    if (file.lang !== "python") continue;
    const inRepo = file.repo ? file.path.slice(file.repo.length + 1) : file.path;
    const dotted = inRepo.replace(/\.py$/, "").replace(/\/__init__$/, "").split("/").join(".");
    for (const name of [dotted, dotted.startsWith("src.") ? dotted.slice(4) : null]) {
      if (name && !modules.has(`${file.repo}|${name}`)) modules.set(`${file.repo}|${name}`, file.path);
    }
  }
  return modules;
}

// `from . import users` names a module too: each name is tried as one before the package itself.
function resolvePython(file, spec, modules, names) {
  const lookup = (name) => modules.get(`${file.repo}|${name}`) ?? modules.get(`${file.repo}|${name.replace(/^src\./, "")}`);
  if (spec.startsWith(".")) {
    const dots = /^\.+/.exec(spec)[0].length;
    const inRepo = file.repo ? file.path.slice(file.repo.length + 1) : file.path;
    const folders = dirOf(inRepo).split("/").filter(Boolean);
    const name = [...folders.slice(0, Math.max(0, folders.length - (dots - 1))), ...spec.slice(dots).split(".").filter(Boolean)].join(".");
    const named = names.map((one) => lookup(name ? `${name}.${one}` : one)).filter(Boolean);
    const found = named.length ? named : [lookup(name)].filter(Boolean);
    return { files: [...new Set(found)], pkg: null };
  }
  const parts = spec.split(".");
  for (let end = parts.length; end > 0; end -= 1) {
    const found = lookup(parts.slice(0, end).join("."));
    if (found) return { files: [found], pkg: null };
  }
  return { files: [], pkg: packageOf(spec, "python") };
}

function resolveGo(spec, goDirs, found) {
  const module = found?.module;
  if (module && (spec === module || spec.startsWith(`${module}/`))) {
    const dir = joinPath(found.dir, spec.slice(module.length + 1));
    return { files: goDirs.get(dir) ?? [], pkg: null };
  }
  return { files: [], pkg: packageOf(spec, "go") };
}

// A tsconfig's paths as prefixes to try, each with the folders it stands for, for the files in
// `dir` (the tsconfig's folder). JSON with comments and trailing commas is read as TypeScript
// reads it.
export function aliasesOf(tsconfigText, dir) {
  let config;
  try {
    config = JSON.parse(tsconfigText.replace(/\/\*[\s\S]*?\*\/|(^|[^:"])\/\/.*$/gm, "$1").replace(/,(\s*[}\]])/g, "$1"));
  } catch (error) {
    console.log(`chartroom: the tsconfig paths in ${dir || "the project's folder"} were left out: ${error.message}`);
    return [];
  }
  const options = config?.compilerOptions ?? {};
  const base = joinPath(dir, options.baseUrl ?? ".");
  const paths = Object.entries(options.paths ?? {}).map(([key, targets]) => ({
    dir,
    prefix: key.replace(/\*$/, ""),
    isExact: !key.endsWith("*"),
    targets: targets.map((target) => joinPath(base, target.replace(/\*$/, ""))),
  })).sort((a, b) => b.prefix.length - a.prefix.length);
  // With a baseUrl, a bare import is looked for under it before it counts as a package.
  return options.baseUrl ? [...paths, { dir, prefix: "", targets: [base] }] : paths;
}

const segmentsOf = (path) => path.split("/").filter(Boolean).map((part) => (/^(:|\{|<|\[|\*)/.test(part) ? ":" : part.toLowerCase()));

// The endpoint that answers a request: its path ends the way the request's does, a variable part
// matching anything, and at least one fixed part the same. The longest such match wins. A request
// that names only part of the address (its start lives in settings) still finds its endpoint.
export function endpointFor(request, routes) {
  const asked = segmentsOf(request.path);
  let best = null;
  for (const route of routes) {
    if (route.file === request.file) continue;
    if (request.m !== "ANY" && route.m !== "ANY" && request.m !== route.m) continue;
    const answered = segmentsOf(route.p);
    if (!answered.length || answered.length > asked.length + 1) continue;
    const score = suffixScore(asked, answered);
    if (score > 0 && (!best || score > best.score)) best = { route, score };
  }
  return best?.route ?? null;
}

// How many fixed parts the two share from their ends, or 0 when they part ways. The request may
// lack one leading part of the route's (a prefix kept in settings).
function suffixScore(asked, answered) {
  let fixed = 0;
  for (let i = 1; i <= answered.length; i += 1) {
    const a = asked[asked.length - i];
    const b = answered[answered.length - i];
    if (a === undefined) return i === answered.length && fixed > 0 ? fixed : 0;
    if (a === ":" || b === ":") continue;
    if (a !== b) return 0;
    fixed += 1;
  }
  return fixed;
}
