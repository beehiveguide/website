// Builds build/history.json from sources/books/utah_place_names.json,
// with name origins reworded per config/origin_rewrites.json,
// after applying the fixes in config/corrections.json ("utah_place_names"):
// founding ("Settled 1890" or "Established 1897") and name origin for each community.
// Matched by name and county. "(historical)" is ignored in our names.
// Entries with neither a founding nor an origin (renamed places) are skipped.
// Output: { "<Gaz ID>": { founded: "Settled 1862", origin: "Named for ..." } }
const fs = require("fs");
const path = require("path");
const { nameKey } = require("./lib/communities");
const paths = require("./lib/paths");

const placeNames = paths.readJson(paths.source("books", "utah_place_names.json"));
const outputPath = paths.build("history.json");

// Fixes to the book's data, kept apart so the source file stays as downloaded.
const corrections = paths.readJson(paths.config("corrections.json")).utah_place_names || [];
for (const fix of corrections) {
  const hits = placeNames.filter((p) => Object.entries(fix.match).every(([k, v]) => p[k] === v));
  if (hits.length !== 1) console.warn(`  Correction matched ${hits.length} entries: ${JSON.stringify(fix.match)}`);
  for (const p of hits) Object.assign(p, fix.set);
}

const index = {};
for (const p of placeNames) {
  if (!p.founded && !p.name_origin) continue;
  index[`${nameKey(p.place_name)}|${p.county}`] = p;
}

// The book's cross-references ("see Duchesne County") point to sections that
// aren't in our data, so they're removed. An origin that's only a
// cross-reference ("See Morgan County.", "Abandoned (see Juab County).")
// becomes blank.
function cleanOrigin(text) {
  if (!text) return "";
  if (/^(Abandoned )?\(?See [^.]*\.?\)?\.?$/i.test(text.trim())) return "";
  return text
    .replace(/\s*\((for origin of present name, )?see [^)]*\)/gi, "")
    .replace(/\s*See [^.]*?, under [^.]*\./g, "")
    .replace(/\s+([.,])/g, "$1")
    .trim();
}

const lines = fs.readFileSync(paths.build("communities.csv"), "utf8").trim().split(/\r?\n/);
const h = lines[0].split(",");
const output = {};
const rewrites = paths.readJson(paths.config("origin_rewrites.json")).entries;
let reworded = 0;
for (const line of lines.slice(1)) {
  const c = line.split(",");
  const name = c[h.indexOf("Feature Name")].replace(/ \(historical\)$/, "");
  const p = index[`${nameKey(name)}|${c[h.indexOf("County")]}`];
  if (!p) continue;
  const id = c[h.indexOf("Gaz ID")];
  let origin = cleanOrigin(p.name_origin);
  // Other sources a reworded origin also draws on ("alsoFrom": sources.json keys)
  let originSources = [];
  // Reworded origins (config/origin_rewrites.json). Used only while the book
  // text still matches what was reworded, so a changed source isn't hidden.
  const rw = rewrites[id];
  if (rw && origin) {
    if (rw.original === origin) { origin = rw.rewrite; originSources = rw.alsoFrom || []; reworded++; }
    else console.warn(`  Rewrite skipped, book text changed: ${rw.name}`);
  }
  output[id] = { founded: (p.founded || "").trim(), origin };
  if (originSources.length) output[id].originSources = originSources;
}

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`  Reworded origins (config/origin_rewrites.json): ${reworded}`);
console.log(`Done! Matched ${Object.keys(output).length} communities. Wrote ${outputPath}`);
