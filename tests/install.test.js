import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A Herdr app home of its own: one layout with a tab bar, and keys the person set, one of them the
// Chartroom's old binding.
const home = realpathSync(mkdtempSync(join(tmpdir(), "chartroom-app-")));
const json = (path) => JSON.parse(readFileSync(join(home, path), "utf8"));
const put = (path, value) => {
  mkdirSync(join(home, path, ".."), { recursive: true });
  writeFileSync(join(home, path), JSON.stringify(value));
};
put("layouts/mine.json", { id: "root", type: "row", children: [{ id: "work", type: "column", children: [{ id: "tabs", type: "block", size: { px: 30 }, content: { mod: "tabs" } }] }] });
put("shared.json", { layout: "mine" });
put("installed.json", {});
put("keys.json", { global: { "cmd-alt-f": "layout.toggle:chartroom", "cmd-k": "app.palette" } });
mkdirSync(join(home, "mods"));
// A stand-in herdr-app that logs how it was run, so the install needs no Herdr app, and this
// machine's own app is left alone.
const bin = join(home, "bin");
const herdrLog = join(home, "herdr-app.log");
mkdirSync(bin);
writeFileSync(join(bin, "herdr-app"), `#!/bin/sh\necho "$@" >> "${herdrLog}"\n`);
chmodSync(join(bin, "herdr-app"), 0o755);
afterAll(() => rmSync(home, { recursive: true, force: true }));

const install = () => {
  const run = Bun.spawnSync(["sh", join(import.meta.dir, "..", "install.sh")], { env: { ...process.env, HERDR_APP_HOME: home, PATH: `${bin}:${process.env.PATH}` } });
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
};

describe("install.sh", () => {
  test("binds full size and the panel, moving the key it bound before and leaving the person's own", () => {
    expect(install()).toMatchObject({ code: 0, out: expect.stringContaining("key: cmd-alt-f does chartroom.full (it did layout.toggle:chartroom)") });
    expect(json("keys.json").global).toEqual({ "cmd-alt-f": "chartroom.full", "cmd-alt-shift-f": "layout.toggle:chartroom", "cmd-k": "app.palette" });
    expect(readFileSync(herdrLog, "utf8")).toBe(`check ${home}/mods/chartroom\n`);
  });

  test("puts the panel and the button in the layout", () => {
    const layout = JSON.stringify(json("layouts/mine.json"));
    expect(layout).toContain('"id":"chartroom"');
    expect(layout).toContain('"id":"chartroom-button"');
  });

  test("changes nothing when run again", () => {
    const before = readFileSync(join(home, "keys.json"), "utf8");
    expect(install()).toMatchObject({ code: 0, out: expect.stringContaining("key: cmd-alt-f already does chartroom.full") });
    expect(readFileSync(join(home, "keys.json"), "utf8")).toBe(before);
  });

  test("leaves a key the person bound to something else alone, and says so", () => {
    put("keys.json", { global: { "cmd-alt-f": "app.zoom_in" } });
    expect(install().err).toContain("key: cmd-alt-f does app.zoom_in; bind chartroom.full to a free key");
    expect(json("keys.json").global["cmd-alt-f"]).toBe("app.zoom_in");
  });
});

describe("install.sh on a layout an earlier install set up", () => {
  test("keeps the panel to 600 px, so a laptop keeps room for the terminals", () => {
    put("layouts/mine.json", { id: "root", type: "row", children: [{ id: "work", type: "column", children: [] }, { id: "chartroom", type: "block", hidden: true, size: { px: 900 }, min: 340, max: 960, content: { mod: "chartroom" } }] });
    expect(install().out).toContain("layout: the panel in mine is at most 600 px wide now");
    const panel = json("layouts/mine.json").children.find((one) => one.id === "chartroom");
    expect([panel.max, panel.size.px]).toEqual([600, 460]);
    expect(install().out).toContain("layout: mine has the panel already");
  });
});

// A fresh Herdr home of its own for each case below, with Herdr's own layout `main` (a tab bar in a
// row) shown, and a stand-in herdr-app that answers as an open app or a closed one: layout.clone
// writes the copy, as Herdr does.
const SHIPPED = { id: "root", type: "row", children: [{ id: "work", type: "column", children: [{ id: "tabs", type: "block", size: { px: 30 }, content: { mod: "tabs" } }] }] };
const homes = [];
afterAll(() => homes.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function freshHome({ keys = null } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "chartroom-fresh-")));
  homes.push(dir);
  const write = (path, value) => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), JSON.stringify(value));
  };
  write("app/layouts/main.json", SHIPPED);
  write("app/installed.json", { "layout:main": { json: "1" } });
  write("app/shared.json", { layout: "main" });
  if (keys) write("app/keys.json", keys);
  mkdirSync(join(dir, "app", "mods"));
  return dir;
}

