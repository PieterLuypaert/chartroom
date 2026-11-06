// The person's own Claude, headless: `claude -p` in the project's folder, on their own login, with
// at most the tools that read (never the ones that write or run commands), and its answer checked
// against a JSON schema by Claude Code itself.

// Another claude for tests: CHARTROOM_CLAUDE names the program to run instead.
const CLAUDE = process.env.CHARTROOM_CLAUDE || "claude";
// A call that has not answered in this long is stopped.
const CALL_MS = 15 * 60 * 1000;
const running = new Set();
let isStopping = false;

// Stops every call still running, and any asked after, as the drawing does when it is stopped.
export function stopAll() {
  isStopping = true;
  for (const child of running) child.kill();
}

export async function askClaude({ cwd, prompt, schema, model = null, tools = [] }) {
  try {
    return await callOnce({ cwd, prompt, schema, model, tools });
  } catch (error) {
    if (error.isFinal) throw error;
    console.log(`chartroom: asking Claude again after: ${error.message}`);
    return callOnce({ cwd, prompt, schema, model, tools });
  }
}

async function callOnce({ cwd, prompt, schema, model, tools }) {
  if (isStopping) throw Object.assign(new Error("the drawing was stopped"), { isFinal: true });
  const args = ["-p", "--output-format", "json", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "", "--tools", tools.join(","), "--json-schema", JSON.stringify(schema)];
  if (tools.length) args.push("--allowedTools", ...tools);
  if (model) args.push("--model", model);
  const child = Bun.spawn([CLAUDE, ...args], { cwd, stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe" });
  running.add(child);
  const timer = setTimeout(() => child.kill(), CALL_MS);
  try {
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (isStopping) throw Object.assign(new Error("the drawing was stopped"), { isFinal: true });
    if (child.signalCode) throw new Error(`claude took longer than ${CALL_MS / 60000} minutes and was stopped`);
    if (code !== 0) throw new Error(`claude ended with ${code}: ${tail(err || out)}`);
    let result;
    try {
      result = JSON.parse(out);
    } catch (error) {
      throw new Error(`claude's answer was not JSON (${error.message}): ${tail(out)}`);
    }
    if (result.is_error) throw new Error(`claude could not answer: ${tail(String(result.result ?? result.subtype))}`);
    if (!result.structured_output) throw new Error("claude did not answer in the shape asked for");
    return result.structured_output;
  } finally {
    clearTimeout(timer);
    running.delete(child);
  }
}

const tail = (text) => text.trim().split("\n").slice(-3).join(" ").slice(-400);
