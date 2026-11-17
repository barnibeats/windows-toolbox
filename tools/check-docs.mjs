// Checks the Markdown docs: every relative link and image exists, the three READMEs link to each
// other and carry the download link.   node tools/check-docs.mjs
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", ".git", ".superpowers", "dist"]);
const problems = [];

const mdFiles = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p); else if (name.endsWith(".md")) mdFiles.push(p);
  }
})(root);

const linkRe = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const targetsOf = text => [...text.replace(/```[\s\S]*?```/g, "").matchAll(linkRe)].map(m => m[1]);
for (const file of mdFiles) {
  for (const target of targetsOf(readFileSync(file, "utf8"))) {
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const path = decodeURIComponent(target.split("#")[0].split("?")[0]);
    if (!existsSync(resolve(dirname(file), path))) problems.push(`${relative(root, file)}: broken link ${target}`);
  }
}

const DOWNLOAD = "https://github.com/barnibeats/windows-toolbox/releases/latest/download/WindowsToolbox.exe";
const READMES = { "README.md": ["README.ru.md", "README.uk.md"], "README.ru.md": ["README.md", "README.uk.md"], "README.uk.md": ["README.md", "README.ru.md"] };
for (const [name, others] of Object.entries(READMES)) {
  const p = join(root, name);
  if (!existsSync(p)) { problems.push(`${name}: missing`); continue; }
  const text = readFileSync(p, "utf8"), targets = targetsOf(text);
  for (const o of others) if (!targets.includes(o)) problems.push(`${name}: no link to ${o}`);
  if (!text.includes(DOWNLOAD)) problems.push(`${name}: no download link ${DOWNLOAD}`);
  if (!targets.some(t => t.startsWith("docs/screenshots/"))) problems.push(`${name}: no screenshot from docs/screenshots/`);
}
for (const f of ["LICENSE", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md", ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/suggest-app.yml", ".github/ISSUE_TEMPLATE/bug.yml", ".github/ISSUE_TEMPLATE/config.yml", "docs/social-preview.png"])
  if (!existsSync(join(root, f))) problems.push(`${f}: missing`);

if (problems.length) { for (const p of problems) console.error("FAIL:", p); process.exit(1); }
console.log(`docs OK: ${mdFiles.length} Markdown files checked`);
