// Builds build/communities.csv from source files only.
//
// Sources
//   sources/gnis/federal-codes/FederalCodes_UT.txt  GNIS federal codes (master list)
//   build/census.json                               2020 census places (from 01_census.js)
//   sources/gnis/search-exports/*.csv               GNIS search exports (elevation only)
//     Detected by its header ("Gaz ID,Feature Name,..." with an Elevation column),
//     so files can have any name. Add as many as you like, then rerun.
//
// Rules
//   1. Keep GNIS Populated Place and Census records whose Census
//      Classification Code is P1, P4, C1, C4, U1, U5 or U6, plus every
//      Census-class record (CDPs). Records with no code or U4 are left out.
//      Z5 Census records are county divisions, not CDPs, so they're left out too.
//   2. GNIS lists many places twice (a Populated Place point and a Census
//      area). Records that share a 2020 census place become one row, named as
//      the census names it ("Sandy city" -> "Sandy"). A Populated Place record
//      is preferred for its location.
//   3. Some city records carry an outdated census code (Sandy City 67550).
//      Those are linked to the 2020 code through the GNIS Civil record for
//      the same city in the same county ("City of Sandy" 67440).
//   4. Any 2020 census place still missing after rules 1-3 is added from its
//      GNIS Civil record, so every city, town and CDP is listed once.
//   5. Elevation (meters) is copied from the GNIS search exports by Gaz ID.
//      For a census place, any kept record for that place can supply it.
//   6. Places listed in config/excluded_places.json are left out.
//   7. Places that aren't 2020 census places are kept only if they're on
//      UGRC's populated places list (sources/ugrc/populated-places/populated_places_2010.json, the
//      unincorporated communities from PopPlacePts2010_Approx), matched by
//      name and county. A place on that list with no GNIS record is added
//      from UGRC's point, with a Gaz ID starting "UGRC-".
//      Their approximate 2010 population from that list is saved to
//      build/ugrc_population.json (Gaz ID -> people).
//   8. Places listed in config/included_places.json are kept even when UGRC
//      doesn't list them.
//   9. UGRC wins: every place on UGRC's list takes UGRC's name and point,
//      even when it's also a census place. Census numbers still come from 2020.
//
// Run 01_census.js first.
const fs = require("fs");
const path = require("path");

const paths = require("./lib/paths");

const fedPath = paths.source("gnis", "federal-codes", "FederalCodes_UT.txt");
const censusPath = paths.build("census.json");
const outputPath = paths.build("communities.csv");

const COLUMNS = [
  "Gaz ID", "Feature Name", "Class", "County", "State", "Elevation",
  "Latitude", "Longitude", "Bgn Decision Date", "Entry Date", "Census Code",
  "Census Classification Code", "GSA Code", "OPM Code", "County FIPS Code", "State FIPS Code",
];
const CLASS_RANK = { "Populated Place": 0, "Census": 1, "Civil": 2 };
const INCLUDE_CODES = new Set(["P1", "P4", "C1", "C4", "U1", "U5", "U6"]);

// --- Read GNIS federal codes (one row per feature and county; keep the first).
const fedLines = fs.readFileSync(fedPath, "utf8").replace(/^﻿/, "").trim().split(/\r?\n/);
const fedHeaders = fedLines[0].split("|");
const features = new Map();
for (const line of fedLines.slice(1)) {
  const c = line.split("|");
  const r = Object.fromEntries(fedHeaders.map((h, i) => [h, (c[i] || "").trim()]));
  if (r.state_name === "Utah" && !features.has(r.feature_id)) features.set(r.feature_id, r);
}

// Split one CSV line, respecting quoted fields that contain commas.
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

// --- Elevations from GNIS search exports, by feature ID.
const elevations = {};
const elevationsByName = {};
// Any GNIS search export in sources/gnis/search-exports/, whatever its name.
const elevFiles = paths.sourceFiles(path.join("gnis", "search-exports"), /\.csv$/i);
let elevFileCount = 0;
for (const file of elevFiles) {
  const lines = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const h = parseCsvLine(lines[0]);
  if (h[0] !== "Gaz ID" || h[1] !== "Feature Name" || !h.includes("Elevation")) continue;
  elevFileCount++;
  const idIdx = h.indexOf("Gaz ID");
  const elevIdx = h.indexOf("Elevation");
  for (const line of lines.slice(1)) {
    const c = parseCsvLine(line);
    const elev = parseFloat(c[elevIdx]);
    if (!isNaN(elev)) {
      elevations[c[idIdx]] = String(elev);
      // Also by name and county, for places whose kept record has a different
      // Gaz ID than the exported one ("East Carbon City" -> "EASTCARBON|CARBON")
      // Only places, not valleys, capes or streams that share a name
      const cls = c[h.indexOf("Class")];
      if (cls === "Populated Place" || cls === "Census" || cls === "Civil") {
        const full = c[h.indexOf("Feature Name")];
        const county = c[h.indexOf("County")].toUpperCase().replace(/ COUNTY$/, "").replace(/[^A-Z]/g, "");
        for (const name of [full, full.replace(/ (City|Town|Census Designated Place)$/i, "")]) {
          elevationsByName[`${name.toUpperCase().replace(/[^A-Z]/g, "")}|${county}`] ??= String(elev);
        }
      }
    }
  }
}

