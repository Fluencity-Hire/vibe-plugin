#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCREEN_CAP = 8;
const BYTES_CAP = 2_000_000;
const TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

function readLink() {
  const file = process.env.VIBEWORKS_TOKEN_FILE || path.join(configDir(), "vibeworks", "token.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof parsed.token !== "string" || typeof parsed.url !== "string") return null;
    return { token: parsed.token, url: parsed.url.replace(/\/+$/, "") };
  } catch {
    return null;
  }
}

function readScreens(dir) {
  const listing = path.join(dir, "screens.json");
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(listing, "utf8"));
  } catch {
    throw new Error(`No readable screens.json in ${dir}`);
  }
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("screens.json must list at least one screen");
  if (entries.length > SCREEN_CAP) throw new Error(`At most ${SCREEN_CAP} screens per send; screens.json lists ${entries.length}`);

  return entries.map((entry, index) => {
    if (!entry || typeof entry.file !== "string") throw new Error(`Screen ${index + 1} names no file`);
    const file = path.resolve(dir, entry.file);
    if (!file.startsWith(path.resolve(dir) + path.sep)) throw new Error(`Screen ${index + 1} points outside the folder`);
    const type = TYPES[path.extname(file).toLowerCase()];
    if (!type) throw new Error(`${entry.file} is not a PNG, JPG or WebP`);
    let bytes;
    try {
      bytes = fs.readFileSync(file);
    } catch {
      throw new Error(`${entry.file} is missing`);
    }
    if (bytes.length > BYTES_CAP) throw new Error(`${entry.file} is over 2 MB`);
    return {
      bytes,
      caption: typeof entry.caption === "string" ? entry.caption.trim().slice(0, 200) : "",
      frame: entry.frame === "phone" ? "phone" : "browser",
      name: path.basename(file),
      part: `screen_${index}`,
      title: typeof entry.title === "string" ? entry.title.trim().slice(0, 60) : "",
      type,
    };
  });
}

function buildForm(project, screens) {
  const form = new FormData();
  form.set("project", project);
  form.set(
    "meta",
    JSON.stringify(screens.map(({ caption, frame, part, title }) => ({ caption, frame, part, title }))),
  );
  for (const screen of screens) {
    form.set(screen.part, new Blob([screen.bytes], { type: screen.type }), screen.name);
  }
  return form;
}

async function send(link, project, screens) {
  const response = await fetch(`${link.url}/webhooks/claude-code/screens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${link.token}` },
    body: buildForm(project, screens),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir || !args.project) {
    console.error("usage: send-screens.js --dir <folder with screens.json> --project <slug or owner/repo>");
    process.exit(2);
  }
  const link = readLink();
  if (!link) {
    console.log(JSON.stringify({ status: "not_connected", next_step: "Run /vibeworks:connect first." }));
    process.exit(1);
  }
  let screens;
  try {
    screens = readScreens(args.dir);
  } catch (error) {
    console.log(JSON.stringify({ status: "unreadable", error: error.message }));
    process.exit(1);
  }
  const result = await send(link, args.project, screens);
  console.log(JSON.stringify({ status: result.status >= 200 && result.status < 300 ? "sent" : "refused", ...result }));
  process.exit(result.status >= 200 && result.status < 300 ? 0 : 1);
}

if (require.main === module) {
  main().catch((error) => {
    console.log(JSON.stringify({ status: "failed", error: error.message }));
    process.exit(1);
  });
}

module.exports = { buildForm, readLink, readScreens, send };
