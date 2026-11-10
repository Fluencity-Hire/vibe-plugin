"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { execFile } = require("node:child_process");

const { chosenWindows, readPlan } = require("./film.js");

const SCRIPT = path.join(__dirname, "film.js");

let playwrightReady = true;
try {
  require.resolve("playwright");
} catch {
  playwrightReady = false;
}

const board = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Task Board</title>
<style>body{margin:0;font:16px sans-serif} main{padding:24px;min-height:1500px}</style>
</head><body><main>
  <h1>Today</h1>
  <ul id="list"><li>Sample: Draft pilot welcome email</li></ul>
  <form id="add">
    <label for="title">New task</label><input id="title" type="text" placeholder="What needs doing?">
    <button type="submit">Add task</button>
  </form>
  <p id="saved" hidden>Saved to today</p>
</main>
<script>
  document.getElementById("add").addEventListener("submit", (event) => {
    event.preventDefault();
    const li = document.createElement("li");
    li.textContent = document.getElementById("title").value;
    document.getElementById("list").appendChild(li);
    setTimeout(() => { document.getElementById("saved").hidden = false; }, 300);
  });
</script>
</body></html>`;

const door = `<!doctype html><html><head><title>Sign in</title></head><body>
<h1>Sign in</h1><a href="/enter">Use the local demo account</a></body></html>`;

const serve = () =>
  new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const signedIn = /demo=1/.test(request.headers.cookie || "") || request.headers.authorization === "Bearer local-dev-key";
      if (request.url === "/enter") {
        response.writeHead(302, { location: "/", "set-cookie": "demo=1; Path=/" });
        return response.end();
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(signedIn ? board : door);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });

const film = (args) =>
  new Promise((resolve) => {
    execFile("node", [SCRIPT, ...args], { timeout: 120_000 }, (_error, stdout) => resolve(JSON.parse(stdout.trim().split("\n").pop())));
  });

const writePlan = (dir, plan) => {
  const file = path.join(dir, "plan.json");
  fs.writeFileSync(file, JSON.stringify(plan));
  return file;
};

const addTask = {
  caption: "Type a task and it joins today's list.",
  name: "add-task",
  path: "/",
  steps: [
    { do: "type", target: { label: "New task" }, text: "Sample: Book kickoff calls" },
    { do: "click", target: { role: "button", name: "Add task" } },
    { do: "wait", for: { text: "Saved to today" } },
  ],
  title: "Add a task",
};

test("a plan is refused with the reason when it cannot be filmed as written", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "film-plan-"));
  try {
    assert.throws(() => readPlan(writePlan(dir, { base: "localhost:3000", shots: [addTask] })), /http/);
    assert.throws(() => readPlan(writePlan(dir, { base: "http://localhost:3000", shots: [] })), /at least one shot/);
    assert.throws(
      () => readPlan(writePlan(dir, { base: "http://localhost:3000", shots: [{ ...addTask, name: "../escape" }] })),
      /lowercase letters/,
      "a shot's name becomes file names, so it can never carry a path",
    );
    assert.throws(
      () => readPlan(writePlan(dir, { base: "http://localhost:3000", shots: Array.from({ length: 7 }, (_, i) => ({ ...addTask, name: `s${i}` })) })),
      /At most 6 shots/,
    );
    const plan = readPlan(writePlan(dir, { base: "http://localhost:3000/", shots: [addTask] }));
    assert.equal(plan.base, "http://localhost:3000");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a clip keeps the last seven seconds of what was done, as it will play", () => {
  const typed = { from: 1, to: 6, speed: 2.5 };
  const clicked = { from: 6, to: 6.8, speed: 1 };
  const waited = { from: 6.8, to: 30, speed: 2 };
  const windows = chosenWindows([typed, clicked, waited], 40);
  const played = windows.reduce((sum, [from, to, speed]) => sum + (to - from) / speed, 0);
  assert.ok(played <= 7.01, `a clip never plays longer than seven seconds, not ${played}`);
  assert.deepEqual(windows[windows.length - 1], [13.8, 15.3, 1], "the clip ends on a still moment at real speed");
  assert.ok(windows.some(([from, to]) => from === 6.8 && to === 13.8), "a long wait is cut to three and a half played seconds");
});

test("the plan is filmed shot by shot into a still, a phone still, a recording and the windows to cut it by", { skip: !playwrightReady && "playwright is not installed" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "film-"));
  const server = await serve();
  const out = path.join(dir, "out");
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const look = { caption: "Everything due today in one list.", name: "today", path: "/", steps: [], title: "Today's list" };
    const plan = writePlan(dir, { base, headers: { Authorization: "Bearer local-dev-key" }, shots: [addTask, look] });

    const outcome = await film(["--plan", plan, "--out", out]);
    assert.equal(outcome.status, "filmed", JSON.stringify(outcome));
    assert.deepEqual(outcome.shots.map((shot) => shot.name), ["add-task", "today"]);
    assert.ok(fs.existsSync(outcome.contact), "one sheet of every still comes back to look over in a single glance");

    const { shots } = JSON.parse(fs.readFileSync(path.join(out, "film.json"), "utf8"));
    const [added, looked] = shots;
    assert.equal(added.title, "Add a task");
    assert.equal(added.caption, "Type a task and it joins today's list.");
    assert.ok(fs.statSync(path.join(out, added.desktop)).size > 5000);
    assert.ok(fs.statSync(path.join(out, added.phone)).size > 2000, "a phone still comes with every shot");
    assert.ok(fs.statSync(path.join(out, added.video)).size > 10_000, "each shot has its own short recording");
    assert.ok(added.windows.some(([, , speed]) => speed === 2.5), "typing plays fast");
    assert.ok(added.windows.some(([, , speed]) => speed === 2), "waiting for the app to answer plays fast");
    assert.ok(added.windows.every(([from, to], i) => to > from && (i === 0 || added.windows[i - 1][1] <= from + 0.01)), JSON.stringify(added.windows));
    assert.ok(added.seconds >= 2 && added.seconds <= 7.01, `a clip plays between two and seven seconds, not ${added.seconds}`);
    assert.ok(added.focus && added.focus.x > 0 && added.focus.x < 1, "the last click's place is kept for the camera");

    assert.equal(looked.windows.length, 1, "a shot with no steps glides down the page instead");
    assert.equal(looked.focus, null);
    assert.ok(!fs.existsSync(path.join(out, "rec")), "the raw recording folders are tidied away");
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a step that cannot be done names the shot, the step and what is on the page, and one shot can be filmed again", { skip: !playwrightReady && "playwright is not installed" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "film-"));
  const server = await serve();
  const out = path.join(dir, "out");
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const before = { path: "/", steps: [{ do: "click", target: { role: "link", name: "Use the local demo account" } }] };
    const broken = { ...addTask, steps: [addTask.steps[0], { do: "click", target: { role: "button", name: "Save task" } }] };

    const stuck = await film(["--plan", writePlan(dir, { base, before, shots: [broken] }), "--out", out]);
    assert.equal(stuck.status, "step_failed");
    assert.equal(stuck.shot, "add-task");
    assert.equal(stuck.step, 2);
    assert.ok(stuck.on_page.elements.some((el) => el.name === "Add task"), "the real buttons come back so the plan can be fixed");
    assert.deepEqual(stuck.on_page.headings, ["Today"], "the way in set up before filming carried into the shot");

    const fixed = writePlan(dir, { base, before, shots: [addTask] });
    const again = await film(["--plan", fixed, "--out", out, "--shot", "add-task"]);
    assert.equal(again.status, "filmed", JSON.stringify(again));
    assert.equal(again.shots.length, 1);

    const missing = await film(["--plan", fixed, "--out", out, "--shot", "nope"]);
    assert.equal(missing.status, "failed");
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
