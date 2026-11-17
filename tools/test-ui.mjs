// UI contract tests for dist/index.html, driven by a real Chrome/Edge through playwright-core.
// They pin what the desktop app and users rely on (host bridge messages, stable ids/classes,
// storage keys), not how the page looks, so the UI can be redesigned freely.
//
//   node --test tools/test-ui.mjs            (CHROME=<path> picks the browser, PAGE_FILE=<path> the page)
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pageFile = process.env.PAGE_FILE || join(root, "dist", "index.html");
if (!existsSync(pageFile)) throw new Error(`${pageFile} not found, run "node tools/build.mjs" first`);
const PAGE = pathToFileURL(pageFile).href;

// ---- catalog facts the tests assert against -----------------------------------------------
const catalog = JSON.parse(readFileSync(join(root, "catalog.json"), "utf8"));
const items = catalog.sections.flatMap(s => (s.groups || []).flatMap(g => g.items));
const withW = items.filter(i => i.w), withoutW = items.filter(i => !i.w);
const [A, B] = withW, C = withoutW[0];
assert.ok(A && B && C, "catalog needs two apps with a winget id and one without");

// ---- browser ---------------------------------------------------------------------------------
const candidates = [process.env.CHROME, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].filter(Boolean);
const executablePath = candidates.find(b => { try { execFileSync(b, ["--version"], { stdio: "ignore" }); return true; } catch { return existsSync(b); } });
if (!executablePath) throw new Error("no Chrome/Edge found (set CHROME=<path>)");

let browser;
before(async () => { browser = await chromium.launch({ executablePath, headless: true }); });
after(async () => { await browser?.close(); });

/** Opens the page in a fresh browser context. With host:true a fake WebView2 bridge is installed. */
async function openPage({ host = false, lang = "en", viewport = { width: 1280, height: 900 }, storage = {}, hash = "", appv = "1.3.0" } = {}) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(({ host, storage }) => {
    try { if (!sessionStorage.__seeded) { for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v); sessionStorage.__seeded = "1"; } } catch {}
    window.__sent = []; window.__listeners = [];
    window.__clip = null;
    try { Object.defineProperty(navigator, "clipboard", { value: { writeText: async t => { window.__clip = t; } }, configurable: true }); } catch {}
    if (host) {
      window.chrome = window.chrome || {};
      window.chrome.webview = {
        postMessage: m => window.__sent.push(JSON.parse(m)),
        addEventListener: (t, fn) => { if (t === "message") window.__listeners.push(fn); },
        removeEventListener() {},
      };
    }
  }, { host, storage });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("dialog", d => d.accept(page.__promptAnswer || ""));
  const qs = `?lang=${lang}` + (host ? `&host=2&appv=${appv}` : "");
  await page.goto(PAGE + qs + hash);
  await page.waitForSelector('body[data-ready="1"]');
  return {
    page, context, errors,
    sent: () => page.evaluate(() => window.__sent.slice()),
    fromHost: msg => page.evaluate(m => window.__listeners.forEach(f => f({ data: m })), msg),
    clip: () => page.evaluate(() => window.__clip),
    close: () => context.close(),
  };
}
const card = (page, repo) => page.locator("div.card").and(page.locator(`[data-key=${JSON.stringify(repo)}]`));
const jsClick = loc => loc.evaluate(el => el.click());   // layout-independent: a sticky header can cover a coordinate click
const installBtn = (page, w) => page.locator(`.btn.inst[data-w=${JSON.stringify(w)}]`);
const scanFixture = ids => ({ type: "scan", installed: JSON.stringify({ Sources: [{ Packages: ids.map(id => ({ PackageIdentifier: id })) }] }), upgrades: "" });

// ---- 1-2 rendering ---------------------------------------------------------------------------
test("renders one card per catalog app in en, uk, ru", async () => {
  for (const lang of ["en", "uk", "ru"]) {
    const t = await openPage({ lang });
    assert.equal(await t.page.locator("div.card").count(), items.length, lang);
    await t.close();
  }
});

test("sets data-ready and html lang", async () => {
  for (const lang of ["en", "uk", "ru"]) {
    const t = await openPage({ lang });
    assert.equal(await t.page.getAttribute("html", "lang"), lang);
    assert.equal(await t.page.getAttribute("body", "data-ready"), "1");
    await t.close();
  }
});

