// Finds a Chrome/Edge executable for the browser-driven tools. Playwright wants a real file path, so bare
// command names such as "google-chrome" (the CI runner) are resolved through PATH.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

export const DEFAULT_CANDIDATES = [process.env.CHROME, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe"];

function locate(candidate) {
  if (isAbsolute(candidate)) return existsSync(candidate) ? candidate : null;
  try {
    const out = execFileSync(process.platform === "win32" ? "where" : "which", [candidate], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split(/\r?\n/).find(Boolean) || null;
  } catch { return null; }
}

/** @param {(string|undefined)[]} candidates @returns {string|null} absolute path of the first browser found */
export function findBrowser(candidates = DEFAULT_CANDIDATES) {
  for (const c of candidates) { if (!c) continue; const p = locate(c); if (p) return p; }
  return null;
}
