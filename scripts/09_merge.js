// Merges every build file into build/communities.json, one record per
// community. The page step reads only this file, config/site.json and
// sources/sources.json.
//
// Also works out here (from sources):
//   ZIP code and hardiness zone  sources/ugrc/UtahZipCodeAreas*.geojson
//                                + sources/usda/phzm_us_zipcode_2023.csv
//   Post office page             sources/ugrc/PostOffices*.geojson
//                                + sources/usps/post_office_urls.json
const fs = require("fs");
const paths = require("./lib/paths");
const {
  makeFinder,
  readGeoJson,
  makeAreaFinder,
  nameKey,
} = require("./lib/communities");

const read = (f) => paths.readJson(paths.build(f));
const census = read("census.json");
const ugrcPopulation = read("ugrc_population.json");
const history = read("history.json");
const phone = read("phone.json");
const precip = read("precip.json");
const freeze = paths.readJson(paths.build("freeze.json"), {});
const soil = paths.readJson(paths.build("soil.json"));
const schools = read("schools.json");
const places = read("places.json");
const services = read("services.json");

// Rows of build/communities.csv as objects
const lines = fs
  .readFileSync(paths.build("communities.csv"), "utf8")
  .trim()
  .split(/\r?\n/);
const h = lines[0].split(",");
const rows = lines.slice(1).map((line) => {
  const c = line.split(",");
  return Object.fromEntries(h.map((k, i) => [k, c[i] || ""]));
});

// Hardiness zone is published by ZIP code
const zipAt = makeAreaFinder(readGeoJson("UtahZipCodeAreas"));
const zones = {};
for (const line of fs
  .readFileSync(paths.source("usda", "phzm_us_zipcode_2023.csv"), "utf8")
  .split(/\r?\n/)
  .slice(1)) {
  const [zip, zone] = line.split(",");
  if (zip) zones[zip] = zone;
}

// Post offices (UGRC), matched to communities by town name, or by mailing city
// when the town name is a branch name ("Sandy - Main"). A community with more
// than one keeps the one closest to its point. Only offices with a USPS page
// are kept.
const postOffices = {};
{
  const findCommunity = makeFinder();
  const uspsUrls = {};
  for (const o of paths.readJson(paths.source("usps", "post_office_urls.json")))
    if (o.url) uspsUrls[o.objectid] = o.url;
  for (const f of readGeoJson("PostOffices")) {
    const p = f.properties;
    if (!uspsUrls[p.OBJECTID]) continue;
    const id =
      findCommunity(p.TOWN, f.geometry) || findCommunity(p.CITY, f.geometry);
    if (!id) continue;
    (postOffices[id] = postOffices[id] || []).push({
      url: uspsUrls[p.OBJECTID],
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    });
  }
}
// County seats (config/county_seats.json), matched by county and name.
// "Heber City" matches "Heber"; every county must find its seat.
const seatKeys = new Set();
{
  const { seats } = paths.readJson(paths.config("county_seats.json"));
  for (const [county, town] of Object.entries(seats)) {
    const keys = [nameKey(town), nameKey(town.replace(/ City$/, ""))];
    const row = rows.find(
      (t) =>
        t.County === `${county} County` &&
        keys.includes(nameKey(t["Feature Name"])),
    );
    if (row) seatKeys.add(row["Gaz ID"]);
    else console.warn(`  County seat not found: ${town}, ${county} County`);
  }
}

const nearest = (list, lat, lng) =>
  (list || [])
    .slice()
    .sort(
      (a, b) =>
        (a.lat - lat) ** 2 +
        (a.lng - lng) ** 2 -
        ((b.lat - lat) ** 2 + (b.lng - lng) ** 2),
    )[0];

const records = rows.map((t) => {
  const id = t["Gaz ID"];
  const lat = Number(t.Latitude),
    lng = Number(t.Longitude);
  const cen = census[t["Census Code"]];
  const zipFeature = zipAt(lng, lat)[0];
  const zip = zipFeature ? String(zipFeature.properties.ZIP5) : "";
  const po = nearest(postOffices[id], lat, lng);
  return {
    id,
    name: t["Feature Name"].replace(/ \(historical\)$/, ""),
    gnisName: t["Feature Name"],
    class: t.Class,
    county: t.County.replace(/ County$/, ""),
    countySeat: seatKeys.has(id),
    lat,
    lng,
    // GNIS gives meters
    elevationFt: t.Elevation ? Math.round(Number(t.Elevation) * 3.28084) : null,
    censusCode: t["Census Code"],
    censusClass: t["Census Classification Code"],
    population: cen
      ? { count: cen.pop, households: cen.households, source: "census" }
      : ugrcPopulation[id] !== undefined
        ? { count: ugrcPopulation[id], source: "ugrcPop" }
        : null,
    founded: history[id]?.founded || "",
    origin: history[id]?.origin || "",
    phone: phone[id] || null,
    zip,
    hardinessZone: zones[zip] || "",
    precipIn: precip[id] ? precip[id].precip : null,
    freezeFreeDays: freeze[id] ? freeze[id].freezeFreeDays : undefined,
    lastSpringFreeze: freeze[id] ? freeze[id].lastSpringFreeze : undefined,
    firstFallFreeze: freeze[id] ? freeze[id].firstFallFreeze : undefined,
    soil: soil[id] || null,
    postOfficeUrl: po ? po.url : "",
    schools: schools[id] || null,
    places: places[id] || null,
    services: services[id] || null,
  };
});

paths.writeJson(paths.build("communities.json"), records);
const count = (fn) => records.filter(fn).length;
console.log(
  `Done! Wrote ${records.length} communities to build/communities.json`,
);
console.log(`  County seats: ${count((r) => r.countySeat)}`);
console.log(
  `  Population: ${count((r) => r.population)}, hardiness zone: ${count((r) => r.hardinessZone)}, ` +
    `precipitation: ${count((r) => r.precipIn !== null)}, freeze: ${count((r) => r.freezeFreeDays !== undefined)}, soil: ${count((r) => r.soil)}, post office: ${count((r) => r.postOfficeUrl)}`,
);