const census = JSON.parse(fs.readFileSync(censusPath, "utf8"));

// Places to leave out (former CDPs, historical places, rail stops, junctions).
// Edit config/excluded_places.json to change the list.
const excludedPath = paths.config("excluded_places.json");
const excluded = new Set(fs.existsSync(excludedPath)
  ? JSON.parse(fs.readFileSync(excludedPath, "utf8")).map((e) => String(e.gaz_id))
  : []);
const nameKey = (name) => name.toLowerCase().replace(/^saint /, "st. ").trim();

function toRow(r, name) {
  return {
    "Gaz ID": r.feature_id,
    "Feature Name": name,
    "Class": r.feature_class,
    "County": `${r.county_name} County`,
    "State": "Utah",
    "Elevation": elevations[r.feature_id] || "",
    "Latitude": r.prim_lat_dec,
    "Longitude": r.prim_long_dec,
    "Bgn Decision Date": r.bgn_date,
    "Entry Date": r.date_created,
    "Census Code": r.census_code,
    "Census Classification Code": r.census_class_code,
    "GSA Code": r.gsa_code,
    "OPM Code": r.opm_code,
    "County FIPS Code": `49${r.county_numeric}`,
    "State FIPS Code": "49",
  };
}

// Name key for matching the same place across records:
// "City of Sandy", "Sandy City" and "Sandy" all become "sandy".
const placeKey = (name) =>
  nameKey(name).replace(/^(city|town) of /, "").replace(/ (city|town)$/, "").trim();

// --- Rule 1: filter GNIS records.
const kept = [...features.values()].filter((r) => {
  if (r.feature_class === "Census") return r.census_class_code !== "Z5";
  if (r.feature_class !== "Populated Place") return false;
  return INCLUDE_CODES.has(r.census_class_code);
});

// --- Rule 3: link outdated city codes to the 2020 code via Civil records.
const civilByPlace = {}; // "placeKey|county" -> 2020 census code
for (const r of features.values()) {
  if (r.feature_class === "Civil" && census[r.census_code]) {
    civilByPlace[`${placeKey(r.feature_name)}|${r.county_name}`] = r.census_code;
  }
}
function currentCode(r) {
  if (census[r.census_code]) return r.census_code;
  return civilByPlace[`${placeKey(r.feature_name)}|${r.county_name}`] || "";
}

// --- Rule 2: one row per 2020 census place; other records stand alone.
const byCode = {};
const others = [];
for (const r of kept) {
  const code = currentCode(r);
  if (code) (byCode[code] = byCode[code] || []).push(r);
  else others.push(r);
}

const rows = [];
const listed = new Set(); // "name|county", to skip repeats
function addCensusPlace(code, records) {
  records.sort((a, b) => CLASS_RANK[a.feature_class] - CLASS_RANK[b.feature_class]);
  const name = census[code].name.replace(/ (city|town|CDP|metro township)$/, "");
  const row = toRow(records[0], name);
  row["Census Code"] = code;
  if (!row.Elevation) {
    const withElev = records.find((r) => elevations[r.feature_id]);
    if (withElev) row.Elevation = elevations[withElev.feature_id];
  }
  rows.push(row);
  listed.add(`${nameKey(name)}|${row.County}`);
}
for (const [code, records] of Object.entries(byCode)) addCensusPlace(code, records);

// --- Rule 4: census places with no kept record come from their Civil record.
const addedFromCivil = [];
for (const code of Object.keys(census)) {
  if (byCode[code]) continue;
  const civil = [...features.values()].filter((r) => r.feature_class === "Civil" && r.census_code === code);
  if (civil.length) { addCensusPlace(code, civil); addedFromCivil.push(census[code].name); }
}

// --- Rule 7: other communities come only from UGRC's populated places list.
// UGRC names that differ from GNIS names for the same place:
const UGRC_ALIASES = {
  "Hamilton Fort|IRON": "Hamiltons Fort",
  "Emigration|SALT LAKE": "Emigration Canyon",
  "Big Cottonwood Canyon|SALT LAKE": "Big Cottonwood Canyon Resorts",
  "Bryce Canyon|GARFIELD": "Bryce Canyon City",
  "Oljato|SAN JUAN": "Oljato-Monument Valley",
};
const looseKey = (name, county) =>
  `${name.toUpperCase().replace(/ \(HISTORICAL\)$/, "").replace(/^SAINT /, "ST ").replace(/[^A-Z]/g, "")}|` +
  county.toUpperCase().replace(/ COUNTY$/, "").replace(/[^A-Z]/g, "");
