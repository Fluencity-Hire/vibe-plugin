#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const PLAYWRIGHT_VERSION = "1.62.1";
const SHOT_CAP = 6;
const STEP_CAP = 12;
const desktop = { width: 1280, height: 800 };
const phone = { width: 390, height: 844 };
const settleMs = 900;
const quietMs = 4000;
const gotoTimeoutMs = 20_000;
const actTimeoutMs = 6000;
const waitForCapMs = 30_000;
const cursorMoveMs = 550;
const typeDelayMs = 45;
const typeOnCameraChars = 60;
const leadSeconds = 0.15;
const windowCapSeconds = 3.5;
const holdSeconds = 1.5;
const typeSpeed = 1.5;
const waitSpeed = 2;
const payoffSeconds = 2.4;
const endMarginSeconds = 0.3;
const clipBudgetSeconds = 7;
const clipFloorSeconds = 2;
const windowCap = 14;
const shotSecondsCap = 110;
const resizeMarginMs = 1500;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const next = argv[i + 1];
    args[argv[i].slice(2)] = next === undefined || next.startsWith("--") ? true : next;
  }
  return args;
}

function filmHome() {
  const config = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  return process.env.VIBEWORKS_FILM_HOME || path.join(config, "vibeworks", "film");
}

function loadPlaywright() {
  const roots = [process.cwd(), filmHome()];
  for (const name of ["playwright", "playwright-core"]) {
    try {
      return require(name);
    } catch {
      for (const root of roots) {
        try {
          return require(require.resolve(name, { paths: [root] }));
        } catch {
          continue;
        }
      }
    }
  }
  return null;
}

async function launch(playwright) {
  const tried = [];
  for (const options of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
    try {
      return await playwright.chromium.launch({ headless: true, ...options });
    } catch (error) {
      tried.push(String(error && error.message ? error.message : error).split("\n")[0]);
    }
  }
  const failure = new Error("no browser to film with");
  failure.tried = tried;
  throw failure;
}

function setup() {
  const home = filmHome();
  fs.mkdirSync(home, { recursive: true });
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  execFileSync(npm, ["install", "--prefix", home, "--no-audit", "--no-fund", `playwright-core@${PLAYWRIGHT_VERSION}`], {
    shell: process.platform === "win32",
    stdio: "ignore",
  });
  const cli = path.join(home, "node_modules", "playwright-core", "cli.js");
  execFileSync(process.execPath, [cli, "install", "ffmpeg"], { stdio: "ignore" });
  return cli;
}

async function setupBrowser(cli) {
  const playwright = loadPlaywright();
  try {
    const browser = await launch(playwright);
    await browser.close();
    return "found";
  } catch {
    execFileSync(process.execPath, [cli, "install", "--only-shell", "chromium"], { stdio: "ignore" });
    return "installed";
  }
}

function readPlan(file, looking = false) {
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`No readable plan at ${file}`);
  }
  let base;
  try {
    base = new URL(plan.base);
  } catch {
    throw new Error("The plan needs a base address, such as http://localhost:3000");
  }
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("The base address must start with http or https");
  if (looking) plan.shots = [];
  if (!Array.isArray(plan.shots) || (plan.shots.length === 0 && !looking)) throw new Error("The plan needs at least one shot");
  if (plan.shots.length > SHOT_CAP) throw new Error(`At most ${SHOT_CAP} shots; the plan lists ${plan.shots.length}`);
  const names = new Set();
  const shots = plan.shots.map((shot, index) => {
    const name = String(shot.name || "").trim();
    if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(name)) {
      throw new Error(`Shot ${index + 1} needs a name of lowercase letters, numbers and dashes`);
    }
    if (names.has(name)) throw new Error(`Two shots are named ${name}`);
    names.add(name);
    const steps = Array.isArray(shot.steps) ? shot.steps : [];
    if (steps.length > STEP_CAP) throw new Error(`Shot ${name} has ${steps.length} steps; keep it to ${STEP_CAP}`);
    const route = String(shot.path || "/");
    if (!route.startsWith("/")) throw new Error(`Shot ${name}: the path must start with "/", such as "/tasks"`);
    return {
      caption: String(shot.caption || "").trim().slice(0, 200),
      name,
      path: route,
      steps,
      title: String(shot.title || "").trim().slice(0, 60),
    };
  });
  return {
    base: plan.base.replace(/\/+$/, ""),
    before: plan.before && Array.isArray(plan.before.steps) ? plan.before : null,
    headers: plan.headers && typeof plan.headers === "object" ? plan.headers : null,
    shots,
  };
}

