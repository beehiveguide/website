// Builds build/phone.json from the NANPA central office code file (sources/nanpa/).
// Matches each Utah rate center to a community in build/communities.csv.
// Output: { "<Gaz ID>": { areaCodes: "801, 385", prefixes: "801: 555, 556\n385: 557" } }
// One area code: prefixes are listed alone ("555, 556").
// More than one: prefixes are grouped under each area code, one line each,
// highest area code first (801 before 385).
const fs = require("fs");
const path = require("path");

const paths = require("./lib/paths");

const codePath = paths.sourceFiles("nanpa", /^CoCodeAssignment.*\.txt$/)[0];
const csvPath = paths.build("communities.csv");
const outputPath = paths.build("phone.json");

// Rate center names are cut to 10 characters, so spell out the short ones.
const RATE_CENTER_NAMES = {
  "AMERCNFORK": "AMERICAN FORK",
  "APPLE VLLY": "APPLE VALLEY",
  "BEARRIV CY": "BEAR RIVER CITY",
  "BRIGHAM CY": "BRIGHAM CITY",
  "BRYCECNYON": "BRYCE CANYON CITY",
  "CANNONVL": "CANNONVILLE",
  "CASTLEDALE": "CASTLE DALE",
  "CIRCLEVL": "CIRCLEVILLE",
  "DUCK CREEK": "DUCK CREEK VILLAGE",
  "EAGLE MTN": "EAGLE MOUNTAIN",
  "FOUNTAGREN": "FOUNTAIN GREEN",
  "GARDENCITY": "GARDEN CITY",
  "GLNCNYONCY": "BIG WATER", // Big Water was once Glen Canyon City
  "GREENRIVER": "GREEN RIVER",
  "GROUSE CRK": "GROUSE CREEK",
  "MEXICANHAT": "MEXICAN HAT",
  "MINERSVL": "MINERSVILLE",
  "MONUMNTVLY": "OLJATO-MONUMENT VALLEY",
  "MTPLEASANT": "MOUNT PLEASANT",
  "THOMPSON": "THOMPSON SPRINGS",
  "PARKVALLEY": "PARK VALLEY",
  "PLEASATGRV": "PLEASANT GROVE",
  "RUSHVALLEY": "RUSH VALLEY",
  "SALT LAKE": "SALT LAKE CITY",
  "SOLDER SMT": "SOLDIER SUMMIT",
  "SPANIHFORK": "SPANISH FORK",
  "SPRINGVL": "SPRINGVILLE",
  "ST GEORGE": "ST. GEORGE",
};

// Rate centers whose name is shared by towns in more than one county.
const RATE_CENTER_COUNTY = {
  "ENTERPRISE": "Washington County",
};

// 1. Collect NPA-NXX codes for each Utah rate center.
const byRateCenter = {};
for (const line of fs.readFileSync(codePath, "utf8").split(/\r?\n/)) {
  const f = line.split("\t");
  if (f[0].trim() !== "UT") continue;
  const rc = f[4].trim();
  const code = f[1].trim();
  if (!rc || !/^\d{3}-\d{3}$/.test(code)) continue;
  (byRateCenter[rc] = byRateCenter[rc] || []).push(code);
}

// 2. Index communities by uppercase name.
const lines = fs.readFileSync(csvPath, "utf8").trim().split(/\r?\n/);
const headers = lines[0].split(",");
const idIdx = headers.indexOf("Gaz ID");
const nameIdx = headers.indexOf("Feature Name");
const countyIdx = headers.indexOf("County");
const byName = {};
for (const line of lines.slice(1)) {
  const c = line.split(",");
  const name = c[nameIdx].toUpperCase().replace(/^SAINT /, "ST. ");
  (byName[name] = byName[name] || []).push({ id: c[idIdx], county: c[countyIdx] });
}

// 3. Match rate centers to communities.
const output = {};
const unmatched = [];
for (const [rc, codes] of Object.entries(byRateCenter)) {
  const name = RATE_CENTER_NAMES[rc] || rc;
  // Try the name as given, then with or without a trailing "CITY"
  // ("HEBER CITY" -> "Heber", "WEST VALLEY" -> "West Valley City").
  let towns = byName[name] || byName[name.replace(/ CITY$/, "")] || byName[`${name} CITY`] || [];
  if (RATE_CENTER_COUNTY[rc]) towns = towns.filter((t) => t.county === RATE_CENTER_COUNTY[rc]);
  if (!towns.length) { unmatched.push(rc); continue; }

  const groups = {}; // area code -> prefixes
  for (const code of [...new Set(codes)].sort()) {
    const [npa, nxx] = code.split("-");
    (groups[npa] = groups[npa] || []).push(nxx);
  }
  const npas = Object.keys(groups).sort().reverse(); // 801 before 385
  const areaCodes = npas.join(", ");
  const prefixes =
    npas.length === 1
      ? groups[npas[0]].join(", ")
      : npas.map((npa) => `${npa}: ${groups[npa].join(", ")}`).join("\n");
  for (const t of towns) output[t.id] = { areaCodes, prefixes };
}

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`Done! Matched ${Object.keys(output).length} communities. Wrote ${outputPath}`);
console.log(`Rate centers with no matching community: ${unmatched.sort().join(", ")}`);
