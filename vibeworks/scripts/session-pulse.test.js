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

test("reads a session through the person's own Claude Code and sends only the marks", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibeworks-read-"));
  const transcriptPath = path.join(dir, "sess-9.jsonl");
  fs.writeFileSync(
    transcriptPath,
    [
      line({ type: "user", timestamp: "2026-10-18T09:00:05.000Z", message: { role: "user", content: "Draft the plan for the directors" } }),
      line({ type: "assistant", timestamp: "2026-10-18T09:00:20.000Z", message: { role: "assistant", content: [{ type: "text", text: "Here is a draft." }, { type: "tool_use", name: "Read", input: {} }] } }),
      line({ type: "user", timestamp: "2026-10-18T09:05:00.000Z", message: { role: "user", content: "Keep it under a page" } }),
      line({ type: "assistant", timestamp: "2026-10-18T09:05:30.000Z", message: { role: "assistant", content: [{ type: "text", text: "Trimmed." }] } }),
      line({ type: "user", timestamp: "2026-10-18T09:06:00.000Z", message: { role: "user", content: "Good, shipping this version" } }),
      line({ type: "assistant", timestamp: "2026-10-18T09:06:10.000Z", message: { role: "assistant", content: [{ type: "text", text: "Done." }] } }),
    ].join("\n")
  );

  const prompts = [];
  const fakeClaude = path.join(dir, "claude");
  fs.writeFileSync(
    fakeClaude,
    "#!/usr/bin/env node\n" +
      "const fs = require('node:fs');\n" +
      `fs.writeFileSync(${JSON.stringify(path.join(dir, "prompt.txt"))}, fs.readFileSync(0, 'utf8'));\n` +
      "const answer = { gate: { task: true, opportunity_to_react: true, checkable_output: false, fix_made: false }, indicators: [{ id: 'D1', observed: true, evidence: 'named the plan for the directors' }], executor_kind: 'none', tags: {}, model_dimension_scores: {}, read_confidence: 0.8, standout: 'Named the reader first.' };\n" +
      "process.stdout.write(JSON.stringify({ type: 'result', result: '```json\\n' + JSON.stringify(answer) + '\\n```' }));\n"
  );
  fs.chmodSync(fakeClaude, 0o755);

  const received = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      received.push({ url: request.url, authorization: request.headers.authorization, body: body && JSON.parse(body) });
      if (request.url === "/webhooks/claude-code/read-instructions") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ read_instructions: "Mark the indicators.", read_schema: {}, user_template: "<conversation_to_analyze source=\"{{SOURCE}}\">\n{{CONVERSATION}}\n</conversation_to_analyze>" }));
      } else {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ accepted: 1, dropped: {} }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const tokenFile = path.join(dir, "token.json");
  fs.writeFileSync(tokenFile, JSON.stringify({ token: "vwcc_test", url, reads: true }));

  await new Promise((resolve, reject) => {
    execFile(
      "node",
      [SCRIPT, "--read-now", "sess-9", transcriptPath],
      { env: { ...process.env, VIBEWORKS_TOKEN_FILE: tokenFile, VIBEWORKS_CLAUDE_BIN: fakeClaude }, encoding: "utf8" },
      (error) => (error ? reject(error) : resolve())
    );
  });

  const prompt = fs.readFileSync(path.join(dir, "prompt.txt"), "utf8");
  assert.match(prompt, /^Mark the indicators\./);
  assert.match(prompt, /User: Draft the plan for the directors/);
  assert.match(prompt, /Assistant: Here is a draft\.\n\[used tools: read\]/);
  assert.match(prompt, /source="Claude Code"/);

  assert.deepEqual(received.map((call) => call.url), ["/webhooks/claude-code/read-instructions", "/webhooks/claude-code/reads"]);
  const sent = received[1].body;
  assert.equal(received[1].authorization, "Bearer vwcc_test");
  assert.equal(sent.session_id, "sess-9");
  assert.equal(sent.read.conversation_id, "sess-9");
  assert.equal(sent.read.evidence_source, "full_transcript");
  assert.equal(sent.read.date_basis, "started");
  assert.equal(sent.read.started_at, "2026-10-18T09:00:05.000Z");
  assert.equal(sent.read.tool_calls, 1);
  assert.equal(sent.read.standout, "Named the reader first.");
  assert.equal(sent.read.indicators[0].id, "D1");
  assert.ok(!JSON.stringify(sent).includes("Draft the plan"), "no conversation text reaches VibeWorks");
  assert.ok(fs.existsSync(path.join(dir, "reads", "sess-9.json")), "a session read once is stamped and never reread");

  received.length = 0;
  await new Promise((resolve, reject) => {
    execFile("node", [SCRIPT, "--read-now", "sess-9", transcriptPath], { env: { ...process.env, VIBEWORKS_TOKEN_FILE: tokenFile, VIBEWORKS_CLAUDE_BIN: fakeClaude } }, (error) => (error ? reject(error) : resolve()));
  });
  assert.equal(received.length, 0);

  server.close();
});

