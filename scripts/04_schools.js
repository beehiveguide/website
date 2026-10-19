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

// PreK-12 schools
let matched = 0;
const features = readGeoJson("Schools_PreKto12");
for (const feature of features) {
  const p = feature.properties;
  const entry = findEntry(feature);
  if (!entry) continue;
  const level = p.SchoolLevel || "NONE";
  (entry.schools[level] = entry.schools[level] || []).push({
    name: p.SchoolName,
    low: p.GradeLow || "",
    high: p.GradeHigh || "",
    url: fixUrl(p.Website),
  });
  if (p.LEATYPE === "District" && !entry.districts.includes(p.LEAName)) {
    entry.districts.push(p.LEAName);
  }
  matched++;
}

// Colleges and universities
let higherMatched = 0;
const higherFeatures = readGeoJson("Schools_HigherEducation");
for (const feature of higherFeatures) {
  const p = feature.properties;
  const entry = findEntry(feature);
  if (!entry) continue;
  entry.higherEd.push({ name: p.SchoolName.trim(), url: fixUrl(p.Website) });
  higherMatched++;
}

// Sort schools, districts and colleges alphabetically.
for (const entry of Object.values(output)) {
  for (const list of Object.values(entry.schools)) list.sort((a, b) => a.name.localeCompare(b.name));
  entry.districts.sort();
  entry.higherEd.sort((a, b) => a.name.localeCompare(b.name));
}

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`Done! Matched ${matched} of ${features.length} schools to ${Object.keys(output).length} communities.`);
console.log(`Matched ${higherMatched} of ${higherFeatures.length} colleges and universities.`);
console.log(`School cities with no matching community (${findCommunity.unmatched.size}): ${[...findCommunity.unmatched].sort().join(", ")}`);
