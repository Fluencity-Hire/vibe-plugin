#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCREEN_CAP = 12;
const BYTES_CAP = 2_000_000;
const RECORDING_CAP = 8_000_000;
const TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const next = argv[i + 1];
    args[argv[i].slice(2)] = next === undefined || next.startsWith("--") ? true : next;
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

function readFilm(dir) {
  let film;
  try {
    film = JSON.parse(fs.readFileSync(path.join(dir, "film.json"), "utf8"));
  } catch {
    throw new Error(`No readable film.json in ${dir}`);
  }
  if (!film || !Array.isArray(film.shots) || film.shots.length === 0) throw new Error("film.json lists no shots");
  if (film.shots.length * 2 > SCREEN_CAP) throw new Error(`At most ${SCREEN_CAP / 2} shots per send; film.json lists ${film.shots.length}`);

  const inside = (name) => {
    const file = path.resolve(dir, String(name));
    if (!file.startsWith(path.resolve(dir) + path.sep)) throw new Error(`${name} points outside the folder`);
    return file;
  };
  const still = (name) => {
    const file = inside(name);
    let bytes;
    try {
      bytes = fs.readFileSync(file);
    } catch {
      throw new Error(`${name} is missing`);
    }
    if (bytes.length > BYTES_CAP) throw new Error(`${name} is over 2 MB`);
    return bytes;
  };

  return film.shots.flatMap((shot, index) => {
    const caption = typeof shot.caption === "string" ? shot.caption.trim().slice(0, 200) : "";
    const title = typeof shot.title === "string" ? shot.title.trim().slice(0, 60) : "";
    const desktop = { bytes: still(shot.desktop), caption, frame: "browser", name: path.basename(shot.desktop), part: `screen_${index}`, title, type: "image/jpeg" };

    if (typeof shot.video === "string" && Array.isArray(shot.windows) && shot.windows.length > 0) {
      const file = inside(shot.video);
      let recording = null;
      try {
        recording = fs.readFileSync(file);
      } catch {
        recording = null;
      }
      if (recording && recording.length <= RECORDING_CAP) {
        desktop.clip = { bytes: recording, focus: shot.focus || null, name: path.basename(shot.video), part: `clip_${index}`, windows: shot.windows };
      }
    }

    const phone = typeof shot.phone === "string"
      ? [{ bytes: still(shot.phone), caption, frame: "phone", name: path.basename(shot.phone), part: `phone_${index}`, title, type: "image/jpeg" }]
      : [];

    return [desktop, ...phone];
  });
}

function buildForm(project, screens, video) {
  const form = new FormData();
  if (project) form.set("project", project);
  if (video) form.set("video", "true");
  form.set(
    "meta",
    JSON.stringify(
      screens.map(({ caption, clip, frame, part, title }) => ({
        caption,
        frame,
        part,
        title,
        ...(clip ? { clip: { focus: clip.focus, part: clip.part, windows: clip.windows } } : {}),
      })),
    ),
  );
  for (const screen of screens) {
    form.set(screen.part, new Blob([screen.bytes], { type: screen.type }), screen.name);
    if (screen.clip) form.set(screen.clip.part, new Blob([screen.clip.bytes], { type: "video/webm" }), screen.clip.name);
  }
  return form;
}

async function send(link, project, screens, video = false) {
  const response = await fetch(`${link.url}/webhooks/claude-code/screens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${link.token}` },
    body: buildForm(project, screens, video),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

function outcome(result) {
  const sent = result.status >= 200 && result.status < 300;
  const body = result.body && typeof result.body === "object" ? result.body : {};
  return { ...body, http: result.status, page: body.status, status: sent ? "sent" : "refused" };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pass = typeof args.pass === "string" ? args.pass : null;
  const project = typeof args.project === "string" ? args.project : null;
  if (typeof args.dir !== "string" || (!project && !pass) || (pass && typeof args.url !== "string")) {
    console.error(
      "usage: send-screens.js --dir <folder with film.json or screens.json> (--project <slug or owner/repo> | --pass <pass> --url <url>) [--video]",
    );
    process.exit(2);
  }
  const link = pass ? { token: pass, url: args.url.replace(/\/webhooks\/.*$/, "").replace(/\/+$/, "") } : readLink();
  if (!link) {
    console.log(
      JSON.stringify({
        status: "not_connected",
        next_step: "Save the page with create_project or update_project to get an upload pass, or run /vibeworks:connect.",
      }),
    );
    process.exit(1);
  }
  let screens;
  try {
    screens = fs.existsSync(path.join(args.dir, "film.json")) ? readFilm(args.dir) : readScreens(args.dir);
  } catch (error) {
    console.log(JSON.stringify({ status: "unreadable", error: error.message }));
    process.exit(1);
  }
  const video = args.video === true || args.video === "true";
  const report = outcome(await send(link, project, screens, video));
  console.log(JSON.stringify(report));
  process.exit(report.status === "sent" ? 0 : 1);
}

if (require.main === module) {
  main().catch((error) => {
    console.log(JSON.stringify({ status: "failed", error: error.message }));
    process.exit(1);
  });
}

module.exports = { buildForm, outcome, readFilm, readLink, readScreens, send };
