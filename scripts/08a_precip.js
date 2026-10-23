// Builds build/precip.json from PRISM 1991-2020 normals downloads.
// Reads every sources/prism/monthly_normals/*PRISM*normals.csv file and keeps the "Annual" row.
// Output: { "<Gaz ID>": { precip: <avg. annual inches> } }
const fs = require("fs");
const path = require("path"); // Fixed typo: changed "patxqh" to "path"

const paths = require("./lib/paths");

const outputPath = paths.build("precip.json");
// Updated subfolder path to "monthly_normals"
const files = paths.sourceFiles(
  path.join("prism", "monthly_normals"),
  /PRISM.*normals\.csv$/i,
);

const output = {};
for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.startsWith("Name,"));
  if (headerIdx === -1) continue;

  const headers = lines[headerIdx].split(",");
  const nameIdx = headers.indexOf("Name");
  const dateIdx = headers.indexOf("Date");
  const pptIdx = headers.findIndex((h) => h.startsWith("ppt"));

  for (const line of lines.slice(headerIdx + 1)) {
    if (!line.trim()) continue;
    const c = line.split(",");
    if (c[dateIdx] === "Annual") {
      output[c[nameIdx]] = { precip: Number(c[pptIdx]) };
    }
  }
}

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(
  `Done! Wrote ${Object.keys(output).length} locations from ${files.length} files to ${outputPath}`,
);
