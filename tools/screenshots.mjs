// Renders dist/index.html into the README screenshots and the social-preview image.
//   node tools/build.mjs && node tools/screenshots.mjs        (CHROME=<path> picks the browser)
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = join(root, "dist", "index.html");
if (!existsSync(page)) throw new Error('dist/index.html not found, run "node tools/build.mjs" first');
const out = join(root, "docs", "screenshots");
mkdirSync(out, { recursive: true });

const catalog = JSON.parse(readFileSync(join(root, "catalog.json"), "utf8"));
const appCount = catalog.sections.reduce((n, s) => n + (s.groups || []).reduce((m, g) => m + g.items.length, 0), 0);

const candidates = [process.env.CHROME, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe"].filter(Boolean);
const executablePath = candidates.find(b => { try { execFileSync(b, ["--version"], { stdio: "ignore" }); return true; } catch { return existsSync(b); } });
if (!executablePath) throw new Error("no Chrome/Edge found (set CHROME=<path>)");
const browser = await chromium.launch({ executablePath });

async function shot(file, { width = 1440, height = 900, theme = "light", host = false, scale = 1, act } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, deviceScaleFactor: scale });
  await ctx.addInitScript(({ host, theme }) => {
    localStorage.setItem("theme", theme);
    if (host) window.chrome = { webview: { postMessage() {}, addEventListener(t, f) { window.__host = f; } } };
  }, { host, theme });
  const p = await ctx.newPage();
  await p.goto(pathToFileURL(page).href + "?lang=en" + (host ? "&host=2&appv=1.3.0" : ""));
  await p.waitForSelector('body[data-ready="1"]');
  if (act) await act(p);
  await p.waitForTimeout(900);
  await p.screenshot({ path: join(out, file) });
  await ctx.close();
}
const toTab = async (p, id) => { await p.click(`.tab[data-id="${id}"]`); await p.waitForTimeout(1500); };

await shot("hero.png");
await shot("dark.png", { theme: "dark", act: p => toTab(p, "games") });
await shot("mobile.png", { width: 390, height: 844, scale: 2 });
await shot("sets.png", { host: true, act: async p => {
  await p.evaluate(() => window.__host({ data: { type: "hello", winget: true } }));
  await p.evaluate(() => window.__host({ data: { type: "scan", upgrades: "", installed: JSON.stringify({ Sources: [{ Packages: [{ PackageIdentifier: "valinet.ExplorerPatcher" }] }] }) } }));
  await toTab(p, "custom");
  await p.click("#selBtn");
  for (const key of ["ramensoftware/windhawk", "valinet/ExplorerPatcher", "eythaann/Seelen-UI"]) {
    const box = p.locator(`div.card[data-key="${key}"] .pick input`);
    if (await box.count()) await box.evaluate(e => e.click());
  }
  await p.evaluate(() => window.scrollBy(0, -40));
} });

// social preview (1280x640): the wordmark and a few real catalog rows
const names = ["Windhawk", "PowerToys", "OBS Studio"].map(n => catalog.sections.flatMap(s => (s.groups || []).flatMap(g => g.items)).find(i => i.n === n)).filter(Boolean);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 640 } });
const sp = await ctx.newPage();
await sp.setContent(`<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;width:1280px;height:640px;background:#E8EBED;color:#1C2125;display:grid;grid-template-columns:660px 1fr;align-items:center;gap:30px;padding:0 70px;font:28px/1.35 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif}
  h1{margin:0 0 22px;font:700 104px/0.98 "Bahnschrift","DIN Alternate","Arial Narrow",sans-serif;font-stretch:90%}
  p{margin:0;max-width:560px;color:#4B565E} .bar{width:120px;height:12px;background:#FFC20E;margin:0 0 30px}
  .rows{background:#fff;border:1px solid #D3D8DC;border-radius:12px;overflow:hidden}
  .r{display:flex;justify-content:space-between;align-items:center;padding:20px 24px;border-top:1px solid #D3D8DC}.r:first-child{border-top:0}
  .r b{display:block;font:600 30px "Bahnschrift","Arial Narrow",sans-serif} .r small{font-size:20px;color:#4B565E}
  .b{border:2px solid #1C2125;border-radius:8px;padding:6px 16px;font:600 20px "Segoe UI",sans-serif}
  .plate{display:inline-block;background:#1C2125;color:#F4F6F7;padding:6px 16px;border-radius:6px;font:600 26px "Bahnschrift","Arial Narrow",sans-serif;margin-top:34px}
</style><div><div class="bar"></div><h1>Windows<br>Toolbox</h1><p>${appCount} free open-source apps for Windows. Download them, or install in one click with winget.</p><span class="plate">EN  UA  RU</span></div>
<div class="rows">${names.map(i => `<div class="r"><div><b>${i.n}</b><small>${i.d.en}</small></div><span class="b">Install</span></div>`).join("")}</div>`);
await sp.waitForTimeout(400);
await sp.screenshot({ path: join(root, "docs", "social-preview.png") });
await browser.close();
console.log("screenshots written to docs/");
