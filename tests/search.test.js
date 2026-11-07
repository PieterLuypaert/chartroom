import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readChart } from "../mods/chartroom/model.js";
import { searchChart, searchIndexOf } from "../mods/chartroom/search.js";

const chart = readChart(readFileSync(new URL("./tide-tables.json", import.meta.url), "utf8"));
const index = searchIndexOf(chart);
const find = (query) => searchChart(index, query);
const labels = (found) => found.map((one) => one.label);

describe("searchChart", () => {
  test("finds parts and files by name, those whose name starts with it first, parts before files", () => {
    expect(labels(find("server"))).toEqual(["Server", "Server connection", "Server start", "Server client"]);
  });

  test("finds an endpoint by its route, at the file that answers it", () => {
    expect(find("GET /ports")[0]).toMatchObject({ kind: "endpoint", label: "All ports", ref: "f:api/src/routes/ports.ts", focus: "api.routes", where: "Server › Requests", route: { m: "GET", p: "/ports" } });
  });

  test("places each card on the level it sits on", () => {
    const at = (query) => (({ ref, focus, where }) => ({ ref, focus, where }))(find(query)[0]);
    expect(at("requests")).toEqual({ ref: "n:api.routes", focus: "api", where: "Server" });
    expect(at("jobs")).toEqual({ ref: "n:jobs", focus: null, where: "Tide Tables" });
    expect(at("nightly")).toEqual({ ref: "f:jobs/fetch.py", focus: "jobs", where: "Jobs" });
    expect(at("warnings")).toEqual({ ref: "n:mail", focus: null, where: "Tide Tables" });
  });

  test("finds by a file's path and by what a card does", () => {
    expect(labels(find("kit/client"))).toEqual(["Server client"]);
    expect(labels(find("postgres"))).toEqual(["Database", "Database client"]);
  });

  test("needs every word of the query somewhere in a card", () => {
    expect(labels(find("spring tide"))).toEqual(["Spring tide warning", "Jobs"]);
    expect(find("tide banana")).toEqual([]);
  });

  test("finds nothing for nothing typed", () => {
    expect(find("")).toEqual([]);
    expect(find("   ")).toEqual([]);
  });

  test("lists at most twenty", () => {
    const files = Array.from({ length: 30 }, (_, at) => ({ p: `ports/port-${at}.ts`, n: "ports", name: `Port ${at}`, d: "" }));
    const many = readChart(JSON.stringify({ schema: "chartroom/chart@1", nodes: [{ id: "ports", parent: null, label: "Ports" }], files, links: [] }));
    expect(searchChart(searchIndexOf(many), "port").length).toBe(20);
  });
});
