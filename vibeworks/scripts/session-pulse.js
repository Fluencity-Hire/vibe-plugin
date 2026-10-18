#!/usr/bin/env node
// Reads this session's transcript file and sends VibeWorks its counts and
// timings. Never the text. Runs after every reply; exits quietly whenever
// anything is missing, so it can never get in the way of a session.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const HOOK_VERSION = 1;
const IDLE_SECONDS = 600;
const SEND_TIMEOUT_MS = 5000;

const CONNECTOR_KINDS = {
  analytics: ["amplitude", "mixpanel", "pendo", "posthog", "similarweb", "ga4", "google-analytics"],
  automation: ["zapier", "n8n", "make", "workato"],
  calendar: ["calendar", "google-calendar", "calendly", "outlook-calendar"],
  chat: ["slack", "discord", "teams", "microsoft-teams", "telegram"],
  code: ["github", "gitlab", "bitbucket", "git", "sentry", "vercel", "netlify", "circleci"],
  crm: ["salesforce", "hubspot", "close", "pipedrive", "attio", "apollo", "zoominfo", "clay", "outreach", "gong"],
  data: ["postgres", "postgresql", "mysql", "sqlite", "bigquery", "snowflake", "supabase", "redshift", "databricks", "hex", "definite"],
  design: ["figma", "canva", "sketch"],
  documents: ["notion", "confluence", "google-drive", "gdrive", "drive", "docs", "google-docs", "dropbox", "box", "coda", "claude-docs"],
  email: ["gmail", "outlook", "email", "mail", "front"],
  finance: ["stripe", "quickbooks", "xero", "brex", "ramp"],
  hr: ["workday", "rippling", "gusto", "bamboohr", "lattice", "greenhouse", "lever", "ashby"],
  knowledge: ["wiki", "guru", "glean", "readme"],
  marketing: ["mailchimp", "klaviyo", "customer-io", "intercom", "segment"],
  meetings: ["zoom", "granola", "otter", "fireflies", "gong-meetings", "fathom", "tldv"],
  project_management: ["linear", "jira", "asana", "monday", "clickup", "shortcut", "trello", "basecamp", "height", "groveros"],
  search: ["brave", "exa", "perplexity", "tavily", "serp"],
  storage: ["s3", "gcs", "azure-blob", "r2"],
  support: ["zendesk", "freshdesk", "helpscout", "front-support"],
};

const SKIPPED_SERVERS = ["vibeworks", "fluencity"];

function main() {
  let input = {};
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch (_error) {
    input = {};
  }

  const link = readLink();
  if (!link || !input.transcript_path || !input.session_id) return;

  let lines;
  try {
    lines = fs.readFileSync(input.transcript_path, "utf8").split("\n");
  } catch (_error) {
    return;
  }

  const facts = sessionFacts(lines);
  if (!facts) return;

  const pulse = {
    ...facts,
    hook_version: HOOK_VERSION,
    session_id: String(input.session_id),
    permission_mode: input.permission_mode ? String(input.permission_mode) : null,
    cwd_hash: input.cwd ? sha256(String(input.cwd)) : null,
    repository: input.cwd ? repositoryName(String(input.cwd)) : null,
  };

  if (!changedSinceLastSend(link.stampDir, pulse)) return;

  send(link, pulse).then(
    () => rememberSend(link.stampDir, pulse),
    () => {}
  );
}

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

function readLink() {
  const file = process.env.VIBEWORKS_TOKEN_FILE || path.join(configDir(), "vibeworks", "token.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof parsed.token !== "string" || typeof parsed.url !== "string") return null;
    return { token: parsed.token, url: parsed.url.replace(/\/+$/, ""), stampDir: path.join(path.dirname(file), "pulses") };
  } catch (_error) {
    return null;
  }
}

function sessionFacts(lines) {
  const prompts = [];
  const tools = { agent: 0, connector: 0, edit: 0, other: 0, plan: 0, question: 0, read: 0, shell: 0, skill: 0, web: 0 };
  const connectorKinds = {};
  const connectorServers = new Set();
  let commandCount = 0;
  let compactionCount = 0;
  let model = null;
  let claudeVersion = null;
  let lastTimestamp = null;

  for (const raw of lines) {
    if (!raw.trim()) continue;
    let line;
    try {
      line = JSON.parse(raw);
    } catch (_error) {
      continue;
    }

    const at = parseTime(line.timestamp);
    if (at) lastTimestamp = at;
    if (typeof line.version === "string" && !claudeVersion) claudeVersion = line.version;
    if (line.isCompactSummary === true || line.type === "summary") compactionCount += 1;
    if (line.isSidechain === true) continue;

    if (line.type === "user" && line.isMeta !== true) {
      const content = line.message && line.message.content;
      const text = promptText(content);
      if (text === null) continue;
      if (text.includes("<command-name>")) commandCount += 1;
      if (text.startsWith("<")) continue;
      prompts.push({ at, until: at });
      continue;
    }

    if (line.type === "assistant") {
      const message = line.message || {};
      if (typeof message.model === "string" && !model) model = message.model;
      if (prompts.length > 0 && at) prompts[prompts.length - 1].until = at;
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (!block || block.type !== "tool_use" || typeof block.name !== "string") continue;
        const kind = toolKind(block.name);
        tools[kind] += 1;
        if (kind === "connector") {
          const server = connectorServer(block.name);
          if (server && !SKIPPED_SERVERS.includes(server) && !connectorServers.has(server)) {
            connectorServers.add(server);
            const category = connectorCategory(server);
            connectorKinds[category] = (connectorKinds[category] || 0) + 1;
          }
        }
      }
    }
  }

  const dated = prompts.filter((prompt) => prompt.at);
  if (dated.length === 0) return null;

  const toolCalls = Object.values(tools).reduce((sum, count) => sum + count, 0);
  const clock = activeClock(dated);

  return {
    started_at: dated[0].at.toISOString(),
    last_at: (lastTimestamp || clock.endedAt).toISOString(),
    prompt_count: prompts.length,
    command_count: commandCount,
    active_minutes: clock.activeMinutes,
    tool_calls: toolCalls,
    tools,
    connector_kinds: connectorKinds,
    skill_count: tools.skill,
    subagent_count: tools.agent,
    compaction_count: compactionCount,
    model,
    claude_version: claudeVersion,
  };
}

