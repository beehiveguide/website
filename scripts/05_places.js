// Builds build/places.json: churches, hospitals, parks, cemeteries, libraries,
// golf courses and airports for each community, matched by city name.
// Each item is { name, note, url, noteUrl } and shows in the table as
// "Name (note)", with the name linked when there's a url and the note
// linked when there's a noteUrl.
// Output: { "<Gaz ID>": { churches: [...], hospitals: [...], parks: [...], cemeteries: [...],
//                         libraries: [...], golf: [...], airports: [...] } }
// Rerun after changing build/communities.csv.
const fs = require("fs");
const path = require("path");
const {
  makeFinder, fixUrl, readGeoJson, loadBlockPlaces, listCommunities,
} = require("./lib/communities");

const outputPath = require("./lib/paths").build("places.json");
const findCommunity = makeFinder();
const output = {};
const counts = {};

function add(category, city, geometry, item, group) {
  counts[category] = counts[category] || { matched: 0, total: 0 };
  counts[category].total++;
  const id = findCommunity(city, geometry);
  if (!id) return;
  counts[category].matched++;
  const entry = (output[id] = output[id] || {});
  if (group) {
    entry[category] = entry[category] || {};
    (entry[category][group] = entry[category][group] || []).push(item);
  } else {
    (entry[category] = entry[category] || []).push(item);
  }
}

const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// --- Churches and other places of worship (OpenSourcePlaces / OpenStreetMap).
// Their city field is the post office city, so each one is placed by its
// census block instead: the block tells which city, town or CDP it's in.
// Places outside any census place fall back to the city field.
// Each shows as "Name (address)" with the address linked to its map location.
// Address: OpenStreetMap's if given, else UGRC's nearest address point.
// With no address, "coords." is linked instead.
{
  const blockPlaces = loadBlockPlaces();
  const byCensusCode = {};
  for (const c of listCommunities()) if (c.censusCode) byCensusCode[c.censusCode] = c.id;
  const WORSHIP = /^(christian|buddhist|muslim|jewish|hindu)/;
  let total = 0, matched = 0;
  for (const f of readGeoJson("OpenSourcePlaces")) {
    const p = f.properties;
    if (!WORSHIP.test(p.category) || !p.name) continue;
    total++;
    const id = byCensusCode[blockPlaces[p.block_id]] || findCommunity(p.city, f.geometry);
    if (!id) continue;
    matched++;
    const lat = Number(p.lat), lng = Number(p.lon);
    const mapUrl = `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
    const address = (p.osm_addr || p.ugrc_addr || "").trim();
    output[id] = output[id] || {};
    (output[id].churches = output[id].churches || []).push(
      { name: p.name.trim(), note: address || "coords.", noteUrl: mapUrl, url: "" });
  }
  counts.churches = { matched, total };
}

// --- Hospitals (other licensed health care facilities left out)
for (const f of readGeoJson("LicensedHealthCareFacilities")) {
  const p = f.properties;
  if (p.LICENSE_TYPE !== "Hospital") continue;
  add("hospitals", p.CITY, f.geometry, { name: p.FACILITY_NAME.trim(), note: "", url: "" });
}

// --- Parks (planned "Future" parks left out). A park in more than one piece
// ("Northwest Park" and "Northwest Park Phase 2") counts once, kept once per
// community in 10_pages.js. Generic names ("Park", "Ball Park") are marked
// generic: the page counts them instead of listing them.
const GENERIC_PARKS = new Set(["park", "ball park", "ballpark", "sports park", "public park"]);
for (const f of readGeoJson("UtahParksLocal")) {
  const p = f.properties;
  if (p.STATUS === "Future" || !p.NAME) continue;
  const name = p.NAME.trim().replace(/\s+/g, " ").replace(/\s+Phase\s+\w+$/i, "");
  const notes = [];
  if (p.TYPE && p.TYPE !== "Park") notes.push(p.TYPE);
  add("parks", p.CITY, f.geometry, {
    name, note: notes.join(", "), url: "", generic: GENERIC_PARKS.has(name.toLowerCase()),
  });
}

// --- Cemeteries (name linked to its map location). Single graves listed in
// the layer ("Ephraims Grave") are left out. A town name tacked on the end
// ("Mountain View Cemetery - Beaver") is dropped. year: first burial or
// founding year, when known.
for (const f of readGeoJson("Cemeteries")) {
  const p = f.properties;
  if (/\bgrave\b/i.test(p.Cemetery) && !/cemetery|graveyard/i.test(p.Cemetery)) continue;
  const year = String(p.Year_Established_First_Burial || "").match(/\b(1[6-9]|20)\d\d\b(?!'?s)/); // not "1800's"
  // Link to its location on Google Maps
  const [lng, lat] = f.geometry ? f.geometry.coordinates : [];
  const url = lat && lng ? `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}` : "";
  add("cemeteries", p.City, f.geometry, {
    name: p.Cemetery.trim().replace(/\s+-\s+[^-]+$/, ""), note: "", url, year: year ? year[0] : "",
  });
}

// --- Libraries (type shown when not a regular public library)
for (const f of readGeoJson("PublicLibraries")) {
  const p = f.properties;
  add("libraries", p.CITY, f.geometry, {
    name: p.LIBRARY.trim(),
    note: p.TYPE && p.TYPE !== "Public" ? p.TYPE : "",
    url: fixUrl(p.WEBSITE),
  });
}

// --- Golf courses (private ones left out)
for (const f of readGeoJson("GolfCourses")) {
  const p = f.properties;
  if (p.Type === "Private") continue;
  const notes = [];
  if (p.Holes) notes.push(`${p.Holes} holes`);
  if (p.Type) notes.push(p.Type);
  add("golf", p.City, f.geometry, { name: p.NAME.trim(), note: notes.join(", "), url: "" });
}

// --- Public-use airports and heliports (private-use ones left out)
for (const f of readGeoJson("AirportLocations")) {
  const p = f.properties;
  if (p.FAC_USE !== "PU") continue;
  const kind = (p.LAN_FA_TY || "").toLowerCase();
  add("airports", p.CITY_NAME, f.geometry, {
    name: titleCase(p.FULLNAME.trim()),
    note: kind === "airport" ? "" : kind,
    url: "",
  });
}

// Sort everything by name.
const byName = (a, b) => a.name.localeCompare(b.name);
for (const entry of Object.values(output)) {
  for (const value of Object.values(entry)) {
    if (Array.isArray(value)) value.sort(byName);
    else Object.values(value).forEach((list) => list.sort(byName));
  }
}

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`Done! Wrote ${Object.keys(output).length} communities to ${outputPath}`);
for (const [category, c] of Object.entries(counts)) console.log(`  ${category}: matched ${c.matched} of ${c.total}`);
console.log(`  City names with no matching community (${findCommunity.unmatched.size}): ${[...findCommunity.unmatched].sort().join(", ")}`);
