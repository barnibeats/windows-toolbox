// Tests for catalog validation in tools/build.mjs.   node --test tools/test-build.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const build = join(dirname(fileURLToPath(import.meta.url)), "build.mjs");
const dir = mkdtempSync(join(tmpdir(), "toolbox-catalog-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const i18n = t => ({ en: t, uk: t, ru: t });
const entry = (over = {}) => ({ n: "App", r: "owner/app", w: "Owner.App", d: i18n("An app"), ...over });
const catalogWith = (items, group = {}) => ({
  sections: [{ id: "demo", icon: "🧪", title: i18n("Demo"), desc: i18n("Demo section"),
    groups: [{ name: i18n("Group"), ...group, items }] }],
});

let n = 0;
function run(catalog, ...flags) {
  const file = join(dir, `catalog-${n++}.json`);
  writeFileSync(file, JSON.stringify(catalog));
  const r = spawnSync(process.execPath, [build, "--check", ...flags], { env: { ...process.env, CATALOG: file }, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

test("a complete catalog passes with and without --strict", () => {
  assert.equal(run(catalogWith([entry()])).code, 0);
  assert.equal(run(catalogWith([entry()]), "--strict").code, 0);
});

test('--strict fails when an entry lacks "uk"; without --strict it only warns', () => {
  const c = catalogWith([entry({ d: { en: "An app", ru: "Программа" } })]);
  const lax = run(c);
  assert.equal(lax.code, 0);
  assert.match(lax.out, /warning:.*"uk"/);
  const strict = run(c, "--strict");
  assert.equal(strict.code, 1);
  assert.match(strict.out, /"uk"/);
});

test("a duplicate repo is rejected", () => {
  const r = run(catalogWith([entry(), entry({ n: "Other" })]));
  assert.equal(r.code, 1);
  assert.match(r.out, /duplicate/);
});

test("a malformed winget id is rejected", () => {
  const r = run(catalogWith([entry({ w: "not a winget id" })]));
  assert.equal(r.code, 1);
  assert.match(r.out, /winget id/);
});

test("group note: complete passes, missing languages fail only under --strict, missing ru always fails", () => {
  assert.equal(run(catalogWith([entry()], { note: i18n("Check your local law") }), "--strict").code, 0);
  const partial = catalogWith([entry()], { note: { ru: "Проверьте закон" } });
  assert.equal(run(partial).code, 0);
  assert.equal(run(partial, "--strict").code, 1);
  assert.equal(run(catalogWith([entry()], { note: { en: "x", uk: "x" } })).code, 1);
});
