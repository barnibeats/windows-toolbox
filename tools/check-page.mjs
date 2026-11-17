// Smoke test of dist/index.html before it is published to everyone:
//   1) every inline script compiles;
//   2) in a real headless browser, in each language, the page finishes rendering
//      (<body data-ready="1">) and shows one card per app in catalog.json.
//
//   node tools/check-page.mjs          (CHROME=<path> to pick the browser)
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = join(root, "dist", "index.html");
const fail = msg => { console.error("FAIL:", msg); process.exit(1); };
if (!existsSync(page)) fail("dist/index.html not found — run node tools/build.mjs first");

const html = readFileSync(page, "utf8");
const catalog = JSON.parse(readFileSync(join(root, "catalog.json"), "utf8"));
const expected = catalog.sections.reduce((n, s) => n + (s.groups || []).reduce((m, g) => m + g.items.length, 0), 0);

// 1) syntax of inline scripts (JSON blocks are checked by build.mjs)
const scripts = [...html.matchAll(/<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((code, i) => { try { new vm.Script(code, { filename: `inline-script-${i}.js` }); } catch (e) { fail(`script #${i}: ${e.message}`); } });
console.log(`scripts compile: ${scripts.length}`);

// 2) render in a headless browser
const candidates = [process.env.CHROME,
  "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].filter(Boolean);
const browser = candidates.find(b => { try { execFileSync(b, ["--version"], { stdio: "ignore" }); return true; } catch { return existsSync(b); } });
if (!browser) fail("no Chrome/Edge found (set CHROME=<path>)");

for (const lang of ["en", "uk", "ru"]) {
  const url = pathToFileURL(page).href + "?lang=" + lang;
  const dom = execFileSync(browser, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
    `--user-data-dir=${join(tmpdir(), "toolbox-check-" + lang + "-" + Date.now())}`,
    "--virtual-time-budget=8000", "--dump-dom", url], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
  if (!/<body[^>]*data-ready="1"/.test(dom)) fail(`[${lang}] page did not finish rendering (script error?)`);
  if (!new RegExp(`<html[^>]*lang="${lang}"`).test(dom)) fail(`[${lang}] language was not applied`);
  const cards = (dom.match(/<div class="card(?: [^"]*)?"/g) || []).length;
  if (cards !== expected) fail(`[${lang}] ${cards} cards rendered, expected ${expected}`);
  console.log(`[${lang}] OK: ${cards} cards`);
}
console.log("page check passed");