const round2 = (number) => Math.round(number * 100) / 100;
const fraction = (value, span) => Math.round(Math.max(0, Math.min(1, value / span)) * 1000) / 1000;
const outputSeconds = ([from, to, speed]) => (to - from) / speed;

function chosenWindows(recorded, captureAt) {
  const segments = recorded.map(({ from, to, speed }) => [Math.max(from, to - windowCapSeconds * speed), to, speed]);
  if (segments.length) {
    const lastTo = segments[segments.length - 1][1];
    const holdTo = Math.min(lastTo + holdSeconds, captureAt - endMarginSeconds);
    if (holdTo - lastTo >= 0.3) segments.push([lastTo, holdTo, 1]);
  }
  const kept = [];
  let total = 0;
  let trimmed = false;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const [from, to, speed] = segments[i];
    const length = outputSeconds(segments[i]);
    if (length < 0.25) continue;
    if (total + length > clipBudgetSeconds || kept.length >= windowCap) {
      if (kept.length === 0) kept.unshift([to - clipBudgetSeconds * speed, to, speed]);
      trimmed = true;
      break;
    }
    kept.unshift([from, to, speed]);
    total += length;
  }
  const windows = kept.map(([from, to, speed]) => [round2(from), round2(to), speed]);
  windows.trimmed = trimmed;
  return windows;
}

function locate(page, target) {
  if (!target || typeof target !== "object") throw new Error("the step names no target");
  const exact = target.exact === true;
  let found;
  if (target.role) found = page.getByRole(target.role, target.name ? { name: target.name, exact } : {});
  else if (target.label) found = page.getByLabel(target.label, { exact });
  else if (target.placeholder) found = page.getByPlaceholder(target.placeholder, { exact });
  else if (target.text) found = page.getByText(target.text, { exact });
  else if (target.testid) found = page.getByTestId(target.testid);
  else if (target.css) found = page.locator(target.css);
  else throw new Error("a target needs one of role, label, placeholder, text, testid or css");
  if (target.within) found = page.locator(target.within).locator(found);
  return Number.isInteger(target.nth) ? found.nth(target.nth) : found.first();
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: quietMs }).catch(() => {});
  await page.waitForTimeout(settleMs);
}

async function open(page, address) {
  try {
    await page.goto(address, { waitUntil: "load", timeout: gotoTimeoutMs });
  } catch {
    await page.goto(address, { waitUntil: "domcontentloaded", timeout: gotoTimeoutMs });
  }
  await settle(page);
}

async function onPage(page) {
  const seen = await page
    .evaluate(() => {
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const name = (el) => {
        const byId = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        const wrapped = el.closest("label");
        return String(
          el.getAttribute("aria-label") || (byId && byId.innerText) || (wrapped && wrapped.innerText) || el.innerText ||
            el.getAttribute("placeholder") || el.getAttribute("name") || "",
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60);
      };
      const selector = "a[href], button, [role=button], [role=tab], [role=link], input:not([type=hidden]), textarea, select";
      return {
        elements: Array.from(document.querySelectorAll(selector))
          .filter(visible)
          .slice(0, 40)
          .map((el) => ({ name: name(el), tag: el.tagName.toLowerCase(), type: el.getAttribute("type") })),
        headings: Array.from(document.querySelectorAll("h1, h2, h3"))
          .filter(visible)
          .slice(0, 8)
          .map((el) => el.innerText.replace(/\s+/g, " ").trim()),
        title: document.title,
      };
    })
    .catch(() => ({ elements: [], headings: [], title: "" }));
  return { url: page.url(), ...seen };
}

