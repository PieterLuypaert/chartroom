import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
afterAll(() => rmSync(home, { recursive: true, force: true }));

const install = () => {
  const run = Bun.spawnSync(["sh", join(import.meta.dir, "..", "install.sh")], { env: { ...process.env, HERDR_APP_HOME: home } });
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
};

describe("install.sh", () => {
  test("binds full size and the panel, moving the key it bound before and leaving the person's own", () => {
    expect(install()).toMatchObject({ code: 0, out: expect.stringContaining("key: cmd-alt-f does chartroom.full (it did layout.toggle:chartroom)") });
    expect(json("keys.json").global).toEqual({ "cmd-alt-f": "chartroom.full", "cmd-alt-shift-f": "layout.toggle:chartroom", "cmd-k": "app.palette" });
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
