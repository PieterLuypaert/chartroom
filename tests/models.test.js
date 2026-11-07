import { describe, expect, test } from "bun:test";
import { isModelName, MODELS, modelLabel } from "../mods/chartroom/models.js";

describe("models", () => {
  test("lists the person's default first, then the Opus and the Sonnet versions, newest first", () => {
    expect(MODELS.map((one) => one.label)).toEqual(["Default", "Opus 5.5", "Opus 5", "Opus 4.8", "Sonnet 5.5", "Sonnet 5", "Sonnet 4.6"]);
    expect(MODELS[0].id).toBeNull();
  });

  test("takes a listed model, a model's full name, or none, and nothing else", () => {
    for (const name of [null, "claude-opus-5-5", "claude-sonnet-4-6"]) expect(isModelName(name)).toBe(true);
    for (const name of ["opus", "sonnet", "fable", "haiku", "gpt-9", "", "Opus", "claude-", "opus; rm -rf /", 5, undefined]) expect(isModelName(name)).toBe(false);
  });

  test("words a model as the list does, an alias with a capital, and any other name as it is", () => {
    expect([modelLabel(null), modelLabel("claude-opus-5-5"), modelLabel("sonnet"), modelLabel("claude-haiku-5-5")]).toEqual(["Default", "Opus 5.5", "Sonnet", "claude-haiku-5-5"]);
  });
});
