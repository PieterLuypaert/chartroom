// The Claude models a question can be asked on, as the ask bar lists them and draw/ask.js checks
// them: Default is the person's own Claude Code default (no --model); then the Opus versions for a
// hard question and the Sonnet versions for a quick one, newest first, each by its full name so a
// question runs on exactly that version. Fable runs too long and Haiku reads code too thinly for a
// question asked while the person waits. Plain data and functions, so bun tests them without the
// app, and ask.js reads them as model.js and find.js are read.

export const MODELS = [
  { id: null, label: "Default" },
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
];

// Whether a question may be asked on this model: one listed, or a model's full name
// ("claude-opus-5-5").
export const isModelName = (name) => name === null || MODELS.some((one) => one.id === name) || /^claude-[a-z0-9][a-z0-9.-]*$/.test(name ?? "");

// The word an answer or an explanation shows for the model it was asked on: as the list words it,
// a claude CLI alias with a capital ("sonnet", the latest Sonnet, as Sonnet), else the name itself.
export const modelLabel = (name) => MODELS.find((one) => one.id === (name ?? null))?.label ?? (/^[a-z]+$/.test(name) ? name[0].toUpperCase() + name.slice(1) : name);