function pointer(page) {
  let at = { x: desktop.width / 2, y: desktop.height / 2 };

  const ensure = () =>
    page
      .evaluate(({ x, y }) => {
        let cursor = document.getElementById("vw-cursor");
        if (!cursor) {
          cursor = document.createElement("div");
          cursor.id = "vw-cursor";
          cursor.setAttribute("aria-hidden", "true");
          cursor.style.cssText =
            "position:fixed;left:0;top:0;width:34px;height:34px;z-index:2147483647;pointer-events:none;" +
            "transition:transform 0.55s cubic-bezier(0.2,0.7,0.2,1);filter:drop-shadow(0 2px 4px rgba(0,0,0,0.45));";
          cursor.innerHTML =
            '<svg viewBox="0 0 28 28" width="34" height="34"><path d="M6 3l15 12-6.5 1 4 8-3 1.5-4-8L6 22z" fill="#ffffff" stroke="#0b0d10" stroke-width="1.6" stroke-linejoin="round"/></svg>';
          cursor.style.transform = `translate(${x - 7}px, ${y - 4}px)`;
          document.documentElement.appendChild(cursor);
        }
        cursor.style.visibility = "visible";
      }, at)
      .catch(() => {});

  const hide = () =>
    page
      .evaluate(() => {
        const cursor = document.getElementById("vw-cursor");
        if (cursor) cursor.style.visibility = "hidden";
      })
      .catch(() => {});

  const glide = async (x, y, ms = cursorMoveMs, mouse = true) => {
    await ensure();
    await page
      .evaluate(
        ({ x, y, ms }) => {
          const cursor = document.getElementById("vw-cursor");
          if (!cursor) return;
          cursor.style.transitionDuration = `${ms}ms`;
          cursor.style.transform = `translate(${x - 7}px, ${y - 4}px)`;
        },
        { x, y, ms },
      )
      .catch(() => {});
    if (mouse) await page.mouse.move(x, y).catch(() => {});
    await page.waitForTimeout(ms);
    at = { x, y };
  };

  const park = () => page.mouse.move(desktop.width - 2, desktop.height - 2).catch(() => {});

  const ripple = (x, y) =>
    page
      .evaluate(({ x, y }) => {
        const ring = document.createElement("div");
        ring.setAttribute("aria-hidden", "true");
        ring.style.cssText =
          `position:fixed;left:${x - 18}px;top:${y - 18}px;width:36px;height:36px;border-radius:999px;` +
          "border:3px solid #fd108e;box-shadow:0 0 0 2px rgba(255,255,255,0.95),inset 0 0 0 2px rgba(255,255,255,0.95);" +
          "z-index:2147483646;pointer-events:none;opacity:0.9;transform:scale(0.4);" +
          "transition:transform 0.45s ease-out, opacity 0.45s ease-out;";
        document.documentElement.appendChild(ring);
        requestAnimationFrame(() => {
          ring.style.transform = "scale(1.6)";
          ring.style.opacity = "0";
        });
        setTimeout(() => ring.remove(), 600);
      }, { x, y })
      .catch(() => {});

  const centre = async (locator) => {
    await locator.scrollIntoViewIfNeeded({ timeout: actTimeoutMs });
    const box = await locator.boundingBox();
    if (!box) throw new Error("the target is not on screen");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };

  const to = async (locator) => {
    const { x, y } = await centre(locator);
    await glide(x, y);
    return { x, y };
  };

  const press = async (locator) => {
    const { x, y } = await to(locator);
    await ripple(x, y);
    await page.waitForTimeout(120);
    return { x: fraction(x, desktop.width), y: fraction(y, desktop.height) };
  };

  return { centre, ensure, glide, hide, park, press, to };
}

