// Shared helpers for matching data to communities in build/communities.csv.
const fs = require("fs");
const path = require("path");
const paths = require("./paths");

const ugrcDir = paths.source("ugrc");
const communitiesCsv = paths.build("communities.csv");

// Name key that ignores case, spacing and periods and common short forms,
// so "LA VERKIN" matches "LaVerkin", "MT PLEASANT" matches "Mount Pleasant"
// and "SAINT GEORGE" matches "St. George".
const CITY_ALIASES = { "MS CITY": "MARRIOTT-SLATERVILLE" };
function nameKey(name) {
  let n = (name || "").trim().toUpperCase();
  n = CITY_ALIASES[n] || n;
  return n
    .replace(/^MT\.? /, "MOUNT ")
    .replace(/^(SAINT|ST\.?) /, "ST ")
    .replace(/[^A-Z]/g, "");
}

// Load communities, indexed by name key.
function loadCommunities() {
  const lines = fs.readFileSync(communitiesCsv, "utf8")
    .trim().split(/\r?\n/);
  const h = lines[0].split(",");
  const idx = (name) => h.indexOf(name);
  const byName = {};
  for (const line of lines.slice(1)) {
    const c = line.split(",");
    const key = nameKey(c[idx("Feature Name")]);
    (byName[key] = byName[key] || []).push({
      id: c[idx("Gaz ID")],
      lat: Number(c[idx("Latitude")]),
      lng: Number(c[idx("Longitude")]),
    });
  }
  return byName;
}

// A [lng, lat] point for any GeoJSON geometry (polygons use the average of
// their outer ring).
function pointOf(geometry) {
  if (!geometry) return null;
  if (geometry.type === "Point") return geometry.coordinates;
  const ring =
    geometry.type === "Polygon" ? geometry.coordinates[0] :
    geometry.type === "MultiPolygon" ? geometry.coordinates[0][0] : null;
  if (!ring || !ring.length) return null;
  const sum = ring.reduce((s, [x, y]) => [s[0] + x, s[1] + y], [0, 0]);
  return [sum[0] / ring.length, sum[1] / ring.length];
}

// Returns a function that finds the community for a city name and location.
// Tries the name as given, then with or without a trailing "CITY"
// ("WEST HAVEN CITY" -> "West Haven", "WEST VALLEY" -> "West Valley City").
// When several communities share the name, picks the closest one.
// Unmatched city names are collected in finder.unmatched.
function makeFinder() {
  const byName = loadCommunities();
  const unmatched = new Set();
  function find(city, geometry) {
    city = (city || "").trim().toUpperCase();
    if (!city) { unmatched.add("(no city)"); return null; }
    const towns = byName[nameKey(city)] || byName[nameKey(city.replace(/ CITY$/, ""))] ||
      byName[nameKey(`${city} CITY`)];
    if (!towns) { unmatched.add(city); return null; }
    const [lng, lat] = pointOf(geometry) || [towns[0].lng, towns[0].lat];
    return towns.reduce((best, t) =>
      (t.lat - lat) ** 2 + (t.lng - lng) ** 2 < (best.lat - lat) ** 2 + (best.lng - lng) ** 2 ? t : best).id;
  }
  find.unmatched = unmatched;
  return find;
}

function fixUrl(url) {
  if (!url) return "";
  url = String(url).trim();
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function readGeoJson(fileStart) {
  const file = findGeoJson(fileStart);
  if (!file) throw new Error(`No GeoJSON starting with ${fileStart} in sources/ugrc/`);
  return JSON.parse(fs.readFileSync(path.join(ugrcDir, file), "utf8")).features;
}

module.exports = { nameKey, makeFinder, fixUrl, readGeoJson };

// --- Point-in-polygon helpers for boundary files.

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Polygon = [outer ring, ...holes]
function inPolygon(point, polygon) {
  if (!inRing(point, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => inRing(point, hole));
}

// Prepares GeoJSON polygon features for fast lookups.
// Returns a function (lng, lat) -> list of features that contain the point.
function makeAreaFinder(features) {
  const areas = [];
  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    if (!polys.length) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of polys) for (const [x, y] of poly[0]) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    areas.push({ feature: f, polys, minX, minY, maxX, maxY });
  }
  return (lng, lat) => areas
    .filter((a) => lng >= a.minX && lng <= a.maxX && lat >= a.minY && lat <= a.maxY)
    .filter((a) => a.polys.some((poly) => inPolygon([lng, lat], poly)))
    .map((a) => a.feature);
}

// All communities as a list: { id, name, lat, lng, censusCode }
function listCommunities() {
  const lines = fs.readFileSync(communitiesCsv, "utf8")
    .trim().split(/\r?\n/);
  const h = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const c = line.split(",");
    return {
      id: c[h.indexOf("Gaz ID")],
      name: c[h.indexOf("Feature Name")],
      lat: Number(c[h.indexOf("Latitude")]),
      lng: Number(c[h.indexOf("Longitude")]),
      censusCode: c[h.indexOf("Census Code")],
    };
  });
}

function findGeoJson(fileStart) {
  return fs.readdirSync(ugrcDir).find((f) => f.startsWith(fileStart) && f.endsWith(".geojson")) || null;
}

module.exports.makeAreaFinder = makeAreaFinder;
module.exports.listCommunities = listCommunities;
module.exports.findGeoJson = findGeoJson;

// Census block GEOID (15 digits) -> 2020 census place code (5 digits),
// read from the census geographic header. Blocks outside any place are left out.
function loadBlockPlaces() {
  const geoPath = paths.source("census", "ut2020.dhc", "utgeo2020.dhc");
  const map = {};
  for (const line of fs.readFileSync(geoPath, "utf8").split(/\r?\n/)) {
    const f = line.split("|");
    if (f[2] !== "100") continue; // summary level 100 = block
    if (f[29] && f[29] !== "99999") map[f[9]] = f[29]; // field 10 GEOID, field 30 PLACE
  }
  return map;
}

module.exports.loadBlockPlaces = loadBlockPlaces;
