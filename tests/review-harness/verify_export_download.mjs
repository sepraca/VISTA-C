// verify_export_download.mjs — guards the download TRANSPORT used by every export.
//
// WHY THIS EXISTS
// ---------------
// Until v6.5.1 both PNG exports built a `data:` URL with canvas.toDataURL() and
// handed it to an <a download> click. That works on desktop and does NOTHING on
// iOS Safari — which ignores the `download` attribute on data: URLs. No file,
// no error, no exception: the surrounding try/catch never fired, the console
// stayed clean, and all 12 suites passed. The bug was found only by a human
// tapping the button on an iPad and noticing nothing happened.
//
// That is the exact profile of a defect no runtime gate in this repo can see,
// so this is a SOURCE-level gate. It cannot prove a download works; it asserts
// that the code has not drifted back to the transport that is known to fail
// silently. Narrow, but it can fail — which the equivalent runtime check
// cannot, since jsdom/Node have no download behaviour to observe.
//
// Verified to fail: restoring `Export.downloadDataURL` or routing either PNG
// export back through toDataURL() trips checks 1-4.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const src = readFileSync(ROOT + "js/exportUtils.js", "utf8");

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (!ok) failures++;
}

console.log("verify_export_download — download transport gate\n");

// --- 1. The old silently-failing helper must be gone -----------------------------------
check("Export.downloadDataURL no longer exists",
      !/downloadDataURL\s*:/.test(src) && !/Export\.downloadDataURL\s*\(/.test(src),
      "downloadDataURL is the data:-URL path that iOS Safari ignores; use downloadBlob()");

// --- 2. The blob-based helpers exist ---------------------------------------------------
for (const fn of ["downloadViaLink", "downloadBlob", "downloadCanvasPng"]) {
  check(`${fn}() is defined`, new RegExp(`${fn}\\s*:\\s*function`).test(src));
}

// --- 3. toDataURL appears ONLY in the documented toBlob-missing fallback ----------------
// Any other occurrence means a caller has drifted back to the broken transport.
const toDataUrlHits = [...src.matchAll(/toDataURL\s*\(/g)].length;
check("toDataURL() used at most once (the toBlob fallback)",
      toDataUrlHits <= 1, `found ${toDataUrlHits} occurrences`);

if (toDataUrlHits === 1) {
  // It must sit inside the `typeof canvas.toBlob !== "function"` guard.
  const idx = src.search(/toDataURL\s*\(/);
  const before = src.slice(Math.max(0, idx - 400), idx);
  check("the single toDataURL() is inside the toBlob-missing fallback",
        /typeof\s+canvas\.toBlob\s*!==\s*["']function["']/.test(before),
        "toDataURL must only be reachable when canvas.toBlob is unavailable");
}

// --- 4. Both PNG exports and the JSON export route through the blob path ----------------
// Match each export function body up to the next top-level `},` at 4-space indent.
function bodyOf(name) {
  const start = src.indexOf(`${name}: function`);
  if (start < 0) return null;
  const rest = src.slice(start);
  const end = rest.search(/\n {4,5}\},/);
  return end < 0 ? rest : rest.slice(0, end);
}

for (const [fn, expected] of [
  ["download3DView", "downloadCanvasPng"],
  ["downloadBottomPanel", "downloadCanvasPng"],
  ["downloadDataFile", "downloadBlob"],
]) {
  const body = bodyOf(fn);
  if (body === null) {
    check(`${fn}() found in source`, false, "export entry point missing or renamed");
    continue;
  }
  check(`${fn}() downloads via ${expected}()`,
        body.includes(`Export.${expected}(`),
        `expected Export.${expected}( inside ${fn}`);
}

// --- 5. The object URL must not be revoked in the same task ------------------------------
// Revoking synchronously after the click can abort an in-flight download in Safari.
const blobBody = bodyOf("downloadBlob") || "";
check("downloadBlob defers revokeObjectURL",
      /setTimeout\s*\([^)]*revokeObjectURL|setTimeout\s*\(\s*function[\s\S]*?revokeObjectURL/.test(blobBody),
      "revokeObjectURL must be deferred, not called in the same task as the click");

// --- 6. A data: URL passed to the link helper is at least flagged -------------------------
check("downloadViaLink warns if handed a data: URL",
      /startsWith\(["']data:["']\)/.test(src) && /console\.warn/.test(bodyOf("downloadViaLink") || ""),
      "the guard is what makes a future regression visible off-device");

console.log(`\n${failures === 0 ? "ALL CHECKS PASS" : `${failures} CHECK(S) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;