// A prompt the person typed: a plain string, or a text block with no tool
// result beside it. Anything else is Claude Code talking to itself.
function promptText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  if (content.some((block) => block && block.type === "tool_result")) return null;
  const text = content.find((block) => block && block.type === "text" && typeof block.text === "string");
  return text ? text.text : null;
}

function toolKind(name) {
  if (name.startsWith("mcp__")) return "connector";
  switch (name) {
    case "Read":
    case "Glob":
    case "Grep":
    case "LS":
      return "read";
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookEdit":
      return "edit";
    case "Bash":
    case "BashOutput":
    case "KillShell":
    case "Monitor":
      return "shell";
    case "WebFetch":
    case "WebSearch":
      return "web";
    case "Skill":
      return "skill";
    case "Agent":
    case "Task":
      return "agent";
    case "AskUserQuestion":
      return "question";
    case "EnterPlanMode":
    case "ExitPlanMode":
    case "TodoWrite":
    case "TaskCreate":
    case "TaskUpdate":
      return "plan";
    default:
      return "other";
  }
}

// mcp__<server>__<tool>, or mcp__plugin_<plugin>_<server>__<tool> for a
// plugin-bundled server. Only the server name is read, and only to pick a
// kind; the name never leaves the machine.
function connectorServer(name) {
  const match = /^mcp__(.+?)__/.exec(name);
  if (!match) return null;
  let server = match[1].toLowerCase();
  if (server.startsWith("plugin_")) {
    const parts = server.slice("plugin_".length).split("_");
    server = parts[parts.length - 1];
  }
  return server;
}

function connectorCategory(server) {
  const normalized = server.replace(/_/g, "-");
  for (const [category, names] of Object.entries(CONNECTOR_KINDS)) {
    if (names.some((known) => normalized === known || normalized.startsWith(known + "-") || normalized.endsWith("-" + known))) {
      return category;
    }
  }
  return "other";
}

// Active time is Claude replying plus the short pauses between replies; a
// pause longer than ten minutes is a break, not work. Same rule VibeWorks
// applies to build stories.
function activeClock(prompts) {
  let seconds = 0;
  let cursor = prompts[0].at;
  for (const { at, until } of prompts) {
    const pause = (at - cursor) / 1000;
    if (pause > 0 && pause <= IDLE_SECONDS) seconds += pause;
    const started = cursor > at ? cursor : at;
    const worked = Math.max((until - started) / 1000, 0);
    seconds += worked;
    if (until > cursor) cursor = until;
  }
  return { activeMinutes: Math.round(seconds / 60), endedAt: cursor };
}

function parseTime(value) {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function repositoryName(cwd) {
  try {
    const url = execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const match = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
    return match ? `${match[1]}/${match[2]}` : null;
  } catch (_error) {
    return null;
  }
}

function stampPath(stampDir, pulse) {
  return path.join(stampDir, `${pulse.session_id.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
}

function changedSinceLastSend(stampDir, pulse) {
  try {
    const last = JSON.parse(fs.readFileSync(stampPath(stampDir, pulse), "utf8"));
    return !(last.prompt_count === pulse.prompt_count && last.tool_calls === pulse.tool_calls && last.last_at === pulse.last_at);
  } catch (_error) {
    return true;
  }
}

function rememberSend(stampDir, pulse) {
  try {
    fs.mkdirSync(stampDir, { recursive: true });
    fs.writeFileSync(
      stampPath(stampDir, pulse),
      JSON.stringify({ last_at: pulse.last_at, prompt_count: pulse.prompt_count, tool_calls: pulse.tool_calls })
    );
  } catch (_error) {
    // A missing stamp only means one extra send next time.
  }
}

async function send(link, pulse) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await fetch(`${link.url}/webhooks/claude-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${link.token}` },
      body: JSON.stringify(pulse),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`VibeWorks answered ${response.status}`);
  } finally {
    clearTimeout(timer);
  }
}

if (require.main === module) {
  main();
}

module.exports = { sessionFacts, toolKind, connectorServer, connectorCategory, activeClock };
