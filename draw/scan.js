// Reads a project: its repos (the folder's own, or the repos side by side in it), every code file
// git knows in them, and what each file imports, defines, answers and asks for. Mechanical work,
// with no Claude in it.
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { extract, langOf } from "./extract.js";
import { aliasesOf, cargoCrateOf, endpointFor, goModuleOf, psr4Of, resolverFor } from "./resolve.js";

// Folders whose files are installed, built or charted, never written: left out even where git
// keeps them. In a folder git does not know, the usual build and cache folders are left out too.
const SKIPPED = new Set(["node_modules", "vendor", "dist", ".next", ".nuxt", ".svelte-kit", "__pycache__", ".chartroom", ".git"]);
const SKIPPED_WITHOUT_GIT = new Set(["build", "out", "target", "coverage", ".turbo", ".cache", ".venv", "venv"]);
const READ_AT_ONCE = 64;

async function git(dir, args) {
  const run = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
  return { ok: code === 0, out: out.trim(), err: err.trim() };
}

const isSkipped = (path, isPlain) => path.split("/").some((part) => SKIPPED.has(part) || (isPlain && SKIPPED_WITHOUT_GIT.has(part))) || /\.(min\.js|d\.ts|map)$/.test(path) || /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(path);

// The repos to read: the one the folder is in (only the part under the folder), else each repo in
// a folder up to two levels down. A folder with neither is read as plain files.
async function reposOf(root) {
  const top = await git(root, ["rev-parse", "--show-toplevel"]);
  if (top.ok) return [{ path: "", dir: root }];
  const repos = [];
  for (const one of await readdir(root, { withFileTypes: true })) {
    if (!one.isDirectory() || SKIPPED.has(one.name)) continue;
    const dir = join(root, one.name);
    if (await isRepo(dir)) repos.push({ path: one.name, dir });
    else for (const two of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (two.isDirectory() && !SKIPPED.has(two.name) && (await isRepo(join(dir, two.name)))) repos.push({ path: `${one.name}/${two.name}`, dir: join(dir, two.name) });
    }
  }
  return repos.length ? repos : [{ path: "", dir: root, isPlain: true }];
}

const isRepo = (dir) => stat(join(dir, ".git")).then(() => true, () => false);

// Every path in a repo that git tracks or would track, relative to the repo's folder.
async function pathsIn(repo) {
  if (repo.isPlain) return walk(repo.dir, "");
  const listed = await git(repo.dir, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  if (!listed.ok) throw new Error(`git could not list the files in ${repo.dir}: ${listed.err}`);
  return [...new Set(listed.out.split("\0").filter(Boolean))];
}

async function walk(dir, prefix) {
  const out = [];
  for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
    if (SKIPPED.has(entry.name) || SKIPPED_WITHOUT_GIT.has(entry.name) || entry.name.startsWith(".")) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(dir, path)));
    else out.push(path);
  }
  return out;
}

// A file's text, however big; null for what is not a file, or not text.
async function readText(path) {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return null;
  const text = await readFile(path, "utf8");
  return text.includes("\0") ? null : text;
}

async function inBatches(items, work) {
  const out = [];
  for (let start = 0; start < items.length; start += READ_AT_ONCE) out.push(...(await Promise.all(items.slice(start, start + READ_AT_ONCE).map(work))));
  return out;
}

// The project read: its repos, its code files with what each says, the endpoints, and the links
// between files (imports, and requests matched to the endpoint that answers them), plus the
// packages and outside hosts each file uses. `onFile` hears how far reading has got.
export async function scan(folder, { onFile = () => {} } = {}) {
  const root = await realpath(folder);
  const repos = await reposOf(root);
  const listed = [];
  const configs = [];
  for (const repo of repos) {
    for (const path of await pathsIn(repo)) {
      const full = repo.path ? `${repo.path}/${path}` : path;
      if (isSkipped(full, repo.isPlain)) continue;
      if (/(^|\/)((tsconfig[\w.-]*|jsconfig|composer)\.json|go\.mod|Cargo\.toml)$/.test(full)) configs.push(full);
      else if (langOf(full)) listed.push({ path: full, repo: repo.path });
    }
  }
  listed.sort((a, b) => a.path.localeCompare(b.path));
  let read = 0;
  const files = (await inBatches(listed, async (file) => {
    // A file that cannot be read (gone since git listed it, or not ours to read) is left out alone.
    const text = await readText(join(root, file.path)).catch((error) => {
      console.log(`chartroom: ${file.path} was left out: ${error.message}`);
      return null;
    });
    onFile(++read, listed.length);
    if (text === null) return null;
    return { ...file, ...extract(file.path, text), loc: text.split("\n").length, hash: Bun.hash(text).toString(16) };
  })).filter(Boolean);
  const resolve = resolverFor(files, await configsOf(root, configs));
  return { root, name: basename(root), repos: await repoFacts(repos), ...connect(files, resolve) };
}