async function perform(page, hand, step, shift, base) {
  switch (step.do) {
    case "click": {
      const element = locate(page, step.target);
      const focus = await hand.press(element);
      await element.click({ timeout: actTimeoutMs });
      shift(waitSpeed);
      await settle(page);
      await hand.ensure();
      return focus;
    }
    case "type": {
      const element = locate(page, step.target);
      const text = String(step.text || "");
      const focus = await hand.press(element);
      shift(typeSpeed);
      await element.click({ timeout: actTimeoutMs });
      if (step.clear !== false) await element.fill("", { timeout: actTimeoutMs }).catch(() => {});
      if (text.length <= typeOnCameraChars) {
        await page.keyboard.type(text, { delay: typeDelayMs });
      } else {
        await page.keyboard.insertText(text);
      }
      return focus;
    }
    case "press": {
      await page.keyboard.press(String(step.key || "Enter"));
      shift(waitSpeed);
      await settle(page);
      await hand.ensure();
      return null;
    }
    case "hover": {
      const element = locate(page, step.target);
      const { x, y } = await hand.to(element);
      await element.hover({ timeout: actTimeoutMs }).catch(() => {});
      await page.waitForTimeout(700);
      return { x: fraction(x, desktop.width), y: fraction(y, desktop.height) };
    }
    case "select": {
      const element = locate(page, step.target);
      const focus = await hand.press(element);
      await element.selectOption({ label: String(step.option || "") }, { timeout: actTimeoutMs });
      await page.waitForTimeout(500);
      return focus;
    }
    case "drag": {
      const from = await hand.to(locate(page, step.from));
      const target = await hand.centre(locate(page, step.to));
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.waitForTimeout(150);
      const moving = hand.glide(target.x, target.y, 900, false);
      await page.mouse.move(target.x, target.y, { steps: 28 });
      await moving;
      await page.waitForTimeout(300);
      await page.mouse.up();
      shift(waitSpeed);
      await settle(page);
      return { x: fraction(target.x, desktop.width), y: fraction(target.y, desktop.height) };
    }
    case "scroll": {
      if (step.target) {
        await locate(page, step.target).evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
      } else {
        const by = Number(step.by) || 500;
        await page.evaluate((y) => window.scrollBy({ top: y, behavior: "smooth" }), by);
      }
      await page.waitForTimeout(900);
      return null;
    }
    case "wait": {
      shift(waitSpeed);
      if (step.for) {
        const limit = Math.min(Number(step.limit_ms) || 15_000, waitForCapMs);
        await locate(page, step.for).waitFor({ state: "visible", timeout: limit });
        await page.waitForTimeout(400);
      } else {
        await page.waitForTimeout(Math.min(Number(step.ms) || 800, 5000));
      }
      return null;
    }
    case "goto": {
      shift(waitSpeed);
      await open(page, base + String(step.path || "/"));
      await hand.ensure();
      return null;
    }
    default:
      throw new Error(`unknown step "${step.do}"; use click, type, press, hover, select, drag, scroll, wait or goto`);
  }
}

async function payoff(page) {
  const { top, below } = await page.evaluate(() => ({
    top: window.scrollY,
    below: Math.max(document.body.scrollHeight - window.innerHeight - window.scrollY, 0),
  }));
  if (below < 240) return null;
  const reach = Math.min(below, 720);
  const steps = 6;
  for (let step = 1; step <= steps; step += 1) {
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), Math.round(top + (reach * step) / steps));
    await page.waitForTimeout(Math.round((payoffSeconds * 1000) / steps));
  }
  return top;
}

async function glideDown(page) {
  const height = await page.evaluate(() => Math.max(document.body.scrollHeight - window.innerHeight, 0));
  const reach = Math.min(height, 1400);
  const steps = 8;
  await page.waitForTimeout(700);
  for (let step = 1; step <= steps; step += 1) {
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), Math.round((reach * step) / steps));
    await page.waitForTimeout(380);
  }
  await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await page.waitForTimeout(900);
}

function stepFailure(shot, index, error, seen) {
  const failure = new Error(String(error && error.message ? error.message : error).split("\n")[0]);
  failure.report = { on_page: seen, shot: shot.name, step: index + 1 };
  return failure;
}

async function newContext(browser, plan, options) {
  const context = await browser.newContext({ viewport: desktop, ignoreHTTPSErrors: true, ...options });
  if (plan.headers) {
    await context.route(`${new URL(plan.base).origin}/**`, (route) =>
      route.continue({ headers: { ...route.request().headers(), ...plan.headers } }),
    );
  }
  return context;
}

async function prepare(browser, plan, out) {
  if (!plan.before) return null;
  const context = await newContext(browser, plan, {});
  const page = await context.newPage();
  const hand = pointer(page);
  const shot = { name: "before" };
  try {
    await open(page, plan.base + String(plan.before.path || "/"));
    for (let index = 0; index < plan.before.steps.length; index += 1) {
      try {
        await perform(page, hand, plan.before.steps[index], () => {}, plan.base);
      } catch (error) {
        throw stepFailure(shot, index, error, await onPage(page));
      }
    }
    const state = path.join(out, "state.json");
    await context.storageState({ path: state });
    return state;
  } finally {
    await context.close();
  }
}

