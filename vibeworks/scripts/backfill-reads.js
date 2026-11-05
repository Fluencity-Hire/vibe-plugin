#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { readLink, readSession } = require("./session-pulse.js");

const BACKFILL_DAYS = 30;

async function main() {
  const link = readLink();
  if (!link || !link.reads) return;
  const projectsDir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "projects");
  const cutoff = Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000;
  for (const file of sessionFiles(projectsDir, cutoff)) {
    const sessionId = path.basename(file, ".jsonl");
    try {
      await readSession(link, sessionId, file);
    } catch (_error) {
    }
  }
}

function sessionFiles(projectsDir, cutoff) {
  let folders;
  try {
    folders = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch (_error) {
    return [];
  }
  const files = [];
  for (const folder of folders) {
    const dir = path.join(projectsDir, folder.name);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_error) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const file = path.join(dir, entry.name);
      try {
        if (fs.statSync(file).mtimeMs >= cutoff) files.push(file);
      } catch (_error) {
      }
    }
  }
  return files.sort();
}

if (require.main === module) {
  main().then(
    () => {},
    () => {}
  );
}

module.exports = { sessionFiles };
