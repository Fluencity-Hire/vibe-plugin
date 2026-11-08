"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const { readLink, readScreens, send } = require("./send-screens.js");

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
  const many = Array.from({ length: 9 }, (_unused, i) => ({ file: `s${i}.png` }));
  assert.throws(() => readScreens(folder(many, Object.fromEntries(many.map((m) => [m.file, PNG])))), /At most 8/);
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
