"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const { execFile } = require("node:child_process");
const { outcome, readFilm, readLink, readScreens, send } = require("./send-screens.js");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

function folder(entries, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vw-screens-"));
  for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), bytes);
  fs.writeFileSync(path.join(dir, "screens.json"), JSON.stringify(entries));
  return dir;
}

function receiver(status, reply) {
  return new Promise((resolve) => {
    const seen = {};
    const server = http.createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        seen.headers = request.headers;
        seen.url = request.url;
        seen.body = Buffer.concat(chunks);
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(reply));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ seen, server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

test("reads the folder's listing and refuses what the server would refuse anyway", () => {
  const dir = folder(
    [{ file: "home.png", title: "The board", caption: "Every open shift this week.", frame: "browser" }],
    { "home.png": PNG },
  );
  const [screen] = readScreens(dir);
  assert.equal(screen.part, "screen_0");
  assert.equal(screen.title, "The board");
  assert.equal(screen.type, "image/png");
  assert.deepEqual(screen.bytes, PNG);

  assert.throws(() => readScreens(folder([], {})), /at least one/);
  assert.throws(() => readScreens(folder([{ file: "missing.png" }], {})), /missing/);
  assert.throws(() => readScreens(folder([{ file: "notes.txt" }], { "notes.txt": "hi" })), /not a PNG/);
  assert.throws(() => readScreens(folder([{ file: "../etc/passwd.png" }], {})), /outside the folder/);
  const many = Array.from({ length: 13 }, (_unused, i) => ({ file: `s${i}.png` }));
  assert.throws(() => readScreens(folder(many, Object.fromEntries(many.map((m) => [m.file, PNG])))), /At most 12/);
});

test("sends the pictures and their words as one signed multipart request, and hands back the answer", async () => {
  const { seen, server, url } = await receiver(200, { saved: 1, status: "on_page" });
  try {
    const dir = folder([{ file: "home.png", title: "The board", caption: "Open shifts.", frame: "phone" }], { "home.png": PNG });
    const result = await send({ token: "vwcc_test", url }, "shiftwise", readScreens(dir));

    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { saved: 1, status: "on_page" });
    assert.equal(seen.url, "/webhooks/claude-code/screens");
    assert.equal(seen.headers.authorization, "Bearer vwcc_test");
    assert.match(seen.headers["content-type"], /^multipart\/form-data; boundary=/);

    const body = seen.body.toString("latin1");
    assert.match(body, /name="project"\r\n\r\nshiftwise/);
    assert.match(body, /name="meta"\r\n\r\n\[\{"caption":"Open shifts\.","frame":"phone","part":"screen_0","title":"The board"\}\]/);
    assert.match(body, /name="screen_0"; filename="home.png"\r\ncontent-type: image\/png/i);
    assert.ok(seen.body.includes(PNG), "the picture's own bytes travel, not a path or a name");
  } finally {
    server.close();
  }
});

test("reads the plugin's token file, and says when there is none", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vw-token-"));
  const file = path.join(dir, "token.json");
  process.env.VIBEWORKS_TOKEN_FILE = file;
  try {
    assert.equal(readLink(), null);
    fs.writeFileSync(file, JSON.stringify({ token: "vwcc_abc", url: "https://getvibeworks.ai/" }));
    assert.deepEqual(readLink(), { token: "vwcc_abc", url: "https://getvibeworks.ai" });
  } finally {
    delete process.env.VIBEWORKS_TOKEN_FILE;
  }
});

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]);
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 1, 2, 3]);

function filmFolder(shots, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vw-film-"));
  for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), bytes);
  fs.writeFileSync(path.join(dir, "film.json"), JSON.stringify({ shots }));
  return dir;
}

const addTask = {
  caption: "Type a task and it joins today's list.",
  desktop: "add-task.jpg",
  focus: { x: 0.24, y: 0.18 },
  name: "add-task",
  phone: "add-task-phone.jpg",
  title: "Add a task",
  video: "add-task.webm",
  windows: [[1.8, 2.5, 1], [2.5, 3.5, 2.5]],
};

