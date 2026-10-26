// Runs every step in order: sources -> build/ -> public/.
// Run with: npm run build  (or node scripts/build.js)
const { execFileSync } = require("child_process");
const path = require("path");

const steps = [
  "01_census.js", // build/census.json (population, households)
  "02_communities.js", // build/communities.csv (community list)
  "03_phone.js", // build/phone.json (area codes, prefixes)
  "04_schools.js", // build/schools.json (schools, districts, colleges)
  "05_places.js", // build/places.json (churches, hospitals, parks, cemeteries, libraries, golf, airports)
  "06_services.js", // build/services.json (water, law, fire)
  "07_history.js", // build/history.json (founding, name origin)
  "08a_precip.js", // build/precip.json (annual precipitation)
  "08b_freeze.js", // build/freeze.json (freeze-free days)
  "08c_soil.js", // build/soil.json (topsoil in town boundaries)
  "09_merge.js", // build/communities.json (one record per community)
  "10_pages.js", // public/ (pages, index, 404, sitemap)
];

for (const step of steps) {
  console.log(`\n== ${step}`);
  execFileSync(process.execPath, [path.join(__dirname, step)], {
    stdio: "inherit",
  });
}