// ---- 3 search --------------------------------------------------------------------------------
test("search filters cards; no match shows #empty; regex characters do not throw", async () => {
  const t = await openPage();
  await t.page.fill("#q", A.n);
  const visible = await t.page.locator("div.card:visible").count();
  assert.ok(visible >= 1 && visible < items.length, `visible=${visible}`);
  assert.ok(await card(t.page, A.r).isVisible());
  assert.ok(!(await t.page.locator("#empty").isVisible()));
  for (const text of ["zzzz-no-such-app-qqqq", "(", "[a", "\\", ".*"]) {
    await t.page.fill("#q", text);
    if (text === "zzzz-no-such-app-qqqq") assert.ok(await t.page.locator("#empty").isVisible(), "empty state");
  }
  await t.page.fill("#q", "");
  assert.equal(await t.page.locator("div.card:visible").count(), items.length);
  assert.deepEqual(t.errors, []);
  await t.close();
});

// ---- 4 install buttons only where they can work ----------------------------------------------
test("install buttons: none without host or winget; with winget exactly for entries having a winget id", async () => {
  let t = await openPage();
  assert.equal(await t.page.locator(".btn.inst").count(), 0, "no host");
  await t.close();

  t = await openPage({ host: true });
  assert.equal(await t.page.locator(".btn.inst").count(), 0, "host but winget unknown");
  await t.fromHost({ type: "hello", version: "1.3.0", winget: false });
  assert.equal(await t.page.locator(".btn.inst").count(), 0, "winget missing");
  await t.fromHost({ type: "hello", version: "1.3.0", winget: true });
  const ids = await t.page.locator(".btn.inst").evaluateAll(els => els.map(e => e.dataset.w).sort());
  assert.deepEqual(ids, withW.map(i => i.w).sort());
  assert.equal(await card(t.page, C.r).locator(".btn.inst").count(), 0, "entry without winget id has no install button");
  assert.ok(await card(t.page, C.r).locator("a.btn.gh, .btn.dl").first().count() >= 1, "fallback link/download remains");
  await t.close();
});

// ---- 5 handshake -----------------------------------------------------------------------------
test("host handshake: first message is {cmd:'ready', lang}", async () => {
  const t = await openPage({ host: true, lang: "uk" });
  const sent = await t.sent();
  assert.deepEqual(sent[0], { cmd: "ready", lang: "uk" });
  await t.close();
});

// ---- 6 scan ----------------------------------------------------------------------------------
test("scan marks installed (.done) and upgradable (.upg) apps", async () => {
  const t = await openPage({ host: true });
  await t.fromHost({ type: "hello", winget: true });
  await t.fromHost({ type: "scan", installed: scanFixture([A.w]).installed, upgrades: `Name Id Version Available\n----\nSomething ${B.w} 1.0 2.0\n` });
  assert.ok((await installBtn(t.page, A.w).getAttribute("class")).split(/\s+/).includes("done"));
  assert.ok((await installBtn(t.page, B.w).getAttribute("class")).split(/\s+/).includes("upg"));
  await t.close();
});

// ---- 7 install click -------------------------------------------------------------------------
test("clicking install sends {cmd:'install', ids, names, lang} and marks the button busy", async () => {
  const t = await openPage({ host: true });
  await t.fromHost({ type: "hello", winget: true });
  await jsClick(installBtn(t.page, A.w));
  const sent = await t.sent();
  assert.deepEqual(sent.at(-1), { cmd: "install", ids: [A.w], names: [A.n], lang: "en" });
  assert.ok((await installBtn(t.page, A.w).getAttribute("class")).split(/\s+/).includes("busy"));
  await t.close();
});

// ---- 8 progress and hostile messages ---------------------------------------------------------
test("progress transitions; unknown ids and malformed messages are ignored", async () => {
  const t = await openPage({ host: true });
  await t.fromHost({ type: "hello", winget: true });
  const cls = async w => (await installBtn(t.page, w).getAttribute("class")).split(/\s+/);
  await t.fromHost({ type: "progress", id: A.w, state: "running" });
  assert.ok((await cls(A.w)).includes("busy"));
  await t.fromHost({ type: "progress", id: A.w, state: "done" });
  assert.ok((await cls(A.w)).includes("done"));
  assert.ok((await t.page.locator("#toast").textContent()).trim().length > 0, "toast on done");
  await t.fromHost({ type: "progress", id: B.w, state: "error", code: "0x80070005" });
  assert.ok((await cls(B.w)).includes("err"));
  const D = withW[2];
  await t.fromHost({ type: "progress", id: D.w, state: "queued" });
  await t.fromHost({ type: "progress", id: D.w, state: "cancelled" });
  assert.ok(!(await cls(D.w)).some(c => ["busy", "err", "done"].includes(c)), "cancelled clears the state");
  for (const bad of [{ type: "progress", id: "No.Such.App", state: "done" }, { type: "progress" }, { foo: 1 }, "garbage", null, 42,
    { type: "scan", installed: "not json", upgrades: 7 }, { type: "scan", installed: 5 }, { type: "update", state: "weird" }])
    await t.fromHost(bad);
  assert.deepEqual(t.errors, []);
  await t.close();
});