async function configsOf(root, paths) {
  const aliases = [];
  const goModules = [];
  const psr4 = [];
  const crates = [];
  for (const path of paths) {
    const text = await readText(join(root, path));
    if (text === null) continue;
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (path.endsWith("go.mod")) {
      const module = goModuleOf(text, dir);
      if (module) goModules.push(module);
    } else if (path.endsWith("composer.json")) psr4.push(...psr4Of(text, dir));
    else if (path.endsWith("Cargo.toml")) {
      const crate = cargoCrateOf(text, dir);
      if (crate) crates.push(crate);
    } else aliases.push(...aliasesOf(text, dir));
  }
  return { aliases, goModules, psr4, crates };
}

async function repoFacts(repos) {
  return Promise.all(repos.map(async (repo) => {
    if (repo.isPlain) return { path: repo.path, name: basename(repo.dir), branch: null, head: null };
    const [branch, head] = await Promise.all([git(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"]), git(repo.dir, ["rev-parse", "HEAD"])]);
    return { path: repo.path, name: basename(repo.dir), branch: branch.ok ? branch.out : null, head: head.ok ? head.out : null };
  }));
}

const joinUrl = (...parts) => `/${parts.join("/").split("/").filter(Boolean).join("/")}`;

// Where each file's routes are mounted: the path a router is mounted at in the file that imports
// it, after the path that file is mounted at itself, followed a few files deep.
function prefixesOf(files, resolve) {
  const mounted = [];
  for (const file of files) {
    for (const mount of file.mounts ?? []) {
      const imported = file.imports.find((one) => one.names.includes(mount.name));
      if (!imported) continue;
      for (const to of resolve(file, imported.spec, imported.names).files) if (to !== file.path) mounted.push({ from: file.path, to, prefix: mount.prefix });
    }
  }
  const prefixOf = new Map();
  for (let depth = 0; depth < 5; depth += 1) for (const one of mounted) prefixOf.set(one.to, joinUrl(prefixOf.get(one.from) ?? "", one.prefix));
  return prefixOf;
}

// The files with their imports resolved, the endpoints, and the links: one per pair of files and
// kind, with how many imports or requests it stands for.
export function connect(files, resolve) {
  const links = new Map();
  const link = (a, b, kind, label) => {
    if (a === b) return;
    const key = `${a}>${b}>${kind}`;
    const one = links.get(key) ?? { a, b, k: kind, w: 0, labels: [] };
    one.w += 1;
    if (label && !one.labels.includes(label)) one.labels.push(label);
    links.set(key, one);
  };
  const prefixOf = prefixesOf(files, resolve);
  const routes = files.flatMap((file) => file.routes.map((route) => ({ ...route, p: joinUrl(prefixOf.get(file.path) ?? "", file.prefix ?? "", route.p), file: file.path })));
  const out = files.map((file) => {
    const packages = new Set();
    for (const { spec, names } of file.imports) {
      const found = resolve(file, spec, names);
      for (const to of found.files) link(file.path, to, "import", names.slice(0, 4).join(", "));
      if (found.pkg) packages.add(found.pkg);
    }
    const hosts = new Set();
    for (const request of file.requests) {
      if (request.host && !/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(request.host)) hosts.add(request.host);
      if (request.host && request.path === "/") continue;
      const route = request.host && !/^(localhost|127\.0\.0\.1)$/.test(request.host) ? null : endpointFor({ ...request, file: file.path }, routes);
      if (route) link(file.path, route.file, "http", `${route.m === "ANY" ? request.m : route.m} ${route.p}`);
    }
    const { imports, requests, mounts, prefix, ...kept } = file;
    return { ...kept, packages: [...packages], hosts: [...hosts], requestCount: requests.length };
  });
  return { files: out, routes, links: [...links.values()] };
}
