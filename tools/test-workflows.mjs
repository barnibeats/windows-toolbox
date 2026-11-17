// Structural tests for the GitHub Actions workflows and Dependabot config.   node --test tools/test-workflows.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = f => readFileSync(join(root, f), "utf8");
const load = name => { const f = `.github/workflows/${name}`; assert.ok(existsSync(join(root, f)), `${f} is missing`); return { text: read(f), doc: YAML.parse(read(f)) }; };
const steps = doc => Object.values(doc.jobs).flatMap(j => j.steps || []);
const NAMES = ["ci.yml", "pages.yml", "release.yml"];

test("every workflow parses, declares permissions and never mentions DIST_TOKEN", () => {
  for (const n of NAMES) {
    const { text, doc } = load(n);
    assert.ok(doc.permissions && typeof doc.permissions === "object", `${n}: top-level permissions`);
    assert.ok(!text.includes("DIST_TOKEN"), `${n}: DIST_TOKEN`);
    assert.ok(!text.includes("windows-toolbox-releases"), `${n}: old repository`);
  }
});

test("ci.yml runs the whole suite on pull requests", () => {
  const { doc } = load("ci.yml");
  assert.ok("pull_request" in doc.on);
  assert.ok(steps(doc).some(s => /npm test/.test(s.run || "")));
});

test("pages.yml: push to main, daily 04:17 UTC, manual; tests before deploying; deploys with deploy-pages", () => {
  const { doc } = load("pages.yml");
  assert.deepEqual(doc.on.push.branches, ["main"]);
  assert.deepEqual(doc.on.schedule, [{ cron: "17 4 * * *" }]);
  assert.ok("workflow_dispatch" in doc.on);
  assert.equal(doc.permissions.pages, "write");
  assert.equal(doc.permissions["id-token"], "write");
  const all = steps(doc);
  assert.ok(all.some(s => /^actions\/deploy-pages@/.test(s.uses || "")), "deploy-pages step");
  assert.ok(all.some(s => /^actions\/upload-pages-artifact@/.test(s.uses || "")), "upload-pages-artifact step");
  const iResolve = all.findIndex(s => /tools\/resolve\.mjs/.test(s.run || ""));
  const iTest = all.findIndex(s => /npm test/.test(s.run || ""));
  const iUpload = all.findIndex(s => /^actions\/upload-pages-artifact@/.test(s.uses || ""));
  assert.ok(iResolve >= 0 && iResolve < iTest && iTest < iUpload, "resolve, then test, then upload");
  assert.match(YAML.stringify(doc), /latest\.json/);
});

test("release.yml: only on v* tags; builds the exe; ends by refreshing Pages", () => {
  const { doc } = load("release.yml");
  assert.deepEqual(Object.keys(doc.on), ["push"]);
  assert.deepEqual(doc.on.push.tags, ["v*"]);
  assert.equal(doc.on.push.branches, undefined);
  assert.equal(doc.permissions.contents, "write");
  assert.equal(doc.permissions.actions, "write");
  const all = steps(doc);
  assert.ok(all.some(s => /app[\\/]build\.ps1/.test(s.run || "")), "builds with app\build.ps1");
  assert.ok(all.some(s => /gh release create/.test(s.run || "")), "creates the release");
  assert.match(all.at(-1).run, /gh workflow run pages\.yml/);
});

test("dependabot keeps the actions up to date monthly", () => {
  const doc = YAML.parse(read(".github/dependabot.yml"));
  const u = doc.updates.find(x => x["package-ecosystem"] === "github-actions");
  assert.ok(u, "github-actions ecosystem");
  assert.equal(u.schedule.interval, "monthly");
});
