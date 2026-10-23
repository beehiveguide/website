// Builds build/freeze.json from NOAA 1991-2020 Annual/Seasonal Normals.
// Reads sources/noaa/multivariate_annual_normals/*.csv (one file per station)
// and build/communities.csv (run 02_communities.js first).
// Uses NOAA's 50% probability dates for a 32°F freeze. Only communities with a
// station close by (in distance and elevation) get data; the rest are skipped.
// Output: { "<Gaz ID>": { freezeFreeDays: 198, lastSpringFreeze: "April 8", firstFallFreeze: "Oct. 24" } }
const fs = require("fs");
const path = require("path");
const paths = require("./lib/paths");
const { formatApDate } = require("./lib/ap_months");

// A station counts as "the community's station" only inside these limits.
const MAX_KM = 8;
const MAX_ELEV_M = 100; // about 330 ft
const MIN_YEARS = 10; // minimum years of data behind the NOAA values

const MONTHS = [
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
];

const outputPath = paths.build("freeze.json");

// CSV line parser (station names contain commas inside quotes)
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// "04/22" -> "April-22", the same form the PRISM dates used
function toDateStr(mmdd) {
  const m = /^(\d{2})\/(\d{2})$/.exec((mmdd || "").trim());
  if (!m) return null;
  const month = MONTHS[Number(m[1]) - 1];
  return month ? `${month}-${m[2]}` : null;
}

const km = (lat1, lng1, lat2, lng2) => {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
};

// Stations
const files = paths.sourceFiles(
  path.join("noaa", "multivariate_annual_normals"),
  /\.csv$/i,
);
const stations = [];
for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) continue;
  const h = parseCsvLine(lines[0]);
  const d = parseCsvLine(lines[1]);
  const get = (k) => d[h.indexOf(k)];

  const lastSpring = toDateStr(get("ANN-TMIN-PRBLST-T32FP50"));
  const firstFall = toDateStr(get("ANN-TMIN-PRBFST-T32FP50"));
  const days = Number(get("ANN-TMIN-PRBGSL-T32FP50"));
  const years = Number(get("years_ANN-TMIN-PRBGSL-T32FP50"));
  if (!lastSpring || !firstFall) continue;
  if (!Number.isFinite(days) || days <= 0) continue;
  if (!(years >= MIN_YEARS)) continue;

  stations.push({
    id: get("STATION"),
    name: get("NAME"),
    lat: Number(get("LATITUDE")),
    lng: Number(get("LONGITUDE")),
    elevM: Number(get("ELEVATION")),
    freezeFreeDays: days,
    lastSpringFreeze: formatApDate(lastSpring),
    firstFallFreeze: formatApDate(firstFall),
  });
}

// Communities
const lines = fs
  .readFileSync(paths.build("communities.csv"), "utf8")
  .trim()
  .split(/\r?\n/);
const header = lines[0].split(",");
const col = (k) => header.indexOf(k);

const output = {};
const matches = [];
for (const line of lines.slice(1)) {
  const c = line.split(",");
  const id = c[col("Gaz ID")];
  const lat = Number(c[col("Latitude")]);
  const lng = Number(c[col("Longitude")]);
  const elevM = Number(c[col("Elevation")]);
  if (!c[col("Elevation")] || !Number.isFinite(elevM)) continue;

  let best = null;
  for (const s of stations) {
    const dist = km(lat, lng, s.lat, s.lng);
    if (dist > MAX_KM || Math.abs(s.elevM - elevM) > MAX_ELEV_M) continue;
    if (!best || dist < best.dist) best = { s, dist };
  }
  if (!best) continue;

  output[id] = {
    freezeFreeDays: best.s.freezeFreeDays,
    lastSpringFreeze: best.s.lastSpringFreeze,
    firstFallFreeze: best.s.firstFallFreeze,
  };
  matches.push(
    `  ${c[col("Feature Name")]}: ${best.s.name} (${best.dist.toFixed(1)} km, ${Math.round(Math.abs(best.s.elevM - elevM))} m apart)`,
  );
}

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(matches.join("\n"));
console.log(
  `Done! Wrote freeze data for ${Object.keys(output).length} of ${lines.length - 1} communities (${stations.length} usable stations) to ${outputPath}`,
);