test("reads filmed shots as a still with its recording and a phone still, each under the shot's words", () => {
  const dir = filmFolder([addTask], { "add-task.jpg": JPG, "add-task-phone.jpg": JPG, "add-task.webm": WEBM });
  const [desktop, phone] = readFilm(dir);
  assert.equal(desktop.part, "screen_0");
  assert.equal(desktop.frame, "browser");
  assert.deepEqual(desktop.clip.windows, addTask.windows);
  assert.deepEqual(desktop.clip.focus, addTask.focus);
  assert.deepEqual(desktop.clip.bytes, WEBM);
  assert.equal(phone.frame, "phone");
  assert.equal(phone.title, "Add a task");
  assert.equal(phone.clip, undefined);

  const unfilmed = readFilm(filmFolder([{ ...addTask, video: "gone.webm" }], { "add-task.jpg": JPG, "add-task-phone.jpg": JPG }));
  assert.equal(unfilmed[0].clip, undefined, "a shot whose recording is gone still sends its picture");

  assert.throws(() => readFilm(filmFolder([], {})), /no shots/);
  assert.throws(() => readFilm(filmFolder([{ ...addTask, desktop: "../../etc/passwd" }], {})), /outside the folder/);
  const many = Array.from({ length: 7 }, () => addTask);
  assert.throws(() => readFilm(filmFolder(many, { "add-task.jpg": JPG, "add-task-phone.jpg": JPG })), /At most 6 shots/);
});

test("sends filmed shots with the page's upload pass, asks for the video, and names no project", async () => {
  const { seen, server, url } = await receiver(200, { clips: 1, saved: 3, status: "on_page", video: "started" });
  try {
    const dir = filmFolder([addTask], { "add-task.jpg": JPG, "add-task-phone.jpg": JPG, "add-task.webm": WEBM });
    const result = await send({ token: "a-pass-for-one-page", url }, null, readFilm(dir), true);
    assert.equal(result.status, 200);
    assert.equal(result.body.video, "started");
    assert.equal(seen.headers.authorization, "Bearer a-pass-for-one-page");
    const body = seen.body.toString("latin1");
    assert.match(body, /name="video"\r\n\r\ntrue/);
    assert.doesNotMatch(body, /name="project"/, "the pass already says which page, so the form does not");
    assert.match(body, /name="clip_0"; filename="add-task.webm"/);
    assert.match(body, /name="phone_0"; filename="add-task-phone.jpg"/);
    assert.match(body, /"clip":\{"focus":\{"x":0.24,"y":0.18\},"part":"clip_0","windows":\[\[1.8,2.5,1\],\[2.5,3.5,2.5\]\]\}/);
  } finally {
    server.close();
  }
});

test("says sent or refused in the words the skill reads, with the server's answer beside it", async () => {
  assert.deepEqual(outcome({ status: 200, body: { clips: 2, saved: 5, status: "on_page", video: "started" } }), {
    clips: 2,
    http: 200,
    page: "on_page",
    saved: 5,
    status: "sent",
    video: "started",
  });
  assert.deepEqual(outcome({ status: 401, body: { error: "pass_expired" } }), {
    error: "pass_expired",
    http: 401,
    page: undefined,
    status: "refused",
  });
  assert.equal(outcome({ status: 502, body: null }).status, "refused");

  const { seen, server, url } = await receiver(200, { clips: 1, saved: 3, status: "on_page", video: "started" });
  try {
    const dir = filmFolder([addTask], { "add-task.jpg": JPG, "add-task-phone.jpg": JPG, "add-task.webm": WEBM });
    const script = path.join(__dirname, "send-screens.js");
    const printed = await new Promise((resolve) => {
      execFile("node", [script, "--dir", dir, "--url", `${url}/webhooks/claude-code/screens`, "--pass", "a-pass", "--video"], (_error, stdout) =>
        resolve(stdout),
      );
    });
    assert.equal(JSON.parse(printed).status, "sent");
    assert.equal(JSON.parse(printed).video, "started");
    assert.ok(!printed.includes("a-pass"), "the pass is never printed back");
    assert.equal(seen.url, "/webhooks/claude-code/screens");
    assert.equal(seen.headers.authorization, "Bearer a-pass");
  } finally {
    server.close();
  }
});