async function filmShot(browser, plan, shot, out, state) {
  const recordDir = path.join(out, "rec", shot.name);
  fs.rmSync(recordDir, { recursive: true, force: true });
  fs.mkdirSync(recordDir, { recursive: true });
  const context = await newContext(browser, plan, {
    recordVideo: { dir: recordDir, size: desktop },
    reducedMotion: "no-preference",
    storageState: state || undefined,
  });
  const startedAt = Date.now();
  const seconds = () => (Date.now() - startedAt) / 1000;
  const page = await context.newPage();
  page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
  const hand = pointer(page);
  const windows = [];
  const frames = [];
  let filmedShot = null;

  const frame = async (label) => {
    const file = `${shot.name}-${label}.jpg`;
    await page.screenshot({ path: path.join(out, file), type: "jpeg", quality: 60 }).catch(() => {});
    if (fs.existsSync(path.join(out, file))) frames.push(file);
  };

  try {
    await open(page, plan.base + shot.path);
    await hand.ensure();
    await page.waitForTimeout(300);
    const readyAt = seconds();
    await frame("open");
    let lastFocus = null;

    for (let index = 0; index < shot.steps.length; index += 1) {
      const previous = windows.length ? windows[windows.length - 1].to : readyAt;
      let from = Math.max(seconds() - leadSeconds, previous);
      let speed = 1;
      const segments = [];
      const shift = (next) => {
        const now = seconds();
        if (now > from) segments.push({ from, to: now, speed });
        from = now;
        speed = next;
      };
      let focus;
      try {
        focus = await perform(page, hand, shot.steps[index], shift, plan.base);
      } catch (error) {
        throw stepFailure(shot, index, error, await onPage(page));
      }
      const to = seconds();
      if (to > from) segments.push({ from, to, speed });
      segments.forEach((segment, i) => windows.push({ ...segment, focus: i === 0 ? focus || null : null }));
      if (focus) lastFocus = focus;
      if (index < shot.steps.length - 1) await frame(`step${index + 1}`);
    }

    if (lastFocus) {
      const aside = {
        x: Math.min(lastFocus.x * desktop.width + 70, desktop.width - 20),
        y: Math.min(lastFocus.y * desktop.height + 60, desktop.height - 20),
      };
      await hand.glide(aside.x, aside.y, 300, false);
    }
    await page.waitForTimeout(Math.round((holdSeconds + endMarginSeconds) * 1000));
    const captureAt = seconds();
    const actionWindows = chosenWindows(windows, captureAt);
    const actionSeconds = actionWindows.reduce((sum, window) => sum + outputSeconds(window), 0);
    const focus = [...windows].reverse().map((entry) => entry.focus).find(Boolean) || null;
    const lastStep = shot.steps[shot.steps.length - 1];
    const endsOnAnswer = Boolean(lastStep && lastStep.do === "wait" && lastStep.for);

    await hand.hide();
    const desktopFile = `${shot.name}.jpg`;
    const phoneFile = `${shot.name}-phone.jpg`;
    await page.screenshot({ path: path.join(out, desktopFile), type: "jpeg", quality: 85 });
    await hand.ensure();

    let clipWindows = [...actionWindows];
    if (actionSeconds < clipFloorSeconds) {
      const clipStart = seconds();
      await hand.hide();
      await hand.park();
      await glideDown(page);
      clipWindows = [[round2(clipStart), round2(Math.min(seconds(), clipStart + clipBudgetSeconds)), 1]];
    } else if (!endsOnAnswer && actionSeconds + payoffSeconds <= clipBudgetSeconds) {
      const payoffStart = seconds();
      await hand.hide();
      await hand.park();
      const top = await payoff(page);
      if (top !== null) {
        const payoffEnd = Math.min(seconds(), payoffStart + clipBudgetSeconds - actionSeconds);
        clipWindows = [...actionWindows, [round2(payoffStart), round2(payoffEnd), 1]];
        await frame("scrolled");
        await page.evaluate((y) => window.scrollTo({ top: y }), top);
      }
    }
    if (seconds() > shotSecondsCap) throw new Error(`the shot ran past ${shotSecondsCap} seconds; give it fewer steps or shorter waits`);
    await page.waitForTimeout(resizeMarginMs);

    await hand.hide();
    let phoneShot = null;
    try {
      await page.setViewportSize(phone);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(out, phoneFile), type: "jpeg", quality: 82 });
      phoneShot = phoneFile;
    } catch {
      phoneShot = null;
    }

    filmedShot = {
      caption: shot.caption,
      desktop: desktopFile,
      focus: actionSeconds < clipFloorSeconds ? null : focus,
      frames,
      name: shot.name,
      phone: phoneShot,
      seconds: round2(clipWindows.reduce((sum, window) => sum + outputSeconds(window), 0)),
      title: shot.title,
      trimmed: actionWindows.trimmed === true,
      windows: clipWindows,
    };
  } catch (error) {
    if (!error.report) error.report = { on_page: await onPage(page), shot: shot.name, step: null };
    throw error;
  } finally {
    const video = page.video();
    await context.close();
    if (video && filmedShot) {
      const recording = `${shot.name}.webm`;
      fs.renameSync(await video.path(), path.join(out, recording));
      filmedShot.video = recording;
    }
    fs.rmSync(recordDir, { recursive: true, force: true });
    if (!filmedShot) frames.forEach((file) => fs.rmSync(path.join(out, file), { force: true }));
  }
  return filmedShot;
}

