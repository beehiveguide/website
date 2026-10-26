// Builds build/services.json: city hall, culinary water system, law
// enforcement area and fire area/stations for each community.
//
//   City hall      Blank for now; waiting on a better source.
//   Culinary water Active community water systems (SYSTEMTYPE C) whose service
//                  area contains the community's point. Linked to Utah Division
//                  of Water Rights.
//   Law            Law enforcement boundaries that contain the community's point,
//                  with tribal police by reservation (see below).
//   Fire area      Fire response areas that contain the community's point. Uses
//                  any sources/ugrc/FireResponseAreas*.geojson; blank until one is added.
//   Fire stations  Fire stations whose city field matches the community.
//
// Output: { "<Gaz ID>": { cityHall: [...], water: [...], law: [...], fireArea: [...], fireStations: [...] } }
// Each item is { name, note, url }.
const fs = require("fs");
const path = require("path");
const {
  nameKey, makeFinder, fixUrl, readGeoJson, makeAreaFinder, listCommunities, findGeoJson,
} = require("./lib/communities");

const paths = require("./lib/paths");
const outputPath = paths.build("services.json");
const census = JSON.parse(fs.readFileSync(require("./lib/paths").build("census.json"), "utf8"));
const communities = listCommunities();
const output = {};
const entry = (id) => (output[id] = output[id] || {});
const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const stats = {};
const count = (key, matched) => {
  stats[key] = stats[key] || { matched: 0, total: 0 };
  stats[key].total++;
  if (matched) stats[key].matched++;
};

// --- City halls: left blank until a better source is added.

// --- Boundary lookups by the community's point
function addAreas(key, features, toItem) {
  const findAreas = makeAreaFinder(features);
  for (const c of communities) {
    const items = findAreas(c.lng, c.lat).map(toItem);
    count(key, items.length > 0);
    if (!items.length) continue;
    // Drop repeats (same system listed twice)
    const seen = new Set();
    entry(c.id)[key] = items.filter((i) => !seen.has(i.name) && seen.add(i.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

addAreas(
  "water",
  readGeoJson("CulinaryWaterServiceAreas").filter((f) =>
    f.properties.SYSTEMTYPE === "C" && f.properties.STATUS === "A"),
  (f) => ({ name: (f.properties.DWNAME || f.properties.WRNAME).trim(), note: "", url: fixUrl(f.properties.WRLINK) }),
);

addAreas(
  "law",
  readGeoJson("LawEnforcementBoundaries"),
  (f) => ({ name: titleCase((f.properties.DsplayName || f.properties.NAME).trim()), note: "", url: "" }),
);

// --- Tribal police by reservation. UGRC's tribal police areas cover only
// scattered trust land, so a town's point lands in one by chance (Mount
// Emmons but not Roosevelt). Instead, every community inside a reservation's
// outer boundary (Census) gets that reservation's tribal police
// (config/tribal_police.json), and the point-based tribal entries are dropped.
{
  const TRIBAL = /tribal|navajo nation/i;
  const tribalPolice = paths.readJson(paths.config("tribal_police.json"));
  const tribalFirst = new Set(paths.readJson(paths.config("tribal_first.json")).places);
  // "Duchesne County" by Gaz ID, from build/communities.csv
  const countyOf = {};
  {
    const [head, ...rows] = fs.readFileSync(paths.build("communities.csv"), "utf8").trim().split(/\r?\n/);
    const h = head.split(",");
    for (const row of rows) {
      const c = row.split(",");
      countyOf[c[h.indexOf("Gaz ID")]] = c[h.indexOf("County")];
    }
  }
  const resFile = paths.sourceFiles("census/reservations", /\.geojson$/)[0];
  const findReservations = makeAreaFinder(JSON.parse(fs.readFileSync(resFile, "utf8")).features);
  for (const c of communities) {
    const e = entry(c.id);
    const law = (e.law || []).filter((l) => !TRIBAL.test(l.name));
    const reservations = findReservations(c.lng, c.lat).map((f) => f.properties.NAME);
    // Where the layer gave only tribal police, the county sheriff still covers
    // everyone else ("Myton", "Fort Duchesne")
    if (reservations.length && !law.length && countyOf[c.id])
      law.push({ name: `${countyOf[c.id]} Sheriffs Office`, note: "", url: "" });
    // note: the reservation, for "serves tribal land on the … Reservation"
    // first: tribal police lead the page (all of the Navajo Nation, plus the
    // tribal communities in config/tribal_first.json)
    for (const r of reservations)
      if (tribalPolice[r])
        law.push({
          name: tribalPolice[r], note: r, url: "", tribal: true,
          first: /^Navajo Nation/.test(r) || tribalFirst.has(c.name),
        });
    if (reservations.length) e.reservations = reservations;
    count("reservations", reservations.length > 0);
    if (law.length) e.law = law;
  }
}

if (findGeoJson("FireResponseAreas")) {
  addAreas(
    "fireArea",
    readGeoJson("FireResponseAreas"),
    (f) => ({ name: (f.properties.DsplayName || f.properties.NAME || "").trim(), note: "", url: "" }),
  );
} else {
  console.log("  No FireResponseAreas*.geojson in sources/ugrc/ yet; fire area left blank.");
}

// --- Fire stations by city name
const findCommunity = makeFinder();
for (const f of readGeoJson("FireStations")) {
  const p = f.properties;
  const id = findCommunity(p.CITY, f.geometry);
  count("fireStations", !!id);
  if (!id) continue;
  (entry(id).fireStations = entry(id).fireStations || []).push({ name: titleCase(p.NAME.trim()), note: "", url: "" });
}
for (const e of Object.values(output)) if (e.fireStations) e.fireStations.sort((a, b) => a.name.localeCompare(b.name));

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`Done! Wrote ${Object.keys(output).length} communities to ${outputPath}`);
for (const [k, s] of Object.entries(stats)) console.log(`  ${k}: ${s.matched} of ${s.total}`);