const ugrcPath = paths.source("ugrc", "populated-places", "populated_places_2010.json");
const ugrcPlaces = fs.existsSync(ugrcPath) ? JSON.parse(fs.readFileSync(ugrcPath, "utf8")) : [];
const ugrcByKey = new Map();
for (const [name, county, pop, lat, lng] of ugrcPlaces) {
  const gnisName = UGRC_ALIASES[`${name}|${county}`] || name;
  ugrcByKey.set(looseKey(gnisName, county), { name, county, pop, lat, lng, used: false });
}

// Mark UGRC places already covered by a census place (Kearns, Snyderville ...)
for (const row of rows) {
  const u = ugrcByKey.get(looseKey(row["Feature Name"], row.County));
  if (u) u.used = true;
}

// Places on the excluded list stay out even when UGRC lists them.
const excludedKeys = new Set();
for (const r of features.values()) if (excluded.has(r.feature_id)) {
  excludedKeys.add(looseKey(r.feature_name.replace(/ Census Designated Place/, ""), r.county_name));
}

// GNIS records that match a UGRC place (any census code, since UGRC is the
// authority here), skipping a name already listed in the same county.
const ugrcCandidates = [...features.values()].filter((r) =>
  (r.feature_class === "Populated Place" || r.feature_class === "Census") &&
  r.census_class_code !== "Z5" && !excluded.has(r.feature_id) && !census[r.census_code]);
// UGRC's approximate 2010 population for places with no census numbers,
// by Gaz ID -> build/ugrc_population.json
const ugrcPopulation = {};
for (const r of ugrcCandidates) {
  // "Oquirrh Census Designated Place (historical)" -> "Oquirrh (historical)"
  const name = r.feature_name.replace(/ Census Designated Place/, "");
  const u = ugrcByKey.get(looseKey(name, r.county_name));
  if (!u) continue;
  u.used = true;
  const key = `${nameKey(name.replace(/ \(historical\)$/, ""))}|${r.county_name} County`;
  if (listed.has(key)) continue;
  rows.push(toRow(r, name));
  listed.add(key);
  ugrcPopulation[r.feature_id] = u.pop;
}

// --- Rule 8: places kept by hand (config/included_places.json).
const includedPath = paths.config("included_places.json");
const included = fs.existsSync(includedPath) ? JSON.parse(fs.readFileSync(includedPath, "utf8")) : [];
for (const inc of included) {
  const r = features.get(String(inc.gaz_id));
  if (!r || rows.some((row) => row["Gaz ID"] === r.feature_id)) continue;
  const name = r.feature_name.replace(/ Census Designated Place/, "");
  rows.push(toRow(r, name));
  listed.add(`${nameKey(name)}|${r.county_name} County`);
}

