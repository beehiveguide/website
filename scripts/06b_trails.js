// Builds build/trails.json: trailheads and named trails inside each city or town.
//
//   Town boundaries  sources/ugrc/UtahMunicipalBoundaries*.geojson (incorporated
//                    places only, so unincorporated communities get nothing)
//   Trailheads       sources/ugrc/UtahTrailheads*.geojson (points) inside the boundary
//   Trails           sources/ugrc/TrailsAndPathways*.geojson: named, existing trails and
//                    paths (not sidewalks or links) with a piece inside the boundary,
//                    grouped by name
//
// A trailhead is linked to a trail only when it is within TRAILHEAD_M meters of the
// trail's line. Trails with no trailhead are only listed by name, because the data
// doesn't show which ends are entry points.
//
// Output: { "<Gaz ID>": { trailheads: [{ name, lat, lng, trails: [...] }], trails: [...] } }
const fs = require("fs");
const paths = require("./lib/paths");
const { nameKey, readGeoJson, makeAreaFinder, listCommunities, findGeoJson } = require("./lib/communities");

const TRAILHEAD_M = 150;
const outputPath = paths.build("trails.json");
if (!findGeoJson("TrailsAndPathways") || !findGeoJson("UtahTrailheads") || !findGeoJson("UtahMunicipalBoundaries")) {
  console.log("  Trail, trailhead or municipal boundary file missing in sources/ugrc/; trails.json left empty.");
  fs.writeFileSync(outputPath, "{}");
  process.exit(0);
}

const communities = listCommunities();
const byKey = {};
for (const c of communities) (byKey[nameKey(c.name)] = byKey[nameKey(c.name)] || []).push(c);

// Each boundary -> its community (same name; the one whose point is inside when several share it)
const boundaries = readGeoJson("UtahMunicipalBoundaries");
const featureCommunity = new Map();
for (const f of boundaries) {
  const list = byKey[nameKey(String(f.properties.NAME || ""))] || [];
  if (!list.length) continue;
  let match = list.length === 1 ? list[0] : null;
  if (!match) {
    const inside = makeAreaFinder([f]);
    match = list.find((c) => inside(c.lng, c.lat).length) || null;
  }
  if (match) featureCommunity.set(f, match.id);
}
const findBoundary = makeAreaFinder([...featureCommunity.keys()]);
const communityAt = (lng, lat) => {
  const hit = findBoundary(lng, lat)[0];
  return hit ? featureCommunity.get(hit) : null;
};

// Trail names: tidy, and drop codes and placeholders
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, a, c) => a + c.toUpperCase());
// Spelling fixes to trail names (config/corrections.json "trail_names")
const nameFixes = paths.readJson(paths.config("corrections.json")).trail_names || [];
const cleanName = (s) => {
  let n = nameFixes.reduce((acc, fix) => acc.split(fix.find).join(fix.replace), String(s || ""))
    .replace(/\(\s*\d+\s*\)/g, "")
    .replace(/\s+\d{2,}$/, "")
    .replace(/\s+/g, " ")
    .trim();
  // ALL CAPS names become title case
  if (n.length > 3 && n === n.toUpperCase() && /[A-Z]/.test(n)) n = titleCase(n);
  return n;
};
// Cryptic names are left out: abbreviations and codes (Acc, Conn, JRP, BST, Dh, Rd, Blvd,
// SR-92), numbered generics (Loop 1, OHV-3), and words with no vowels (Nsl, Lpw)
const ABBREVIATIONS = /\b(acc|conn|dh|cc|jrp|jrt|bst|nsl|lpw|ohv|rd|blvd|dr|ln|ave|hwy|pkwy|mtn|lk|ext|tbd|temp)\b|\b(SR|I|US)-?\d+\b|\bSt\b(?=\s*(Trail|Path|Pathway|Connector)?\s*$)/i;
const cryptic = (n) =>
  ABBREVIATIONS.test(n) ||
  /^(loop|drop line|spur)\s*\d+$/i.test(n) ||
  n.split(/[\s()/-]+/).some((w) => w.length >= 2 && w.length <= 4 && !/[aeiouy]/i.test(w) && !/^(mt|st|dr|mr|ms|ft|hwy)$/i.test(w) && !/^\d/.test(w));
const usableName = (n, isTrail = true) =>
  n.length >= 4 && !/^\d+$/.test(n) && !/^(unnamed|unknown|n\/?a|none|no name)\b/i.test(n) &&
  !cryptic(n) && !(isTrail && /^\d/.test(n));

// Trail groups by cleaned name and county; their vertices go in a grid for trailhead matching
const cell = (x, y) => `${Math.floor(x * 500)},${Math.floor(y * 500)}`;
const dist = (a, b) => Math.hypot((a[1] - b[1]) * 111000, (a[0] - b[0]) * 83000);
const groups = new Map(); // key -> { name, towns: Set }
const grid = {};
for (const f of readGeoJson("TrailsAndPathways")) {
  const p = f.properties;
  if (!f.geometry || !["Trail", "Path"].includes(p.Class)) continue;
  if (p.Status && p.Status !== "EXISTING") continue;
  const name = cleanName(p.PrimaryName);
  if (!usableName(name)) continue;
  const key = `${name.toLowerCase()}|${p.County}`;
  const g = groups.get(key) || { name, towns: new Set() };
  groups.set(key, g);
  const lines = f.geometry.type === "LineString" ? [f.geometry.coordinates]
    : f.geometry.type === "MultiLineString" ? f.geometry.coordinates : [];
  for (const L of lines) {
    const mid = L[Math.floor(L.length / 2)];
    const town = communityAt(mid[0], mid[1]);
    if (town) g.towns.add(town);
    for (const c of L) (grid[cell(c[0], c[1])] = grid[cell(c[0], c[1])] || []).push([c, key]);
  }
}

const output = {};
const entry = (id) => (output[id] = output[id] || { trailheads: [], trails: [] });

// Trailheads inside town boundaries, with the trails within TRAILHEAD_M of them
for (const f of readGeoJson("UtahTrailheads")) {
  const [lng, lat] = f.geometry.coordinates;
  const id = communityAt(lng, lat);
  const name = cleanName(f.properties.PrimaryName);
  if (!id || !usableName(name, false)) continue;
  const near = new Set();
  const [gx, gy] = cell(lng, lat).split(",").map(Number);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++)
    for (const [c, key] of grid[`${gx + i},${gy + j}`] || []) if (dist([lng, lat], c) < TRAILHEAD_M) near.add(key);
  const trails = [...new Set([...near].map((k) => groups.get(k).name))];
  const e = entry(id);
  if (!e.trailheads.some((t) => t.name.toLowerCase() === name.toLowerCase()))
    e.trailheads.push({ name, lat: +lat.toFixed(6), lng: +lng.toFixed(6), trails });
}

// Named trails with a piece inside each town
const seen = {};
for (const g of groups.values()) {
  for (const id of g.towns) {
    const s = (seen[id] = seen[id] || new Set());
    if (s.has(g.name.toLowerCase())) continue;
    s.add(g.name.toLowerCase());
    entry(id).trails.push(g.name);
  }
}
for (const e of Object.values(output)) {
  e.trailheads.sort((a, b) => a.name.localeCompare(b.name));
  e.trails.sort((a, b) => a.localeCompare(b));
}
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
const ids = Object.keys(output);
console.log(`Done! Wrote ${ids.length} communities to ${outputPath}`);
console.log(`  with trailheads: ${ids.filter((i) => output[i].trailheads.length).length}; with trails: ${ids.filter((i) => output[i].trails.length).length}`);
