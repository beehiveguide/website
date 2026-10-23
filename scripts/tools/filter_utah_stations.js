// One-time cleanup: keeps only Utah station files in a folder of NOAA normals
// CSVs and deletes the rest.
// Run from the website folder:
//   node scripts/lib/filter_utah_stations.js sources/noaa/multivariate_annual_normals
// Deletes can't be undone. If no Utah files match, nothing is deleted.
const fs = require("fs");
const path = require("path");

const dir = process.argv[2] || ".";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".csv"));

const isUtah = (f) => {
  const head = fs
    .readFileSync(path.join(dir, f), "utf8")
    .split(/\r?\n/)
    .slice(0, 2)
    .join("\n");
  return /, UT US/.test(head);
};

const utah = new Set(files.filter(isUtah));
if (utah.size === 0) {
  console.log("No Utah files matched. Nothing deleted.");
  process.exit(1);
}

for (const f of files) {
  if (!utah.has(f)) fs.unlinkSync(path.join(dir, f));
}
console.log(`Kept ${utah.size} Utah files, deleted ${files.length - utah.size}.`);
