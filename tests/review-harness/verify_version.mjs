// verify_version.mjs — the version string must agree everywhere. Run from repo root:
//   node tests/review-harness/verify_version.mjs
//
// WHY THIS EXISTS. Until v6.3.1 the version lived only in prose, repeated independently in
// CHANGELOG.md, README.md and CITATION.cff, with nothing in js/ or index.html aware of it at
// all. Nothing tied those copies together, and they drifted: CITATION.cff sat at 6.0.7
// through BOTH the v6.1.0 and v6.2.0 releases without anyone noticing, and was only caught
// by chance during the v6.3.0 doc pass. A citation pointing at the wrong release is a
// scientific-provenance error, not a typo — anyone citing VISTA-C from that file for four
// months would have named a version that did not contain the work they were citing.
//
// js/constants.js APP_VERSION is now the single source of truth. This gate asserts every
// other copy matches it, so the same drift cannot happen silently again.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not check the git tag. A release is tagged
// AFTER the version bump is committed, so requiring a matching tag would make the suite fail
// on every legitimate pre-release commit. The tag is the author's step; this gate covers the
// files.

import { readFileSync } from "node:fs";

let fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
  if (!ok) fails++;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

// ---- Source of truth ----------------------------------------------------------------
const constantsSrc = read("../../js/constants.js");
const m = constantsSrc.match(/export const APP_VERSION\s*=\s*"([^"]+)"/);
if (!m) {
  console.log("FAIL  js/constants.js exports APP_VERSION   not found — this is the source of truth");
  process.exit(1);
}
const VERSION = m[1];
console.log(`source of truth: js/constants.js APP_VERSION = ${VERSION}\n`);

check("APP_VERSION is bare semver (no leading 'v')",
      /^\d+\.\d+\.\d+$/.test(VERSION),
      `got "${VERSION}" — CITATION.cff wants bare, README/CHANGELOG add the 'v' themselves`);

// ---- CHANGELOG: the NEWEST entry must be this version -------------------------------
// Newest, not merely present: a stale APP_VERSION would still appear somewhere in a file
// that records every past release, so "is it mentioned" proves nothing.
const changelog = read("../../CHANGELOG.md");
const firstEntry = changelog.match(/^## \[v(\d+\.\d+\.\d+)\]/m);
check("CHANGELOG.md newest entry matches APP_VERSION",
      firstEntry && firstEntry[1] === VERSION,
      firstEntry ? `newest entry is [v${firstEntry[1]}]` : "no '## [vX.Y.Z]' entry found");

// ---- CITATION.cff — the field that actually drifted ---------------------------------
const citation = read("../../CITATION.cff");
const cffVer = citation.match(/^version:\s*(\S+)/m);
check("CITATION.cff version matches APP_VERSION",
      cffVer && cffVer[1] === VERSION,
      cffVer ? `CITATION.cff says ${cffVer[1]}` : "no 'version:' field found");

// ---- README: the two places it states a version -------------------------------------
const readme = read("../../README.md");
const readmeLatest = readme.match(/Latest tagged release:\s*\*\*v(\d+\.\d+\.\d+)\*\*/);
check("README 'Latest tagged release' matches APP_VERSION",
      readmeLatest && readmeLatest[1] === VERSION,
      readmeLatest ? `README says v${readmeLatest[1]}` : "phrase not found");

const readmeCite = readme.match(/\*VISTA-C:[^*]*\*\s*\(v(\d+\.\d+\.\d+)\)/);
check("README citation block matches APP_VERSION",
      readmeCite && readmeCite[1] === VERSION,
      readmeCite ? `README citation says v${readmeCite[1]}` : "citation block not found");

// ---- Nothing may hardcode a version outside the source of truth ---------------------
// The header, JSON export and PNG header must all DERIVE from APP_VERSION. A literal
// "v6.x.y" reintroduced into markup or JS is exactly how this drifts again.
const indexHtml = read("../../index.html");
const hardcodedHtml = indexHtml.match(/VISTA-C\s*\(?v\d+\.\d+\.\d+/g);
check("index.html does not hardcode a version",
      !hardcodedHtml,
      hardcodedHtml ? `found ${JSON.stringify(hardcodedHtml)} — render from APP_VERSION instead`
                    : "header is rendered from APP_VERSION at startup");

console.log(`\n${fails === 0 ? "ALL VERSION GATES PASS" : `${fails} FAILURE(S)`}`);
process.exit(fails === 0 ? 0 : 1);
