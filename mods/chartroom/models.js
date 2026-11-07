// The Claude models a question can be asked on, as the ask bar lists them and draw/ask.js checks
// them: Default is the person's own Claude Code default (no --model); Opus for a hard question and
// Sonnet for a quick one are the claude CLI's aliases for the latest of each. Fable runs too long
// and Haiku reads code too thinly for a question asked while the person waits. Plain data and
// functions, so bun tests them without the app, and ask.js reads them as model.js and find.js are
// read.

export const MODELS = [
  { id: null, label: "Default" },
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
];

// Whether a question may be asked on this model: one listed, or a model's full name
// ("claude-opus-5-5").
export const isModelName = (name) => name === null || MODELS.some((one) => one.id === name) || /^claude-[a-z0-9][a-z0-9.-]*$/.test(name ?? "");

// The word an answer shows for the model it was asked on.
export const modelLabel = (name) => MODELS.find((one) => one.id === (name ?? null))?.label ?? name;
