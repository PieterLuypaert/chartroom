// A stand-in for `claude -p` in the drawer's tests: it answers in the shape of the JSON schema it is
// given, from what the prompt lists, and logs what it was asked to FAKE_CLAUDE_LOG.
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const schema = JSON.parse(args[args.indexOf("--json-schema") + 1]);
const prompt = await new Response(Bun.stdin.stream()).text();
const log = (line) => process.env.FAKE_CLAUDE_LOG && appendFileSync(process.env.FAKE_CLAUDE_LOG, `${line}\n`);

if (process.env.FAKE_CLAUDE_FAIL) {
  console.error("Not logged in");
  process.exit(1);
}

function parts() {
  log("parts");
  const tops = [...prompt.matchAll(/^(\w[\w-]*)\/ {2}\d+ files/gm)].map((m) => m[1]);
  return {
    project: { name: "Tide Tables", summary: "Tides for every port." },
    parts: tops.map((top) => ({ id: top, parent: null, label: `The ${top}`, kind: top === "web" ? "ui" : "service", summary: `Everything in ${top}.`, paths: [`${top}/**`] })),
    outside: prompt.includes("stripe (") ? [{ id: "stripe", label: "Stripe", summary: "Card payments.", packages: ["stripe"], hosts: [] }] : [],
    links: [],
  };
}

function described() {
  const files = [...prompt.matchAll(/^FILE (\S+) \(/gm)].map((m) => m[1]);
  const endpoints = [...prompt.matchAll(/^ {2}ENDPOINT (.+)$/gm)].map((m) => m[1]);
  log(`describe ${files.join(" ")}`);
  return {
    files: files.map((path) => ({ path, name: `Named ${path.split("/").pop()}`, description: `What ${path} does.` })),
    endpoints: endpoints.map((key) => ({ key, name: `Asks ${key.split(" ")[1]}`, description: "Answers a question." })),
  };
}

// A question: an answer naming the first two cards listed, and one the chart does not have. The log
// says which model it was asked on ("default" with no --model).
function answered() {
  const cards = [...prompt.matchAll(/^CARD (\S+)/gm)].map((m) => m[1]);
  const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "default";
  log(`ask ${/^Question: (.*)$/m.exec(prompt)?.[1] ?? ""} [on ${model}]`);
  return { answer: `  It is about ${cards.slice(0, 2).join(" and ")}.  `, cards: [...cards.slice(0, 2), "n:not-on-the-chart"] };
}

const answer = schema.properties.parts ? parts() : schema.properties.answer ? answered() : described();
console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: JSON.stringify(answer), structured_output: answer }));