// ---- 9 selection -----------------------------------------------------------------------------
async function pick(t, ...apps) {
  if (!(await t.page.evaluate(() => document.body.classList.contains("selecting")))) await t.page.click("#selBtn");
  for (const a of apps) await jsClick(card(t.page, a.r).locator(".pick input"));
}
test("selection: #selCount follows the picks; #selInstall sends only installable, not-yet-installed ids", async () => {
  const t = await openPage({ host: true });
  await t.fromHost({ type: "hello", winget: true });
  await t.fromHost(scanFixture([A.w]));
  await pick(t, A, B, C);
  assert.match(await t.page.textContent("#selCount"), /3/);
  assert.equal(await t.page.locator("div.card.picked").count(), 3);
  await t.page.click("#selInstall");
  assert.deepEqual((await t.sent()).at(-1), { cmd: "install", ids: [B.w], names: [B.n], lang: "en" });
  await t.page.click("#selClear");
  assert.equal(await t.page.locator("div.card.picked").count(), 0);
  await t.close();
});

// ---- 10 sets, share links, script ------------------------------------------------------------
test("sets: save, list, reload; share link restores the selection; bad links are ignored; script lists winget ids", async () => {
  const t = await openPage();
  t.page.__promptAnswer = "My set";
  await pick(t, A, B, C);
  await t.page.click("#selSave");
  assert.deepEqual(JSON.parse(await t.page.evaluate(() => localStorage.getItem("toolbox.sets.v1"))).map(s => [s.name, s.keys.length]), [["My set", 3]]);
  await t.page.click("#selClear");
  await t.page.click("#selSets");
  assert.match(await t.page.textContent("#setList"), /My set/);
  await t.page.click("#setList [data-load]");
  assert.equal(await t.page.locator("div.card.picked").count(), 3);

  await t.page.click("#selShare");
  const link = await t.clip();
  assert.match(link, /#set=/);
  const hash = link.slice(link.indexOf("#"));
  const t2 = await openPage({ hash });
  assert.equal(await t2.page.locator("div.card.picked").count(), 3, "share link restores the picks");
  await t2.close();
  for (const bad of ["#set=no%2Fsuch-repo", "#set=", "#garbage", "#set=%E0%A4%A"]) {
    const t3 = await openPage({ hash: bad });
    assert.equal(await t3.page.locator("div.card.picked").count(), 0, bad);
    assert.deepEqual(t3.errors, [], bad);
    await t3.close();
  }

  await t.page.click("#selScript");
  const script = await t.page.inputValue("#scriptText");
  assert.ok(script.includes(`"${A.w}"`) && script.includes(`"${B.w}"`));
  assert.match(script, /winget install --id/);
  assert.ok(script.includes(C.n), "app without a winget id is listed as manual");
  await t.close();
});

// ---- 11 update banner ------------------------------------------------------------------------
test("update banner: available, ready (restart sends applyUpdate), none, dismissed version stays hidden", async () => {
  const t = await openPage({ host: true });
  assert.ok(!(await t.page.locator("#upd").isVisible()));
  await t.fromHost({ type: "update", state: "available", version: "v9.9.9", url: "https://example.test/WindowsToolbox.exe" });
  assert.ok(await t.page.locator("#upd").isVisible());
  assert.match(await t.page.textContent("#updMsg"), /9\.9\.9/);
  assert.equal(await t.page.getAttribute("#updLink", "href"), "https://example.test/WindowsToolbox.exe");
  await t.fromHost({ type: "update", state: "ready", version: "v9.9.9", url: "" });
  assert.ok(await t.page.locator("#updRestart").isVisible());
  await t.page.click("#updRestart");
  assert.deepEqual((await t.sent()).at(-1), { cmd: "applyUpdate" });
  await t.fromHost({ type: "update", state: "none" });
  assert.ok(!(await t.page.locator("#upd").isVisible()));
  await t.fromHost({ type: "update", state: "available", version: "v9.9.9", url: "https://example.test/x.exe" });
  await t.page.click("#updX");
  assert.ok(!(await t.page.locator("#upd").isVisible()));
  assert.equal(await t.page.evaluate(() => localStorage.getItem("toolbox.skipVersion")), "v9.9.9");
  await t.page.reload();
  await t.page.waitForSelector('body[data-ready="1"]');
  await t.fromHost({ type: "update", state: "available", version: "v9.9.9", url: "https://example.test/x.exe" });
  assert.ok(!(await t.page.locator("#upd").isVisible()), "skipped version stays hidden after reload");
  await t.close();
});

// ---- 12 language and theme -------------------------------------------------------------------
test("language switch persists toolbox.lang and tells the host; theme toggle persists 'theme'", async () => {
  const t = await openPage({ host: true });
  await t.page.click('#lang [data-l="uk"]');
  assert.equal(await t.page.getAttribute("html", "lang"), "uk");
  assert.equal(await t.page.evaluate(() => localStorage.getItem("toolbox.lang")), "uk");
  assert.deepEqual((await t.sent()).at(-1), { cmd: "lang", lang: "uk" });
  const before = await t.page.evaluate(() => document.documentElement.dataset.theme);
  await t.page.click("#theme");
  const after = await t.page.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem("theme")]);
  assert.notEqual(after[0], before);
  assert.equal(after[1], after[0]);
  await t.close();
});

