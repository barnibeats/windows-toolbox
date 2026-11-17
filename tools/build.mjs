// Builds dist/index.html: validates catalog.json and inlines it (plus downloads.json, if present)
// into index.html, so the published page is a single self-contained file.
//
//   node tools/build.mjs            → dist/index.html (from site/index.html)
//   node tools/build.mjs --check    → validate catalog.json only
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LANGS = ["en", "uk", "ru"];
const errors = [], warnings = [];

const catalog = JSON.parse(readFileSync(join(root, "catalog.json"), "utf8"));

// ---- validation -----------------------------------------------------------------------
const isText = v => typeof v === "string" && v.trim() !== "";
const checkI18n = (v, where, required = LANGS) => {
  if (isText(v)) return;
  if (!v || typeof v !== "object") return errors.push(`${where}: expected text or {en, uk, ru}`);
  for (const l of required) if (!isText(v[l])) errors.push(`${where}: missing "${l}"`);
};
const seenRepos = new Map(), seenIds = new Set();
let apps = 0;
(catalog.sections || []).forEach((s, si) => {
  const where = `sections[${si}] (${s.id || "?"})`;
  if (!/^[a-z][a-z0-9-]*$/.test(s.id || "")) errors.push(`${where}: id must be lowercase latin`);
  if (seenIds.has(s.id)) errors.push(`${where}: duplicate section id`);
  seenIds.add(s.id);
  checkI18n(s.title, `${where}.title`);
  checkI18n(s.desc, `${where}.desc`);
  if (s.note) checkI18n(s.note, `${where}.note`);
  if (!s.groups && !s.special) errors.push(`${where}: needs "groups" or "special"`);
  (s.groups || []).forEach((g, gi) => {
    checkI18n(g.name, `${where}.groups[${gi}].name`);
    (g.items || []).forEach((it, ii) => {
      const w = `${where} › ${typeof g.name === "string" ? g.name : g.name?.en} › ${it.n || "#" + ii}`;
      apps++;
      if (!isText(it.n)) errors.push(`${w}: missing name "n"`);
      if (!isText(it.r)) errors.push(`${w}: missing repo "r"`);
      else if (!/^https?:\/\//.test(it.r) && !/^[\w.-]+(\/[\w.-]+)?$/.test(it.r)) errors.push(`${w}: "r" must be owner/repo or a URL`);
      if (it.w !== undefined && !/^[A-Za-z0-9][A-Za-z0-9.+_-]*\.[A-Za-z0-9.+_-]+$/.test(it.w)) errors.push(`${w}: bad winget id "${it.w}"`);
      if (!it.d || !isText(it.d.ru)) errors.push(`${w}: missing Russian description d.ru`);
      else for (const l of ["en", "uk"]) if (!isText(it.d[l])) warnings.push(`${w}: no "${l}" description (falls back to ru)`);
      const key = (it.r || "").toLowerCase();
      if (seenRepos.has(key)) errors.push(`${w}: duplicate of ${seenRepos.get(key)}`);
      seenRepos.set(key, w);
    });
  });
});
if (!apps) errors.push("catalog has no apps");
for (const k of Object.keys(catalog.downloadOverrides || {}))
  if (!seenRepos.has(k.toLowerCase())) warnings.push(`downloadOverrides["${k}"] matches no app`);

for (const w of warnings) console.log("warning:", w);
if (errors.length) {
  for (const e of errors) console.error("error:", e);
  console.error(`\ncatalog.json has ${errors.length} error(s) — nothing was built.`);
  process.exit(1);
}
console.log(`catalog.json OK: ${catalog.sections.length} sections, ${apps} apps`);
if (process.argv.includes("--check")) process.exit(0);

// ---- inline into the page ---------------------------------------------------------------
const safeJson = v => JSON.stringify(v).replace(/</g, "\\u003c");   // never closes the <script> tag
const dlPath = join(root, "downloads.json");
const downloads = existsSync(dlPath) ? JSON.parse(readFileSync(dlPath, "utf8")) : {};
let html = readFileSync(join(root, "site", "index.html"), "utf8");
const fill = (id, data) => {
  const re = new RegExp(`(<script id="${id}" type="application/json">)[\\s\\S]*?(</script>)`);
  if (!re.test(html)) { console.error(`index.html has no <script id="${id}"> placeholder`); process.exit(1); }
  html = html.replace(re, (_, a, b) => a + safeJson(data) + b);
};
fill("catalog-data", catalog);
fill("downloads-data", downloads);

// "built=<date of the last source commit>": the exe uses it to prefer the newer of its embedded
// page and the cached remote one. A commit date (not "now") keeps daily rebuilds byte-identical.
let built = process.env.SOURCE_DATE || "";
if (!built) try { built = execFileSync("git", ["-C", root, "log", "-1", "--format=%cI"], { encoding: "utf8" }).trim(); } catch {}
if (!built) built = new Date().toISOString();
built = new Date(built).toISOString().replace(/\.\d+Z$/, "Z");
html = html.replace(/<!-- windows-toolbox-page[^>]*-->/, `<!-- windows-toolbox-page built=${built} -->`);
mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist", "index.html"), html);
console.log(`dist/index.html written (${(html.length / 1024).toFixed(0)} KB, downloads for ${Object.keys(downloads.apps || {}).length} apps)`);
