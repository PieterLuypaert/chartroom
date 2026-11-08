// Where each import leads, and which endpoint answers each web request. Paths are relative to the
// project's folder, with "/" between folders; a repo is the folder its files sit under ("" for a
// project that is one repo).

// Adds a value to the list a map keeps under a key, in place: copying the list for each value grows
// with the square of a big project's size.
const push = (map, key, value) => {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
};

const JS_EXTS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "vue", "svelte", "astro"];
const NODE_BUILTINS = new Set(["assert", "async_hooks", "buffer", "child_process", "cluster", "crypto", "dns", "events", "fs", "http", "http2", "https", "module", "net", "os", "path", "perf_hooks", "process", "querystring", "readline", "stream", "string_decoder", "timers", "tls", "url", "util", "v8", "vm", "worker_threads", "zlib"]);
// The packages Java, Kotlin and Android come with, which name no outside package.
const JVM_PLATFORM = new Set(["java", "javax", "kotlin", "jdk", "android"]);
// Rust's own crates, and the words a path starts with inside a crate.
const RUST_OWN = new Set(["std", "core", "alloc", "proc_macro", "test", "crate", "self", "super"]);
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
  if (lang === "jvm") {
    // The package's own parts are those before its first class (dagger.Module is dagger's).
    const parts = spec.replace(/\.\*$/, "").split(".");
    const firstClass = parts.findIndex((part) => /^[A-Z]/.test(part));
    const folders = firstClass > 0 ? parts.slice(0, firstClass) : parts;
    return JVM_PLATFORM.has(parts[0]) ? null : folders.slice(0, 2).join(".");
  }
  if (lang === "rust") {
    const name = spec.replace(/^::/, "").split("::")[0];
    return RUST_OWN.has(name) ? null : name;
  }
  return null;
}

