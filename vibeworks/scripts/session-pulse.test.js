"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { execFile, execFileSync } = require("node:child_process");

const { sessionFacts, toolKind, connectorServer, connectorCategory } = require("./session-pulse.js");

const SCRIPT = path.join(__dirname, "session-pulse.js");

function line(object) {
  return JSON.stringify(object);
}

function transcript() {
  return [
    line({ type: "user", isMeta: true, timestamp: "2026-10-18T09:00:00.000Z", message: { role: "user", content: "<local-command-caveat>" } }),
    line({ type: "user", timestamp: "2026-10-18T09:00:05.000Z", version: "2.1.300", cwd: "/work/app", message: { role: "user", content: "Add a login page" } }),
    line({ type: "assistant", timestamp: "2026-10-18T09:00:20.000Z", message: { role: "assistant", model: "claude-opus-5", content: [{ type: "text", text: "Looking." }, { type: "tool_use", name: "Read", input: {} }, { type: "tool_use", name: "Grep", input: {} }] } }),
    line({ type: "user", timestamp: "2026-10-18T09:00:21.000Z", message: { role: "user", content: [{ type: "tool_result", content: "..." }] } }),
    line({ type: "assistant", timestamp: "2026-10-18T09:03:00.000Z", message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: {} }, { type: "tool_use", name: "Bash", input: {} }, { type: "tool_use", name: "mcp__github__create_pull_request", input: {} }, { type: "tool_use", name: "mcp__plugin_acme_slack__send", input: {} }, { type: "tool_use", name: "mcp__github__get_me", input: {} }, { type: "tool_use", name: "mcp__vibeworks__hey_vibeworks", input: {} }] } }),
    line({ type: "user", timestamp: "2026-10-18T09:04:00.000Z", message: { role: "user", content: "<command-name>/commit</command-name>" } }),
    line({ type: "assistant", timestamp: "2026-10-18T09:04:30.000Z", message: { role: "assistant", content: [{ type: "tool_use", name: "Skill", input: {} }, { type: "tool_use", name: "Agent", input: {} }] } }),
    line({ type: "user", isSidechain: true, timestamp: "2026-10-18T09:04:31.000Z", message: { role: "user", content: "subagent prompt" } }),
    line({ type: "user", timestamp: "2026-10-18T09:30:00.000Z", message: { role: "user", content: [{ type: "text", text: "Now the tests" }] } }),
    line({ type: "assistant", timestamp: "2026-10-18T09:31:00.000Z", message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: {} }, { type: "tool_use", name: "AskUserQuestion", input: {} }] } }),
    line({ type: "summary", summary: "compacted", timestamp: "2026-10-18T09:31:30.000Z" }),
    "not json at all",
  ].join("\n");
}

test("reads counts, kinds and the clock off a transcript, and nothing else", () => {
  const facts = sessionFacts(transcript().split("\n"));

  assert.equal(facts.prompt_count, 2);
  assert.equal(facts.command_count, 1);
  assert.equal(facts.started_at, "2026-10-18T09:00:05.000Z");
  assert.equal(facts.last_at, "2026-10-18T09:31:30.000Z");
  assert.equal(facts.active_minutes, 5, "the 26 minute pause before the second prompt is a break, not work");
  assert.equal(facts.tool_calls, 12);
  assert.deepEqual(facts.tools, { agent: 1, connector: 4, edit: 1, other: 0, plan: 0, question: 1, read: 2, shell: 2, skill: 1, web: 0 });
  assert.deepEqual(facts.connector_kinds, { chat: 1, code: 1 }, "github once, slack once, VibeWorks itself skipped");
  assert.equal(facts.skill_count, 1);
  assert.equal(facts.subagent_count, 1);
  assert.equal(facts.compaction_count, 1);
  assert.equal(facts.model, "claude-opus-5");
  assert.equal(facts.claude_version, "2.1.300");
  assert.equal(JSON.stringify(facts).includes("login page"), false, "no prompt text leaves the machine");
});

test("a transcript with no prompt yet reports nothing", () => {
  assert.equal(sessionFacts([line({ type: "user", isMeta: true, message: { content: "x" } })]), null);
});

test("tool names fall into kinds and connector servers into categories", () => {
  assert.equal(toolKind("Write"), "edit");
  assert.equal(toolKind("WebSearch"), "web");
  assert.equal(toolKind("Task"), "agent");
  assert.equal(toolKind("SomethingNew"), "other");
  assert.equal(connectorServer("mcp__notion__search"), "notion");
  assert.equal(connectorServer("mcp__plugin_sales_hubspot__get_contact"), "hubspot");
  assert.equal(connectorCategory("notion"), "documents");
  assert.equal(connectorCategory("hubspot"), "crm");
  assert.equal(connectorCategory("google_calendar"), "calendar");
  assert.equal(connectorCategory("mystery-server"), "other");
});

test("sends the facts to VibeWorks with the token, then stays quiet until something changes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibeworks-pulse-"));
  const transcriptPath = path.join(dir, "session.jsonl");
  fs.writeFileSync(transcriptPath, transcript());

  const received = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      received.push({ url: request.url, authorization: request.headers.authorization, body: JSON.parse(body) });
      response.writeHead(204).end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  const tokenFile = path.join(dir, "token.json");
  fs.writeFileSync(tokenFile, JSON.stringify({ token: "vwcc_test", url: `${url}/` }));

  const input = JSON.stringify({ session_id: "sess-1", transcript_path: transcriptPath, cwd: dir, permission_mode: "default", hook_event_name: "Stop" });
  const run = () =>
    new Promise((resolve, reject) => {
      const child = execFile("node", [SCRIPT], { env: { ...process.env, VIBEWORKS_TOKEN_FILE: tokenFile }, encoding: "utf8" }, (error, stdout) =>
        error ? reject(error) : resolve(stdout)
      );
      child.stdin.end(input);
    });

  assert.equal(await run(), "", "a hook that prints would talk to Claude; this one never does");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(received.length, 1);
  assert.equal(received[0].url, "/webhooks/claude-code");
  assert.equal(received[0].authorization, "Bearer vwcc_test");
  assert.equal(received[0].body.session_id, "sess-1");
  assert.equal(received[0].body.prompt_count, 2);
  assert.equal(received[0].body.hook_version, 1);
  assert.equal(received[0].body.permission_mode, "default");
  assert.match(received[0].body.cwd_hash, /^[0-9a-f]{64}$/);

  await run();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(received.length, 1, "nothing changed, so nothing was sent again");

  fs.appendFileSync(transcriptPath, "\n" + line({ type: "user", timestamp: "2026-10-18T09:40:00.000Z", message: { role: "user", content: "One more" } }));
  await run();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(received.length, 2);
  assert.equal(received[1].body.prompt_count, 3);

  server.close();
});

test("without a token file nothing is read or sent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibeworks-pulse-"));
  const input = JSON.stringify({ session_id: "sess-2", transcript_path: path.join(dir, "missing.jsonl"), cwd: dir });
  const out = execFileSync("node", [SCRIPT], { input, env: { ...process.env, VIBEWORKS_TOKEN_FILE: path.join(dir, "none.json") }, encoding: "utf8" });
  assert.equal(out, "");
});