// ---- 13 corrupt storage ----------------------------------------------------------------------
test("corrupt localStorage still renders every card and an empty sets list", async () => {
  const bad = Object.fromEntries(["toolbox.sets.v1", "toolbox.edits.v1", "toolbox.lang", "theme", "toolbox.skipVersion"].map(k => [k, "{"]));
  const t = await openPage({ storage: bad });
  assert.equal(await t.page.locator("div.card").count(), items.length);
  await t.page.click("#selBtn");
  await t.page.click("#selSets");
  assert.equal(await t.page.locator("#setList .setrow").count(), 0);
  assert.deepEqual(t.errors, []);
  await t.close();
});

// ---- 14 phone width, console clean -----------------------------------------------------------
test("375px wide: no horizontal scroll and no console errors in any language", async () => {
  for (const lang of ["en", "uk", "ru"]) {
    const t = await openPage({ lang, viewport: { width: 375, height: 800 }, host: true });
    await t.fromHost({ type: "hello", winget: true });
    const [sw, iw] = await t.page.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth]);
    assert.ok(sw <= iw, `${lang}: scrollWidth ${sw} > ${iw}`);
    assert.deepEqual(t.errors, [], lang);
    await t.close();
  }
});

// ---- 15 offline notice -----------------------------------------------------------------------
test("offline notice (#offline) appears when the connection drops and disappears when it returns", async () => {
  const t = await openPage();
  assert.ok(!(await t.page.locator("#offline").isVisible()));
  await t.context.setOffline(true);
  await t.page.waitForSelector("#offline", { state: "visible" });
  await t.context.setOffline(false);
  await t.page.waitForSelector("#offline", { state: "hidden" });
  await t.close();
});

// ---- 16-18 behaviours added with the redesign ----------------------------------------------
test("'/' focuses the search and Escape clears it", async () => {
  const t = await openPage();
  await t.page.keyboard.press("/");
  assert.equal(await t.page.evaluate(() => document.activeElement.id), "q");
  await t.page.keyboard.type("windhawk");
  assert.ok((await t.page.locator("div.card:visible").count()) < items.length);
  await t.page.keyboard.press("Escape");
  assert.equal(await t.page.inputValue("#q"), "");
  assert.equal(await t.page.locator("div.card:visible").count(), items.length);
  await t.close();
});

test("the set bar prints the winget command for the picks, live", async () => {
  const t = await openPage();
  await t.page.click("#selBtn");
  const idle = await t.page.textContent("#selCmd");
  assert.ok(!idle.includes("winget install"), "idle text before any pick");
  await pick(t, A, C);
  assert.equal(await t.page.textContent("#selCmd"), `winget install --id ${A.w}`);
  await pick(t, B);
  assert.equal(await t.page.textContent("#selCmd"), `winget install --id ${A.w}; winget install --id ${B.w}`);
  await t.page.click("#selClear");
  assert.equal(await t.page.textContent("#selCmd"), idle);
  await t.close();
});

test("tricks and safety sections render every entry and the copy button copies the command", async () => {
  const t = await openPage();
  assert.equal(await t.page.locator(".key").count(), catalog.keys.length);
  assert.equal(await t.page.locator(".tip").count(), catalog.tips.length);
  assert.equal(await t.page.locator(".cmd").count(), catalog.cmds.length);
  assert.equal(await t.page.locator(".warn li").count(), catalog.safety.length);
  await t.page.locator(".cmd .copy").first().evaluate(el => el.click());
  await t.page.waitForFunction(() => window.__clip);
  assert.equal(await t.clip(), catalog.cmds[0].c.en);
  await t.close();
});