// The resolver for a project: given a file and one of its imports, the files it leads to, or the
// package it names. `aliases` are the TypeScript paths of each folder with a tsconfig, `goModules`
// the module of each folder with a go.mod, `crates` the Rust crate of each folder with a Cargo.toml;
// a file uses those of the folders it is in, nearest first.
export function resolverFor(files, { aliases = [], goModules = [], psr4 = [], crates = [] } = {}) {
  const paths = new Set(files.map((file) => file.path));
  const pythonModules = pythonIndex(files);
  const jvm = jvmIndex(files);
  const rust = { paths, crates, rootDirs: files.filter((file) => /(^|\/)(lib|main)\.rs$/.test(file.path)).map((file) => dirOf(file.path)) };
  const goDirs = new Map();
  for (const file of files) {
    if (file.lang !== "go" || file.path.endsWith("_test.go")) continue;
    const dir = dirOf(file.path);
    push(goDirs, dir, file.path);
  }
  const jsFile = (base) => {
    if (paths.has(base)) return base;
    for (const ext of JS_EXTS) if (paths.has(`${base}.${ext}`)) return `${base}.${ext}`;
    for (const ext of JS_EXTS) if (paths.has(`${base}/index.${ext}`)) return `${base}/index.${ext}`;
    // A project's own declarations, only where no code file answers: types/index.d.ts for "../types".
    for (const declared of [`${base}.d.ts`, `${base}/index.d.ts`]) if (paths.has(declared)) return declared;
    const stripped = base.replace(/\.(js|jsx|mjs|cjs)$/, "");
    return stripped !== base ? jsFile(stripped) : null;
  };
  return (file, spec, names = []) => {
    if (file.lang === "js") return resolveJs(file, spec, jsFile, around(aliases, file.path));
    if (file.lang === "python") return resolvePython(file, spec, pythonModules, names);
    if (file.lang === "go") return resolveGo(spec, goDirs, around(goModules, file.path)[0]);
    if (file.lang === "php") return resolvePhp(spec, paths, around(psr4, file.path));
    if (file.lang === "jvm") return resolveJvm(spec, jvm);
    if (file.lang === "rust") return resolveRust(file, spec, rust);
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
// Every Python module by the dotted names it can be imported by. A project's code often runs from
// a folder below the repo's top (backend/, src/), so a module is known by the end of its dotted
// path too: two parts or more, and one alone only for a module at the top of a folder that is no
// package (no __init__.py), as a script's own folder is. The first file to claim a name keeps it.
function pythonIndex(files) {
  const modules = new Map();
  const packages = new Set(files.filter((file) => file.path.endsWith("/__init__.py")).map((file) => dirOf(file.path)));
  for (const file of files) {
    if (file.lang !== "python") continue;
    const inRepo = file.repo ? file.path.slice(file.repo.length + 1) : file.path;
    const parts = inRepo.replace(/\.py$/, "").replace(/\/__init__$/, "").split("/");
    const isTop = !packages.has(dirOf(file.path));
    for (let start = 0; start < parts.length; start += 1) {
      if (parts.length - start < 2 && !(isTop && start === parts.length - 1)) continue;
      const key = `${file.repo}|${parts.slice(start).join(".")}`;
      if (!modules.has(key)) modules.set(key, file.path);
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

// Java and Kotlin: every file by the names it can be imported by (its package with its own name, or
// with a name it defines at its top level), and the files of each package. The first file to claim
// a name keeps it. `roots` are the first three parts of the project's own packages, so an import of
// its own code that leads to no file (generated code) names no outside package, while one of the
// company whose packages the project's sit under (org.springframework.samples) still does.
function jvmIndex(files) {
  const names = new Map();
  const packages = new Map();
  const roots = new Set();
  for (const file of files) {
    if (file.lang !== "jvm" || !file.namespace) continue;
    const stem = file.path.slice(file.path.lastIndexOf("/") + 1).replace(/\.\w+$/, "");
    for (const name of [stem, ...file.defs]) if (!names.has(`${file.namespace}.${name}`)) names.set(`${file.namespace}.${name}`, file.path);
    push(packages, file.namespace, file.path);
    roots.add(file.namespace.split(".").slice(0, 3).join("."));
  }
  return { names, packages, roots: [...roots] };
}

// An import leads to the file that defines its name; a wildcard to every file of its package. A
// static import or a class inside a class leads to the file of the class it is in: the shorter
// names tried are those of classes, which start with a capital.
function resolveJvm(spec, { names, packages, roots }) {
  const name = spec.replace(/\.\*$/, "");
  if (name !== spec && packages.has(name)) return { files: packages.get(name), pkg: null };
  const parts = name.split(".");
  for (let end = parts.length; end > 1; end -= 1) {
    if (end < parts.length && !/^[A-Z]/.test(parts[end - 1])) break;
    const found = names.get(parts.slice(0, end).join("."));
    if (found) return { files: [found], pkg: null };
  }
  const isOwn = roots.some((root) => name === root || name.startsWith(`${root}.`));
  return { files: [], pkg: isOwn ? null : packageOf(spec, "jvm") };
}

// A Cargo.toml's crate: the name its code is used by (its library's name, else its package's, with
// - as _), for the files in `dir`. A workspace's own Cargo.toml names none.
export function cargoCrateOf(cargoText, dir) {
  const names = {};
  let section = "";
  for (const line of cargoText.split("\n")) {
    const header = /^\s*\[\[?\s*([\w.-]+)/.exec(line);
    if (header) section = header[1];
    const name = /^\s*name\s*=\s*["']([^"']+)["']/.exec(line)?.[1];
    if (name && (section === "package" || section === "lib")) names[section] = name;
  }
  const name = names.lib ?? names.package;
  return name ? { dir, name: name.replaceAll("-", "_") } : null;
}

// Where a Rust file's module path starts, and the path: a lib.rs, main.rs or build.rs is a crate's
// root, as is a file right in a crate's tests/, examples/, benches/ or src/bin/. Any other file is
// a module of the nearest root above it: src/a/b.rs and src/a/b/mod.rs are both a::b.
function rustModuleOf(path, crateDir, rootDirs) {
  if (/(^|\/)(lib|main|build)\.rs$/.test(path)) return { base: dirOf(path), path: [], isRoot: true };
  const own = /^(tests|examples|benches|src\/bin)\//.exec(crateDir ? path.slice(crateDir.length + 1) : path)?.[1];
  const nearest = rootDirs.filter((dir) => !dir || path.startsWith(`${dir}/`)).sort((a, b) => b.length - a.length)[0];
  const base = own ? joinPath(crateDir, own) : nearest ?? dirOf(path);
  if (dirOf(path) === base && own) return { base, path: [], isRoot: true };
  const segments = path.slice(base ? base.length + 1 : 0).replace(/\.rs$/, "").split("/");
  return { base, path: segments.at(-1) === "mod" ? segments.slice(0, -1) : segments, isRoot: false };
}

// A use path leads to the file of the deepest module it names: crate:: from the crate's root,
// self:: and super:: from the file's own module, a crate's name into that crate of the project, and
// a first name that is a module inside the file's own (as `mod scan; use scan::Progress;`) there.
// An item of a crate's root (crate::Config) leads to its root file. Any other first name is a
// crate from outside, or one of Rust's own.
function resolveRust(file, spec, { paths, crates, rootDirs }) {
  const crate = around(crates, file.path)[0];
  const here = rustModuleOf(file.path, crate?.dir ?? "", rootDirs);
  const segments = spec.replace(/^::/, "").split("::").filter((one) => one && one !== "*");
  // The file of the deepest module along `path` that is at least `least` names long.
  const moduleFile = (base, path, least = 1) => {
    for (let end = path.length; end >= least; end -= 1) {
      const at = joinPath(base, ...path.slice(0, end));
      if (paths.has(`${at}.rs`)) return `${at}.rs`;
      if (paths.has(`${at}/mod.rs`)) return `${at}/mod.rs`;
    }
    return null;
  };
  const library = (base) => [joinPath(base, "lib.rs"), joinPath(base, "main.rs")].find((one) => paths.has(one)) ?? null;
  const ownRoot = here.isRoot ? file.path : library(here.base);
  const into = (base, path, root) => ({ files: [moduleFile(base, path) ?? root].filter(Boolean), pkg: null });
  let up = 0;
  while (segments[up] === "super") up += 1;
  const [first, ...rest] = segments;
  if (first === "crate") return into(here.base, rest, ownRoot);
  if (first === "self") return into(here.base, [...here.path, ...rest], file.path);
  if (up) return into(here.base, [...here.path.slice(0, Math.max(0, here.path.length - up)), ...segments.slice(up)], ownRoot);
  const named = crates.find((one) => one.name === first);
  if (named) return into(joinPath(named.dir, "src"), rest, library(joinPath(named.dir, "src")));
  const inside = moduleFile(here.base, [...here.path, ...segments], here.path.length + 1);
  if (inside) return { files: [inside], pkg: null };
  return { files: [], pkg: packageOf(spec, "rust") };
}

function resolveGo(spec, goDirs, found) {
  const module = found?.module;
  if (module && (spec === module || spec.startsWith(`${module}/`))) {
    const dir = joinPath(found.dir, spec.slice(module.length + 1));
    return { files: goDirs.get(dir) ?? [], pkg: null };
  }
  return { files: [], pkg: packageOf(spec, "go") };
}

// JSON with comments and trailing commas made plain JSON. Comments are found outside strings only,
// so "@/*" and "**/*.ts" stay as they are.
export function withoutComments(text) {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      const end = endOfString(text, i);
      out += text.slice(i, end);
      i = end - 1;
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
    } else if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else out += char;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

// Where the string that starts at `start` (its opening quote) ends, just past its closing quote.
function endOfString(text, start) {
  for (let i = start + 1; i < text.length; i += 1) {
    if (text[i] === "\\") i += 1;
    else if (text[i] === '"') return i + 1;
  }
  return text.length;
}

// A tsconfig's paths as prefixes to try, each with the folders it stands for, for the files in
// `dir` (the tsconfig's folder). JSON with comments and trailing commas is read as TypeScript
// reads it.
export function aliasesOf(tsconfigText, dir) {
  let config;
  try {
    config = JSON.parse(withoutComments(tsconfigText));
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
// matching anything, and at least one fixed part the same. The longest such match wins, one as long
// as the request before one that is not. A request that names only part of the address (its start
// lives in settings) still finds its endpoint. Two equal matches in different files are a guess,
// so the request is left without one.
export function endpointFor(request, routes) {
  const asked = segmentsOf(request.path);
  let best = null;
  for (const route of routes) {
    if (route.file === request.file) continue;
    if (request.m !== "ANY" && route.m !== "ANY" && request.m !== route.m) continue;
    const answered = segmentsOf(route.p);
    if (!answered.length || answered.length > asked.length + 1) continue;
    const fixed = suffixScore(asked, answered);
    if (!fixed) continue;
    const score = fixed + (answered.length === asked.length ? 0.5 : 0);
    if (!best || score > best.score) best = { route, score, isTied: false };
    else if (score === best.score && route.file !== best.route.file) best.isTied = true;
  }
  return best && !best.isTied ? best.route : null;
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
