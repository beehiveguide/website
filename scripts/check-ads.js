// Checks every ad in config/bookshop.json and config/awin.json and writes the
// ones that are broken to config/ads-broken.json. The build then leaves those
// out (scripts/lib/affiliate.js). Runs before each deploy; run it alone with
// `npm run check-ads`. If the network is down it changes nothing.
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "config");
const read = (f) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  } catch (e) {
    return null;
  }
};
const today = new Date().toISOString().slice(0, 10);
const live = (x) => !x.disabled && (!x.ends || x.ends >= today);

async function get(url, wantImage) {
  try {
    const r = await fetch(url, { redirect: wantImage === "link" ? "manual" : "follow", signal: AbortSignal.timeout(20000) });
    if (wantImage === "link") return r.status < 400 ? "ok" : `HTTP ${r.status}`;
    if (r.status !== 200) return `HTTP ${r.status}`;
    if (wantImage && !/^image\//.test(r.headers.get("content-type") || "")) return "not an image";
    return "ok";
  } catch (e) {
    return "ERROR";
  }
}

// Run jobs a few at a time
async function pool(jobs, n = 6) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < jobs.length) {
        const j = jobs[i++];
        out.push({ ...j, result: await get(j.url, j.kind) });
      }
    })
  );
  return out;
}

(async () => {
  const bookshop = read("bookshop.json") || { books: [] };
  const awin = read("awin.json") || { images: [], text: [] };
  const id = bookshop.affiliateId;
  const jobs = [
    ...bookshop.books.filter(live).map((b) => ({
      key: "books",
      id: b.isbn,
      label: `book ${b.isbn} ${b.title || ""}`.trim(),
      url: `https://bookshop.org/widgets/book/${b.featuredOnly ? "featured" : "book"}/${id}/${b.isbn}`,
    })),
    ...awin.images.filter((i) => live(i) && !(awin.disabledBrands || []).includes(i.brand)).map((i) => ({ key: "urls", id: i.src, label: `${i.brand}: ${i.name || i.src}`, url: i.src, kind: "image" })),
    ...awin.text.filter((t) => live(t) && !(awin.disabledBrands || []).includes(t.brand)).map((t) => ({ key: "urls", id: t.href, label: `${t.brand} text link: ${t.label}`, url: t.href, kind: "link" })),
  ];
  console.log(`Checking ${jobs.length} ads...`);
  const res = await pool(jobs);
  const errors = res.filter((r) => r.result === "ERROR");
  if (errors.length > res.length / 2) {
    console.log("Most checks failed to connect, so the network looks down. Nothing changed.");
    return;
  }
  const bad = res.filter((r) => r.result !== "ok" && r.result !== "ERROR");
  const broken = { checked: today, books: [], urls: [] };
  bad.forEach((r) => broken[r.key].push(r.id));
  fs.writeFileSync(path.join(dir, "ads-broken.json"), JSON.stringify(broken, null, 2) + "\n");
  if (errors.length) console.log(`${errors.length} could not be reached (timeouts), left alone:\n  ` + errors.map((r) => r.label).join("\n  "));
  if (bad.length) {
    console.log(`\n${bad.length} broken, left out of this build:`);
    bad.forEach((r) => console.log(`  ${r.label} (${r.result})`));
  } else console.log("All ads look good.");
})();
