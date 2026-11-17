// Resolves, for every app in catalog.json, the best Windows download of its latest GitHub release
// plus repo facts (stars, archived, moved), and checks winget IDs against microsoft/winget-pkgs.
//
//   GITHUB_TOKEN=... node tools/resolve.mjs [--limit N]
//
// Writes downloads.json (inlined into the page by build.mjs) and problems.md (a report that the
// workflow turns into a GitHub issue). Without a token GitHub allows only 60 requests per hour.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(readFileSync(join(root, "catalog.json"), "utf8"));
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;

// Same scoring as the page's fallback (index.html → pickAsset); keep the two in sync.
const SKIP_EXT = /\.(sha\d*|sig|asc|txt|json|ya?ml|blockmap|pdb|sym|md5|dmg|pkg|appimage|deb|rpm|apk|aab|ipa|flatpak|snap|tar\.(gz|xz|bz2|zst)|tgz|xz)$/;
const SKIP_NAME = /(linux|macos|darwin|osx|android|ios|freebsd|source|src|debug|symbols|dbgsym)/;
function pickAsset(assets) {
  let best = null, bs = -1e9;
  for (const a of assets) {
    const n = a.name.toLowerCase();
    if (SKIP_EXT.test(n) || SKIP_NAME.test(n)) continue;
    let s;
    if (n.endsWith(".exe")) s = 50; else if (n.endsWith(".msi")) s = 45;
    else if (/\.msix(bundle)?$/.test(n)) s = 30; else if (n.endsWith(".zip")) s = 25;
    else if (n.endsWith(".7z")) s = 20; else continue;
    const win = /win/.test(n);
    if (win) s += 20;
    if (/(x64|amd64|x86_64|win64)/.test(n)) s += 10;
    if (/(arm64|aarch64|arm)/.test(n)) s -= 40;
    if (/(x86|win32|i386|i686)/.test(n) && !/x86_64/.test(n)) s -= 8;
    if (/(setup|install)/.test(n)) s += 4;
    if (/(\dto\d|update|patch|delta|uninstall)/.test(n)) s -= 30;
    if (!win && /\.(zip|7z)$/.test(n)) s -= 15;
    if (s > bs) { bs = s; best = a; }
  }
  return bs >= 10 ? best : null;
}

let calls = 0;
async function api(path) {
  calls++;
  const r = await fetch("https://api.github.com/" + path, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "windows-toolbox-resolver",
               ...(token ? { Authorization: "Bearer " + token } : {}) }
  });
  if (r.status === 403 || r.status === 429) throw new Error(`GitHub API limit reached after ${calls} calls`);
  return r;
}
// 2 significant digits: 12345 → 12000, so a few new stars don't change the file every day
const roundStars = n => n < 100 ? n : Number(n.toPrecision(2));

const apps = [];
for (const s of catalog.sections) for (const g of s.groups || []) for (const it of g.items) apps.push({ ...it, section: s.id });
const overrides = catalog.downloadOverrides || {};
const out = {}, problems = [], noWindows = [];

async function resolveApp(it) {
  const target = overrides[it.r] || it.r;
  const rec = {};
  if (target.startsWith("http")) {
    rec.k = /\.(zip|exe|msi|7z)$/i.test(target) ? "direct" : "site";
    rec.u = target;
  } else if (!target.includes("/")) {
    rec.k = "org"; rec.u = "https://github.com/" + target;
  }
  // repo facts for GitHub-hosted apps (even when downloads come from elsewhere)
  if (!it.r.startsWith("http") && it.r.includes("/")) {
    const r = await api("repos/" + it.r);
    if (r.status === 404) problems.push([it, "repository not found (deleted or private)"]);
    else if (r.ok) {
      const j = await r.json();
      rec.st = roundStars(j.stargazers_count);
      if (j.archived) { rec.ar = 1; if (!it.archived) problems.push([it, "repository is archived"]); }   // it.archived: known and kept on purpose
      if (j.full_name.toLowerCase() !== it.r.toLowerCase()) problems.push([it, `repository moved to \`${j.full_name}\``]);
    }
  }
  if (!rec.k) {
    let rel = null, r = await api(`repos/${target}/releases/latest`);
    if (r.ok) rel = await r.json();
    if (!rel || !(rel.assets || []).length) {
      r = await api(`repos/${target}/releases?per_page=6`);
      if (r.ok) rel = (await r.json()).find(x => !x.draft && x.assets && x.assets.length) || rel;
    }
    const a = rel && pickAsset(rel.assets || []);
    if (a) Object.assign(rec, { k: "file", u: a.browser_download_url, f: a.name, s: a.size });
    else { rec.k = "page"; rec.u = `https://github.com/${target}/releases`; noWindows.push(it); }
    if (rel) { rec.t = rel.tag_name; rec.at = (rel.published_at || rel.created_at || "").slice(0, 10); }
  }
  if (it.w) {
    const p = it.w.split(".").map(encodeURIComponent).join("/");
    const r = await api(`repos/microsoft/winget-pkgs/contents/manifests/${it.w[0].toLowerCase()}/${p}`);
    if (r.status === 404) problems.push([it, `winget ID \`${it.w}\` not found in winget-pkgs`]);
  }
  out[it.r] = rec;
}

const queue = apps.slice(0, limit);
let failed = null;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length && !failed) {
    const it = queue.shift();
    try { await resolveApp(it); }
    catch (e) { if (/limit/.test(e.message)) failed = e; else problems.push([it, "check failed: " + e.message]); }
  }
}));
if (failed) { console.error(failed.message); process.exit(2); }

// keep catalog order so diffs stay readable
const ordered = {};
for (const it of apps) if (out[it.r]) ordered[it.r] = out[it.r];
writeFileSync(join(root, "downloads.json"), JSON.stringify({ v: 1, apps: ordered }, null, 1) + "\n");

const row = ([it, msg]) => `| ${it.n} | \`${it.r}\` | ${msg} |`;
let md = problems.length
  ? `Found **${problems.length}** problem(s) in \`catalog.json\`.\n\n| App | Repository | Problem |\n| --- | --- | --- |\n${problems.map(row).join("\n")}\n`
  : "No problems found.\n";
if (noWindows.length)
  md += `\n<details><summary>No ready-made Windows file in the latest release (${noWindows.length}) — the Download button opens the releases page</summary>\n\n${noWindows.map(it => `- ${it.n} (\`${it.r}\`)`).join("\n")}\n</details>\n`;
writeFileSync(join(root, "problems.md"), md);
console.log(`resolved ${Object.keys(ordered).length} apps with ${calls} API calls; ${problems.length} problem(s), ${noWindows.length} without a Windows file`);