async function contactSheet(browser, out, shots) {
  const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 200 } });
  const page = await context.newPage();
  try {
    const picture = (file) => `data:image/jpeg;base64,${fs.readFileSync(path.join(out, file)).toString("base64")}`;
    const rows = shots
      .map((shot) => {
        const label = `${shot.name}: ${shot.title}`.replace(/[<&]/g, " ");
        const between = (shot.frames || []).slice(1).slice(-2);
        const moments = [(shot.frames || [])[0], ...between, shot.desktop]
          .filter((file) => file && fs.existsSync(path.join(out, file)))
          .map((file) => `<img src="${picture(file)}">`)
          .join("");
        const phoneStill = shot.phone && fs.existsSync(path.join(out, shot.phone)) ? `<img class="phone" src="${picture(shot.phone)}">` : "";
        return `<section><h2>${label}</h2><div>${moments}${phoneStill}</div></section>`;
      })
      .join("");
    await page.setContent(
      `<html><body style="margin:0;padding:12px;background:#111;font:14px sans-serif;color:#fff">` +
        `<style>section{margin:0 0 14px}h2{font-size:15px;margin:0 0 4px}div{display:flex;gap:8px}img{width:22%;border:1px solid #333;align-self:flex-start}img.phone{width:6.5%}</style>${rows}</body></html>`,
    );
    await page.screenshot({ path: path.join(out, "contact.jpg"), type: "jpeg", quality: 72, fullPage: true });
    return "contact.jpg";
  } finally {
    await context.close();
  }
}

function readManifest(out) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "film.json"), "utf8"));
    return Array.isArray(manifest.shots) ? manifest : { shots: [] };
  } catch {
    return { shots: [] };
  }
}