// UGRC places with no GNIS record: add from UGRC's point.
const COUNTY_FIPS = {};
for (const r of features.values()) COUNTY_FIPS[r.county_name.toUpperCase()] = { name: r.county_name, fips: r.county_numeric };
const addedFromUgrc = [];
for (const [k, u] of ugrcByKey) {
  if (u.used || excludedKeys.has(k)) continue;
  const c = COUNTY_FIPS[u.county] || { name: u.county.replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()), fips: "" };
  const id = `UGRC-${u.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "")}-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const key = `${nameKey(u.name)}|${c.name} County`;
  if (listed.has(key)) continue;
  rows.push({
    "Gaz ID": id, "Feature Name": u.name.replace(/ Jct\.$/, " Junction"), "Class": "Populated Place (UGRC)",
    "County": `${c.name} County`, "State": "Utah", "Elevation": "", "Latitude": String(u.lat), "Longitude": String(u.lng),
    "Bgn Decision Date": "", "Entry Date": "", "Census Code": "", "Census Classification Code": "",
    "GSA Code": "", "OPM Code": "", "County FIPS Code": c.fips ? `49${c.fips}` : "", "State FIPS Code": "49",
  });
  listed.add(key);
  addedFromUgrc.push(u.name);
  ugrcPopulation[id] = u.pop;
}

// --- Rule 9: UGRC wins. A place on UGRC's list takes UGRC's name and point,
// even when a census or GNIS record supplied it ("Jct." is spelled out).
// Census numbers (population, households) still come from 2020.
const renamedByUgrc = [];
for (const row of rows) {
  const u = ugrcByKey.get(looseKey(row["Feature Name"], row.County));
  if (!u) continue;
  const name = u.name.replace(/ Jct\.$/, " Junction");
  if (name !== row["Feature Name"]) renamedByUgrc.push(`${row["Feature Name"]} -> ${name}`);
  row["Feature Name"] = name;
  row.Latitude = String(u.lat);
  row.Longitude = String(u.lng);
}

// Rule 5, last try: a place still without elevation takes it from an
// exported record with the same name in the same county.
for (const row of rows) {
  if (row.Elevation) continue;
  const key = `${row["Feature Name"].toUpperCase().replace(/[^A-Z]/g, "")}|${row.County.toUpperCase().replace(/ COUNTY$/, "").replace(/[^A-Z]/g, "")}`;
  if (elevationsByName[key]) row.Elevation = elevationsByName[key];
}

// Places whose GNIS record goes by another name (config/elevation_matches.json):
// take the elevation from that record's Gaz ID.
const matchesPath = paths.config("elevation_matches.json");
const elevMatches = fs.existsSync(matchesPath) ? JSON.parse(fs.readFileSync(matchesPath, "utf8")) : [];
for (const row of rows) {
  if (row.Elevation) continue;
  const m = elevMatches.find((x) => x.name === row["Feature Name"] && `${x.county} County` === row.County);
  if (m && elevations[m.gaz_id]) row.Elevation = elevations[m.gaz_id];
}

// Places GNIS doesn't list: elevation from USGS's Elevation Point Query
// Service at the place's point (sources/usgs-epqs/epqs_elevations.json, feet)
const epqsPath = paths.source("usgs-epqs", "epqs_elevations.json");
const epqs = fs.existsSync(epqsPath) ? JSON.parse(fs.readFileSync(epqsPath, "utf8")).places : [];
for (const row of rows) {
  if (row.Elevation) continue;
  const e = epqs.find((x) => x.name === row["Feature Name"] && `${x.county} County` === row.County);
  if (e) row.Elevation = String(Math.round(e.feet / 3.28084 * 10) / 10); // to meters, like GNIS
}

// Rule 6: drop anything on the excluded list.
const beforeExclude = rows.length;
for (let i = rows.length - 1; i >= 0; i--) if (excluded.has(rows[i]["Gaz ID"])) rows.splice(i, 1);

rows.sort((a, b) =>
  a["Feature Name"].localeCompare(b["Feature Name"], "en", { sensitivity: "base" }) ||
  a.County.localeCompare(b.County));

const csv = [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => String(r[c]).replace(/,/g, "")).join(","))];
fs.writeFileSync(outputPath, csv.join("\n") + "\n");
fs.writeFileSync(paths.build("ugrc_population.json"),
  JSON.stringify(Object.fromEntries(Object.entries(ugrcPopulation)
    .filter(([id]) => rows.some((row) => row["Gaz ID"] === id))), null, 2) + "\n");

// --- List communities that still need PRISM precipitation.
const prismIds = new Set();
for (const f of paths.sourceFiles(path.join("prism", "normals"), /PRISM.*normals\.csv$/i)) {
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    if (line.includes(",Annual,")) prismIds.add(line.split(",")[0]);
  }
}
const needPrism = rows.filter((r) => !prismIds.has(r["Gaz ID"]));
const prismPath = paths.build("prism_locations_needed.csv");
if (needPrism.length) {
  fs.writeFileSync(prismPath, needPrism.map((r) => `${r.Latitude},${r.Longitude},${r["Gaz ID"]}`).join("\n") + "\n");
} else if (fs.existsSync(prismPath)) {
  fs.unlinkSync(prismPath);
}

console.log(`Done! Wrote ${rows.length} communities to ${outputPath}`);
console.log(`  Added from UGRC points (no GNIS record): ${addedFromUgrc.length}${addedFromUgrc.length ? " (" + addedFromUgrc.join(", ") + ")" : ""}`);
if (renamedByUgrc.length) console.log(`  Renamed to UGRC's name: ${renamedByUgrc.join(", ")}`);
console.log(`  Left out (excluded_places.json): ${beforeExclude - rows.length}`);
console.log(`  Census places: ${rows.filter((r) => census[r["Census Code"]]).length} of ${Object.keys(census).length}`);
console.log(`  With elevation: ${rows.filter((r) => r.Elevation).length} (from ${elevFileCount} GNIS search files)`);
console.log(`  Need PRISM precipitation: ${needPrism.length}${needPrism.length ? " (see build/prism_locations_needed.csv)" : ""}`);
if (addedFromCivil.length) console.log(`  Census places added from Civil records (rule 4): ${addedFromCivil.join(", ")}`);
const missingCensus = Object.keys(census).filter((c) => !rows.some((r) => r["Census Code"] === c));
if (missingCensus.length) console.log(`  Census places not found in GNIS: ${missingCensus.map((c) => census[c].name).join(", ")}`);
