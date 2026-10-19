// Builds build/census.json from the 2020 Census DHC files for Utah.
// Output: { "<5-digit place FIPS>": { name, pop, households } }
// Matches the "Census Code" column in build/communities.csv.
// Source: sources/census/ut2020.dhc/ (geo header and segment 1 only)
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const paths = require("./lib/paths");

const dhcDir = paths.source("census", "ut2020.dhc");
const geoPath = path.join(dhcDir, "utgeo2020.dhc");
const seg1Path = path.join(dhcDir, "ut000012020.dhc");
const outputPath = paths.build("census.json");

function readLines(file, onLine) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: fs.createReadStream(file) });
    rl.on("line", onLine);
    rl.on("close", resolve);
  });
}

(async () => {
  // 1. Geo header: keep places (summary level 160, whole place = geocomp 00).
  const places = {}; // LOGRECNO -> { code, name, pop }
  await readLines(geoPath, (line) => {
    const f = line.split("|");
    if (f[2] !== "160" || f[4] !== "00") return;
    const n = f.length;
    places[f[7]] = {
      code: f[8].slice(-5),         // GEOID 1600000US49xxxxx -> place FIPS
      name: f[n - 10],              // full name, e.g. "Logan city"
      pop: Number(f[n - 7]),        // POP100
    };
  });

  // 2. Segment 1: households = occupied housing units (H3_002).
  // Fields: 1-5 header, 6 H1_001, 7-10 H2, 11 H3_001, 12 H3_002.
  await readLines(seg1Path, (line) => {
    const f = line.split("|");
    const p = places[f[4]];
    if (p) p.households = Number(f[11]);
  });

  const output = {};
  for (const p of Object.values(places)) {
    output[p.code] = { name: p.name, pop: p.pop, households: p.households };
  }

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Done! Wrote ${Object.keys(output).length} places to ${outputPath}`);
})();