test("a session with fewer than three prompts, or a read session itself, is never read", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibeworks-read-"));
  const short = path.join(dir, "short.jsonl");
  fs.writeFileSync(short, line({ type: "user", timestamp: "2026-10-18T09:00:05.000Z", message: { role: "user", content: "hi" } }));
  const nested = path.join(dir, "nested.jsonl");
  fs.writeFileSync(
    nested,
    [1, 2, 3].map((n) => line({ type: "user", timestamp: `2026-10-18T09:0${n}:00.000Z`, message: { role: "user", content: n === 1 ? "Mark these. <conversation_to_analyze source=\"x\">" : "more" } })).join("\n")
  );
  const tokenFile = path.join(dir, "token.json");
  fs.writeFileSync(tokenFile, JSON.stringify({ token: "vwcc_test", url: "http://127.0.0.1:9", reads: true }));
  const { readLink, readSession } = require("./session-pulse.js");
  process.env.VIBEWORKS_TOKEN_FILE = tokenFile;
  const link = readLink();
  assert.equal(await readSession(link, "short", short), true, "too short to read, and never retried");
  assert.equal(await readSession(link, "nested", nested), true, "a read session is not evidence of the person's work");
  delete process.env.VIBEWORKS_TOKEN_FILE;
});

test("with reads on, the first reply starts the month-back catch-up on its own, and only once", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibeworks-catchup-"));
  const configDir = path.join(dir, "config");
  const projectDir = path.join(configDir, "projects", "-work-app");
  fs.mkdirSync(projectDir, { recursive: true });
  const older = path.join(projectDir, "older-session.jsonl");
  fs.writeFileSync(
    older,
    [
      line({ type: "user", timestamp: "2026-10-10T09:00:00.000Z", message: { role: "user", content: "Plan the page" } }),
      line({ type: "assistant", timestamp: "2026-10-10T09:01:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "Done." }] } }),
      line({ type: "user", timestamp: "2026-10-10T09:02:00.000Z", message: { role: "user", content: "Now the form" } }),
      line({ type: "assistant", timestamp: "2026-10-10T09:03:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "Done." }] } }),
      line({ type: "user", timestamp: "2026-10-10T09:04:00.000Z", message: { role: "user", content: "Ship it" } }),
      line({ type: "assistant", timestamp: "2026-10-10T09:05:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "Done." }] } }),
    ].join("\n")
  );
  const transcriptPath = path.join(dir, "current.jsonl");
  fs.writeFileSync(transcriptPath, transcript());

  const asked = [];
  const server = http.createServer((request, response) => {
    asked.push(request.url);
    request.resume();
    request.on("end", () => response.writeHead(request.url.endsWith("/read-instructions") ? 403 : 204).end());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  const tokenFile = path.join(dir, "token.json");
  fs.writeFileSync(tokenFile, JSON.stringify({ reads: true, token: "vwcc_test", url }));

  const input = JSON.stringify({ session_id: "sess-now", transcript_path: transcriptPath, cwd: dir, hook_event_name: "Stop" });
  const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir, VIBEWORKS_TOKEN_FILE: tokenFile };
  const run = () =>
    new Promise((resolve, reject) => {
      const child = execFile("node", [SCRIPT], { env, encoding: "utf8" }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
      child.stdin.end(input);
    });

  await run();
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.ok(fs.existsSync(path.join(dir, "backfill-started.json")), "the catch-up records that it started");
  assert.equal(
    asked.filter((url) => url === "/webhooks/claude-code/read-instructions").length,
    1,
    "the plugin starts the catch-up from its own folder; a command Claude runs from chat cannot find it"
  );

  await run();
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(asked.filter((url) => url === "/webhooks/claude-code/read-instructions").length, 1, "the catch-up runs once");

  server.close();
});

test("the backfill lists only session files from the last month", () => {
  const { sessionFiles } = require("./backfill-reads.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibeworks-backfill-"));
  fs.mkdirSync(path.join(dir, "-work-app"));
  fs.mkdirSync(path.join(dir, "-work-app", "subagents"));
  const fresh = path.join(dir, "-work-app", "fresh.jsonl");
  const stale = path.join(dir, "-work-app", "stale.jsonl");
  fs.writeFileSync(fresh, "");
  fs.writeFileSync(stale, "");
  fs.writeFileSync(path.join(dir, "-work-app", "notes.txt"), "");
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  fs.utimesSync(stale, old, old);
  assert.deepEqual(sessionFiles(dir, Date.now() - 30 * 24 * 60 * 60 * 1000), [fresh]);
});
