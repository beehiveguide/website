// Folder locations, so every script reads and writes the same places.
//   sources/    raw downloads (read only)
//   config/     hand-kept lists and settings
//   build/      files the scripts make along the way
//   templates/  page templates
//   public/     the website Firebase serves
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const dirs = {
  root,
  sources: path.join(root, "sources"),
  config: path.join(root, "config"),
  build: path.join(root, "build"),
  templates: path.join(root, "templates"),
  public: path.join(root, "public"),
};
fs.mkdirSync(dirs.build, { recursive: true });

const source = (...p) => path.join(dirs.sources, ...p);
const config = (f) => path.join(dirs.config, f);
const build = (f) => path.join(dirs.build, f);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
// Every file in a source folder whose name matches a pattern
const sourceFiles = (folder, pattern) => fs.readdirSync(source(folder))
  .filter((f) => pattern.test(f)).sort().map((f) => source(folder, f));

module.exports = { dirs, source, config, build, readJson, writeJson, sourceFiles };
