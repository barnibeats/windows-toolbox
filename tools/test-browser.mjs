// Tests for the browser lookup shared by the interface tests and the screenshot script.   node --test tools/test-browser.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { findBrowser } from "./browser.mjs";

test("a bare command name is resolved through PATH to an absolute file (Playwright needs a path)", () => {
  const found = findBrowser(["no-such-browser-xyz", "node"]);
  assert.ok(found && isAbsolute(found) && existsSync(found), `got ${found}`);
});

test("an existing absolute path is returned as it is", () => {
  assert.equal(findBrowser([process.execPath]), process.execPath);
});

test("empty entries are skipped and nothing found gives null", () => {
  assert.equal(findBrowser([undefined, "", "no-such-browser-xyz", "C:/no/such/browser.exe"]), null);
});