async function film(args) {
  const out = path.resolve(String(args.out || ".vibeworks-film"));
  const plan = readPlan(path.resolve(String(args.plan || path.join(out, "plan.json"))));
  const wanted = typeof args.shot === "string" ? plan.shots.filter((shot) => shot.name === args.shot) : plan.shots;
  if (wanted.length === 0) throw new Error(`The plan has no shot named ${args.shot}`);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, ".gitignore"), "*\n");

  const playwright = loadPlaywright();
  if (!playwright) return { status: "needs_setup", next_step: "Run this script once with --setup, then film again." };
  let browser;
  try {
    browser = await launch(playwright);
  } catch (error) {
    return { status: "needs_setup", next_step: "Run this script once with --setup, then film again.", tried: error.tried };
  }

  try {
    const state = await prepare(browser, plan, out);
    const filmed = [];
    const failed = [];
    for (const shot of wanted) {
      try {
        filmed.push(await filmShot(browser, plan, shot, out, state));
      } catch (error) {
        if (/ffmpeg/i.test(String(error && error.message))) throw error;
        failed.push({ error: String(error && error.message ? error.message : error).split("\n")[0], ...error.report });
      }
    }
    const order = plan.shots.map((shot) => shot.name);
    const redone = [...filmed, ...failed].map((shot) => shot.name || shot.shot);
    const kept = readManifest(out).shots.filter((old) => !redone.includes(old.name));
    const shots = [...kept, ...filmed]
      .filter((shot) => order.includes(shot.name))
      .sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
    const contact = shots.length ? await contactSheet(browser, out, shots) : null;
    fs.writeFileSync(path.join(out, "film.json"), JSON.stringify({ contact, shots }, null, 2));
    const named = new Set(shots.flatMap((shot) => [shot.desktop, shot.phone, shot.video, ...(shot.frames || [])]));
    for (const file of fs.readdirSync(out)) {
      if (/\.(jpg|webm)$/.test(file) && file !== "contact.jpg" && !named.has(file)) fs.rmSync(path.join(out, file), { force: true });
    }
    const report = {
      contact: contact && path.join(out, contact),
      missing: order.filter((name) => !shots.some((shot) => shot.name === name)),
      shots: shots.map(({ desktop: still, frames: moments, name, phone: phoneStill, seconds: played, title, trimmed }) => ({
        name,
        opens_on: moments && moments[0] ? path.join(out, moments[0]) : null,
        phone: phoneStill ? path.join(out, phoneStill) : null,
        seconds: played,
        still: path.join(out, still),
        title,
        ...(trimmed ? { note: "The clip keeps only the last seven seconds; the first steps are not in it." } : {}),
      })),
    };
    return failed.length ? { failed, status: "step_failed", ...report } : { status: "filmed", ...report };
  } catch (error) {
    if (/ffmpeg/i.test(String(error && error.message))) {
      return { status: "needs_setup", next_step: "Run this script once with --setup, then film again." };
    }
    if (error.report) return { error: error.message, failed: [{ error: error.message, ...error.report }], status: "step_failed" };
    throw error;
  } finally {
    fs.rmSync(path.join(out, "rec"), { recursive: true, force: true });
    fs.rmSync(path.join(out, "state.json"), { force: true });
    await browser.close();
  }
}

async function look(args) {
  const out = path.resolve(String(args.out || ".vibeworks-film"));
  const plan = readPlan(path.resolve(String(args.plan || path.join(out, "plan.json"))), true);
  const route = typeof args.path === "string" ? args.path : "/";
  if (!route.startsWith("/")) throw new Error('--path must start with "/"');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, ".gitignore"), "*\n");
  const playwright = loadPlaywright();
  if (!playwright) return { status: "needs_setup", next_step: "Run this script once with --setup, then look again." };
  let browser;
  try {
    browser = await launch(playwright);
  } catch (error) {
    return { status: "needs_setup", next_step: "Run this script once with --setup, then look again.", tried: error.tried };
  }
  try {
    const state = await prepare(browser, plan, out);
    const context = await newContext(browser, plan, { storageState: state || undefined });
    const page = await context.newPage();
    await open(page, plan.base + route);
    const picture = path.join(out, "look.png");
    await page.screenshot({ path: picture, fullPage: true });
    const seen = await onPage(page);
    await context.close();
    return { on_page: seen, picture, status: "looked" };
  } catch (error) {
    if (error.report) return { error: error.message, failed: [{ error: error.message, ...error.report }], status: "step_failed" };
    throw error;
  } finally {
    fs.rmSync(path.join(out, "state.json"), { force: true });
    await browser.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.clean) {
    const out = path.resolve(String(args.out || ".vibeworks-film"));
    if (path.basename(out) !== ".vibeworks-film") throw new Error("--clean only removes a folder named .vibeworks-film");
    fs.rmSync(out, { recursive: true, force: true });
    console.log(JSON.stringify({ status: "cleaned" }));
    return;
  }
  if (args.setup) {
    const cli = setup();
    const browser = await setupBrowser(cli);
    console.log(JSON.stringify({ browser, home: filmHome(), status: "ready" }));
    return;
  }
  const outcome = args.look ? await look(args) : await film(args);
  console.log(JSON.stringify(outcome));
  process.exit(["filmed", "looked"].includes(outcome.status) ? 0 : 1);
}

if (require.main === module) {
  main().catch((error) => {
    console.log(JSON.stringify({ error: String(error && error.message ? error.message : error), status: "failed" }));
    process.exit(1);
  });
}

module.exports = { chosenWindows, readPlan };
