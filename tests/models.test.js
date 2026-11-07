import { describe, expect, test } from "bun:test";
import { isModelName, MODELS, modelLabel } from "../mods/chartroom/models.js";

describe("models", () => {
  test("lists the person's default first, then the claude CLI's aliases", () => {
    expect(MODELS.map((one) => one.label)).toEqual(["Default", "Fable", "Opus", "Sonnet", "Haiku"]);
    expect(MODELS[0].id).toBeNull();
  });

  test("takes a listed model, a model's full name, or none, and nothing else", () => {
    for (const name of [null, "fable", "opus", "sonnet", "haiku", "claude-opus-5-5"]) expect(isModelName(name)).toBe(true);
    for (const name of ["gpt-9", "", "Opus", "claude-", "opus; rm -rf /", 5, undefined]) expect(isModelName(name)).toBe(false);
  });

  test("words an answer's model as the list does, and a full name as it is", () => {
    expect([modelLabel(null), modelLabel("opus"), modelLabel("claude-opus-5-5")]).toEqual(["Default", "Opus", "claude-opus-5-5"]);
  });
});
