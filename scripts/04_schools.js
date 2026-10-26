// Builds build/schools.json from the Utah PreK-12 schools GeoJSON.
// Matches each school to a community by its City field. When two communities
// share a name, the school goes to the one closest to it.
// Also adds colleges and universities from the higher education GeoJSON.
// Output: { "<Gaz ID>": { schools: { ELEM: [...], ... }, districts: [...], higherEd: [...] } }
// Rerun after changing build/communities.csv.
const fs = require("fs");
const path = require("path");
const { makeFinder, fixUrl, readGeoJson } = require("./lib/communities");

const outputPath = require("./lib/paths").build("schools.json");
const findCommunity = makeFinder();
const output = {};

function findEntry(feature) {
  const id = findCommunity(feature.properties.City, feature.geometry);
  if (!id) return null;
  return (output[id] = output[id] || { schools: {}, districts: [], higherEd: [] });
}

// PreK-12 schools. Residential treatment centers and online schools are left
// out: they aren't neighborhood schools a family would pick by town.
// Each school keeps its district (lea), whether it's a district, charter or
// private school (leaType) and whether it's an alternative school (alt).
const districtInfo = require("./lib/paths").readJson(require("./lib/paths").config("school_districts.json"));
let matched = 0, skipped = 0;
const features = readGeoJson("Schools_PreKto12");
for (const feature of features) {
  const p = feature.properties;
  if (p.SchoolType === "Residential Treatment" || p.OnlineSchool === "Y") {
    skipped++;
    continue;
  }
  const entry = findEntry(feature);
  if (!entry) continue;
  const level = p.SchoolLevel || "NONE";
  (entry.schools[level] = entry.schools[level] || []).push({
    name: p.SchoolName.trim(),
    low: p.GradeLow || "",
    high: p.GradeHigh || "",
    url: fixUrl(p.Website),
    // Full district name and website (config/school_districts.json)
    lea: (districtInfo[(p.LEAName || "").trim()] || {}).name || (p.LEAName || "").trim(),
    leaShort: (p.LEAName || "").trim(), // "Duchesne District", for tables
    leaUrl: (districtInfo[(p.LEAName || "").trim()] || {}).url || "",
    leaType: p.LEATYPE || "",
    alt: p.SchoolType === "Alternate Education",
  });
  if (p.LEATYPE === "District" && !entry.districts.includes(p.LEAName)) {
    entry.districts.push(p.LEAName);
  }
  matched++;
}

// Colleges and universities. config/higher_ed_urls.json fills in or replaces
// websites by name.
const higherUrls = require("./lib/paths").readJson(require("./lib/paths").config("higher_ed_urls.json"));
const higherNames = require("./lib/paths").readJson(require("./lib/paths").config("higher_ed_names.json"));
let higherMatched = 0;
const higherFeatures = readGeoJson("Schools_HigherEducation");
for (const feature of higherFeatures) {
  const p = feature.properties;
  const entry = findEntry(feature);
  if (!entry) continue;
  // "University Of Utah" -> "University of Utah". "Utah State University -
  // Beaver Campus" -> "Utah State University Beaver Campus", or the name in
  // config/higher_ed_names.json when dropping the dash reads badly.
  const raw = p.SchoolName.trim().replace(/\s+/g, " ");
  const name = higherNames[raw] || raw.replace(/ (Of|For) /g, (m) => m.toLowerCase()).replace(/\s+[-–—]\s+/g, " ");
  // Classes held in jails and prisons aren't open to the public
  if (/corrections|jail/i.test(name)) continue;
  entry.higherEd.push({ name, url: higherUrls[name] || fixUrl(p.Website) });
  higherMatched++;
}

// Sort schools, districts and colleges alphabetically.
for (const entry of Object.values(output)) {
  for (const list of Object.values(entry.schools)) list.sort((a, b) => a.name.localeCompare(b.name));
  entry.districts.sort();
  entry.higherEd.sort((a, b) => a.name.localeCompare(b.name));
}

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`Done! Matched ${matched} of ${features.length - skipped} schools (${skipped} residential treatment or online left out) to ${Object.keys(output).length} communities.`);
console.log(`Matched ${higherMatched} of ${higherFeatures.length} colleges and universities.`);
console.log(`School cities with no matching community (${findCommunity.unmatched.size}): ${[...findCommunity.unmatched].sort().join(", ")}`);