function fakeHerdr(dir) {
  const log = join(dir, "herdr-app.log");
  writeFileSync(join(dir, "herdr-app"), `#!/bin/sh
echo "$@" >> "${log}"
case "$1" in
  status) [ "$FAKE_HERDR_OPEN" = 1 ] || exit 2 ;;
  do) if [ "$2" = layout.clone ]; then
        from=$(echo "$3" | jq -r .name); to=$(echo "$3" | jq -r .as)
        cp "$HERDR_APP_HOME/layouts/$from.json" "$HERDR_APP_HOME/layouts/$to.json"
      fi ;;
esac
`);
  chmodSync(join(dir, "herdr-app"), 0o755);
  return log;
}

// install.sh in a fresh home, with the stand-in on the PATH (or only in ~/.local/bin) and its log of
// this run alone. The PATH keeps only folders that hold neither a real herdr-app nor claude.
function installFresh(dir, { isOpen = true, isLocalBin = false } = {}) {
  const bare = process.env.PATH.split(":").filter((folder) => !existsSync(join(folder, "herdr-app")) && !existsSync(join(folder, "claude")));
  const bin = join(dir, isLocalBin ? "home/.local/bin" : "bin");
  mkdirSync(bin, { recursive: true });
  const log = fakeHerdr(bin);
  rmSync(log, { force: true });
  const run = Bun.spawnSync(["sh", join(import.meta.dir, "..", "install.sh")], {
    env: { ...process.env, HOME: join(dir, "home"), HERDR_APP_HOME: join(dir, "app"), FAKE_HERDR_OPEN: isOpen ? "1" : "", PATH: [...(isLocalBin ? [] : [bin]), ...bare].join(":") },
  });
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString(), log: existsSync(log) ? readFileSync(log, "utf8") : "" };
}
const appJson = (dir, path) => JSON.parse(readFileSync(join(dir, "app", path), "utf8"));

describe("install.sh in a fresh Herdr home", () => {
  test("puts the Chartroom into a copy of Herdr's own layout, made and shown while the app is open", () => {
    const dir = freshHome();
    const run = installFresh(dir);
    expect(run).toMatchObject({ code: 0, out: expect.stringContaining("the Chartroom goes into a copy, main-chart, shown now") });
    expect(run.log).toContain('do layout.clone {"name":"main","as":"main-chart"}');
    const copy = JSON.stringify(appJson(dir, "layouts/main-chart.json"));
    expect(copy).toContain('"id":"chartroom"');
    expect(copy).toContain('"id":"chartroom-button"');
    expect(appJson(dir, "layouts/main.json")).toEqual(SHIPPED);
  });

  test("shows the copy an earlier install made rather than copying again", () => {
    const dir = freshHome();
    installFresh(dir);
    const again = installFresh(dir);
    expect(again).toMatchObject({ code: 0, out: expect.stringContaining("showing main-chart, the copy an earlier install made") });
    expect(again.log).toContain('do layout.switch {"name":"main-chart"}');
    expect(again.log).not.toContain("layout.clone");
  });

  test("makes keys.json when there is none, and keeps no backup of it", () => {
    const dir = freshHome();
    const run = installFresh(dir);
    expect(appJson(dir, "keys.json").global).toEqual({ "cmd-alt-f": "chartroom.full", "cmd-alt-shift-f": "layout.toggle:chartroom" });
    expect(readdirSync(join(dir, "app")).filter((name) => name.startsWith("keys.json.backup"))).toEqual([]);
    expect(run.out).not.toContain("was kept as keys.json.backup");
  });

  test("still keeps a backup of keys.json the person had", () => {
    const dir = freshHome({ keys: { global: { "cmd-k": "app.palette" } } });
    expect(installFresh(dir).out).toContain("key: keys.json was kept as keys.json.backup-");
    expect(appJson(dir, "keys.json").global["cmd-k"]).toBe("app.palette");
  });

  test("changes nothing and says to open the app when Herdr's own layout is shown and the app is closed", () => {
    const dir = freshHome();
    const run = installFresh(dir, { isOpen: false });
    expect(run.code).toBe(1);
    expect(run.err).toContain("Open the Herdr app and run this again: it makes the copy and shows it.");
    expect(existsSync(join(dir, "app", "mods", "chartroom"))).toBe(false);
    expect(existsSync(join(dir, "app", "keys.json"))).toBe(false);
  });

  test("finds herdr-app in ~/.local/bin when the PATH lacks it, and warns when there is no claude", () => {
    const dir = freshHome();
    const run = installFresh(dir, { isLocalBin: true });
    expect(run.code).toBe(0);
    expect(run.log).toContain(`check ${join(dir, "app")}/mods/chartroom`);
    expect(run.err).toContain("install: no claude on the PATH: drawing a chart needs the Claude Code CLI, logged in");
  });
});
