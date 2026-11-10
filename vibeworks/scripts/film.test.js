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
  playwrightReady = Boolean(process.env.REQUIRE_PLAYWRIGHT);
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
  <div id="card" draggable="true" style="width:160px;padding:8px;border:1px solid #333">Sample: Plan week two</div>
  <div id="done" style="width:200px;height:80px;margin-top:12px;border:2px dashed #999">Done</div>
</main>
<script>
  document.getElementById("add").addEventListener("submit", (event) => {
    event.preventDefault();
    const li = document.createElement("li");
    li.textContent = document.getElementById("title").value;
    document.getElementById("list").appendChild(li);
    setTimeout(() => { document.getElementById("saved").hidden = false; }, 300);
  });
  document.getElementById("card").addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", "card"));
  document.getElementById("done").addEventListener("dragover", (event) => event.preventDefault());
  document.getElementById("done").addEventListener("drop", (event) => {
    event.preventDefault();
    event.currentTarget.appendChild(document.getElementById("card"));
    event.currentTarget.insertAdjacentHTML("beforeend", "<p>Moved to done</p>");
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

test("a clip keeps the last seven seconds of what was done, and the end of a long wait, so a slow answer is seen arriving", () => {
  const typed = { from: 1, to: 6, speed: 2.5 };
  const clicked = { from: 6, to: 6.8, speed: 1 };
  const waited = { from: 6.8, to: 30, speed: 2 };
  const windows = chosenWindows([typed, clicked, waited], 40);
  const played = windows.reduce((sum, [from, to, speed]) => sum + (to - from) / speed, 0);
  assert.ok(played <= 7.01, `a clip never plays longer than seven seconds, not ${played}`);
  assert.deepEqual(windows[windows.length - 1], [30, 31.5, 1], "the clip ends on the answer, held still at real speed");
  assert.ok(windows.some(([from, to]) => from === 23 && to === 30), "a long wait keeps its last seconds, when the answer lands, not its first");
  assert.equal(windows.trimmed, true, "the typing fell off the front, and the report says so");

  const many = Array.from({ length: 30 }, (_unused, i) => ({ from: i, to: i + 0.3, speed: 1 }));
  assert.ok(chosenWindows(many, 40).length <= 15, "a clip is cut from at most fifteen moments, which the server accepts");
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
    assert.ok(added.windows.some(([, , speed]) => speed === 1.5), "typing plays a little fast, slow enough to read");
    assert.ok(added.windows.some(([, , speed]) => speed === 2), "waiting for the app to answer plays fast");
    assert.ok(added.windows.every(([from, to], i) => to > from && (i === 0 || added.windows[i - 1][1] <= from + 0.01)), JSON.stringify(added.windows));
    assert.ok(added.seconds >= 2 && added.seconds <= 7.01, `a clip plays between two and seven seconds, not ${added.seconds}`);
    assert.ok(added.focus && added.focus.x > 0 && added.focus.x < 1, "the last click's place is kept for the camera");

    assert.equal(looked.windows.length, 1, "a shot with no steps glides down the page instead");
    assert.ok(looked.windows[0][1] - looked.windows[0][0] <= 7.01, "the glide is held to seven seconds too");
    assert.equal(looked.focus, null);
    assert.ok(added.frames.length >= 3, "the opening frame and pictures from the middle of the shot are kept for the look over");
    assert.equal(added.frames[0], "add-task-open.jpg");
    assert.ok(outcome.shots[0].opens_on.endsWith("add-task-open.jpg") && outcome.shots[0].phone.endsWith("add-task-phone.jpg"), "the reply names what each clip opens on and its phone picture, since both are sent");

    const looked_at = await film(["--look", "--plan", plan, "--path", "/", "--out", out]);
    assert.equal(looked_at.status, "looked");
    assert.ok(fs.existsSync(looked_at.picture));
    assert.ok(looked_at.on_page.elements.some((el) => el.name === "Add task"), "a page can be looked at before any shot is planned");
    assert.ok(fs.existsSync(path.join(out, ".gitignore")), "the folder ignores itself, so nothing filmed is ever committed");
    assert.ok(!fs.existsSync(path.join(out, "state.json")), "a sign in used for filming is not left on disk");
    assert.ok(!fs.existsSync(path.join(out, "rec")), "the raw recording folders are tidied away");
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a step that cannot be done names the shot, the step and what is on the page, keeps the shots that worked, and one shot can be filmed again", { skip: !playwrightReady && "playwright is not installed" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "film-"));
  const server = await serve();
  const out = path.join(dir, "out");
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const before = { path: "/", steps: [{ do: "click", target: { role: "link", name: "Use the local demo account" } }] };
    const moveCard = {
      caption: "Drag a task to done.",
      name: "move-card",
      path: "/",
      steps: [
        { do: "drag", from: { text: "Sample: Plan week two" }, to: { css: "#done" } },
        { do: "wait", for: { text: "Moved to done" } },
      ],
      title: "Move a task",
    };
    const broken = { ...addTask, steps: [addTask.steps[0], { do: "click", target: { role: "button", name: "Save task" } }] };

    const stuck = await film(["--plan", writePlan(dir, { base, before, shots: [broken, moveCard] }), "--out", out]);
    assert.equal(stuck.status, "step_failed");
    assert.equal(stuck.failed.length, 1);
    const [failure] = stuck.failed;
    assert.equal(failure.shot, "add-task");
    assert.equal(failure.step, 2);
    assert.ok(failure.on_page.elements.some((el) => el.name === "Add task"), "the real buttons come back so the plan can be fixed");
    assert.ok(failure.on_page.elements.some((el) => el.name === "New task"), "a field is named by its label, the word a plan would use");
    assert.deepEqual(failure.on_page.headings, ["Today"], "the way in set up before filming carried into the shot");
    assert.deepEqual(stuck.shots.map((shot) => shot.name), ["move-card"], "one bad shot does not lose the ones after it");
    assert.deepEqual(stuck.missing, ["add-task"]);

    const fixed = writePlan(dir, { base, before, shots: [addTask, moveCard] });
    const again = await film(["--plan", fixed, "--out", out, "--shot", "add-task"]);
    assert.equal(again.status, "filmed", JSON.stringify(again));
    assert.deepEqual(again.shots.map((shot) => shot.name), ["add-task", "move-card"], "the retake joins the shots already filmed");
    assert.deepEqual(again.missing, []);

    const missing = await film(["--plan", fixed, "--out", out, "--shot", "nope"]);
    assert.equal(missing.status, "failed");

    const cleaned = await film(["--clean", "--out", out]);
    assert.equal(cleaned.status, "failed", "only a folder named .vibeworks-film is ever removed");
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
