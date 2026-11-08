// Builds the website in public/ from build/communities.json.
//
// Usage
//   node scripts/10_pages.js                     every community
//   node scripts/10_pages.js Bluff Moab "Cedar City"
//   node scripts/10_pages.js --out test-run      write somewhere other than public/
//   node scripts/10_pages.js --clean-links       links without ".html" (used by npm run deploy)
//   Names or Gaz IDs both work. A name shared by several communities builds each one.
//
// Writes
//   communities/<name>.html  one page per community (templates/town-page.html)
//   index.html                    search and county list (templates/index.html)
//   about.html, contact.html      (templates/about.html, templates/contact.html)
//   blog.html, blog/<slug>.html   (config/posts.json, posts/, templates/blog.html, templates/post.html)
//   404.html                      (templates/404.html)
//   sitemap.xml
//   everything in static/ (fonts, CSS, images, map script), copied as is
//
// Reads build/communities.json, config/, sources/sources.json and templates/.
const fs = require("fs");
const path = require("path");
const paths = require("./lib/paths");
const { AP_MONTHS } = require("./lib/ap_months");

const site = paths.readJson(paths.config("site.json"));
const SOURCE_LIST = paths.readJson(paths.source("sources.json"));
// Pages not to publish (config/no_publish.json): left out of every list, and
// their old URLs redirect to "redirect_to" (another community) or the home page.
const noPublish = paths.readJson(paths.config("no_publish.json"));
const isNoPublish = (t) => noPublish.some((x) => x.name === t.name && x.county === t.county);
const allCommunities = paths.readJson(paths.build("communities.json"));
for (const x of noPublish)
  if (!allCommunities.some((t) => t.name === x.name && t.county === x.county))
    console.warn(`  no_publish.json: no community named ${x.name} (${x.county})`);
const communities = allCommunities.filter((t) => !isNoPublish(t));
const photos = paths.readJson(paths.config("photos.json"));
// Published path of a photo's web version: "static/images/x.webp" -> "images/x.webp"
const photoPath = (file) => file.replace(/^static\//, "");
// Homepage photo ("homePhoto" in config/site.json, an id from config/photos.json)
const homePhoto = (() => {
  const p = photos.find((x) => x.id === site.homePhoto);
  if (!p)
    throw new Error(
      `homePhoto "${site.homePhoto}" not found in config/photos.json`,
    );
  return {
    desktop: photoPath(p.web.desktop.file),
    mobile: photoPath(p.web.mobile.file),
    alt: p.alt,
  };
})();
const template = (f) =>
  fs.readFileSync(path.join(paths.dirs.templates, f), "utf8");
const fill = (html, values) => {
  for (const [k, v] of Object.entries(values)) html = html.split(k).join(v);
  return html;
};

// --- Arguments
const args = process.argv.slice(2);
let outDir = paths.dirs.public;
const wanted = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") outDir = path.resolve(paths.dirs.root, args[++i]);
  // Links without ".html" (for Firebase); "npm run deploy" builds this way
  else if (args[i] === "--clean-links") site.cleanLinks = true;
  else wanted.push(args[i]);
}

// --- Formatting
const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const num = (n) => Number(n).toLocaleString("en-US");
const NA = "Not available";
const MONTHS = Object.values(AP_MONTHS);
const now = new Date();
// Local date as "2026-11-01"
const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayIso = isoDate(now);
// "2026-11-01" -> "Nov. 1, 2026" (AP style)
const apDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

// --- Page "Updated" dates
// A town page's date changes only when its own content changes, not every
// time the site is rebuilt or deployed. build/page-dates.json keeps, for
// each page, a fingerprint of its words and links (lib/page_fingerprint.js)
// and the date they last changed. The header, footer, ads and markup
// changes don't count.
const PAGE_DATES_FILE = paths.build("page-dates.json");
const pageDates = fs.existsSync(PAGE_DATES_FILE)
  ? paths.readJson(PAGE_DATES_FILE)
  : {};
const { DATE_MARK, fingerprint } = require("./lib/page_fingerprint");
// First run with no record: keep the date already on the published page.
const AP_MONTH_NUM = Object.fromEntries(MONTHS.map((m, i) => [m, i + 1]));
function publishedDate(file) {
  const f = path.join(paths.dirs.public, "communities", file);
  if (!fs.existsSync(f)) return null;
  const m = fs
    .readFileSync(f, "utf8")
    .match(/Updated\s+([A-Z][a-z]+\.?) (\d{1,2}), (\d{4})\./);
  if (!m || !AP_MONTH_NUM[m[1]]) return null;
  return `${m[3]}-${String(AP_MONTH_NUM[m[1]]).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}
function pageDate(file, html) {
  const hash = fingerprint(html);
  const rec = pageDates[file];
  if (rec && rec.hash === hash) return rec.date;
  const date = (!rec && publishedDate(file)) || todayIso;
  pageDates[file] = { hash, date };
  return date;
}
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// Internal links. With cleanLinks (Firebase cleanUrls), ".html" and
// "index.html" are left off: "communities/kanab", "../#community-profiles".
const link = (href) =>
  site.cleanLinks
    ? href.replace(/index\.html(?=#|$)/, "").replace(/\.html(?=#|$)/, "") ||
      "./"
    : href;
const COMMUNITY_PROFILES_URL = link("../index.html#community-profiles");

// Names used by more than one community get the county in their filename
// (avon-cache.html, avon-iron.html) and heading ("Avon (Cache), Utah").
const nameCounts = {};
for (const t of communities)
  nameCounts[slug(t.name)] = (nameCounts[slug(t.name)] || 0) + 1;
const shared = (t) => nameCounts[slug(t.name)] > 1;
const fileName = (t) =>
  shared(t) ? `${slug(t.name)}-${slug(t.county)}.html` : `${slug(t.name)}.html`;

// Redirects for no-publish pages, written into firebase.json. Old URLs keep
// the filenames they had when every community was built.
{
  const oldCounts = {};
  for (const t of allCommunities) oldCounts[slug(t.name)] = (oldCounts[slug(t.name)] || 0) + 1;
  const oldName = (t) =>
    oldCounts[slug(t.name)] > 1 ? `${slug(t.name)}-${slug(t.county)}` : slug(t.name);
  const redirects = [];
  for (const x of noPublish) {
    let destination = "/";
    if (x.redirect_to) {
      const target = communities.find((t) => t.name === x.redirect_to);
      if (target) destination = `/communities/${fileName(target).replace(/\.html$/, "")}`;
      else console.warn(`  no_publish.json: redirect_to ${x.redirect_to} is not a published community`);
    }
    const from = `/communities/${oldName(x)}`;
    redirects.push({ source: from, destination, type: 301 }, { source: `${from}.html`, destination, type: 301 });
  }
  // Blog posts that changed file names: each old name in a post's
  // "oldSlugs" (config/posts.json) sends readers to its current page
  if (fs.existsSync(paths.config("posts.json")))
    for (const p of paths.readJson(paths.config("posts.json")))
      for (const o of p.oldSlugs || []) {
        const destination = `/blog/${p.slug}`;
        redirects.push({ source: `/blog/${o}`, destination, type: 301 }, { source: `/blog/${o}.html`, destination, type: 301 });
      }
  const fbPath = path.join(__dirname, "..", "firebase.json");
  const fb = JSON.parse(fs.readFileSync(fbPath, "utf8"));
  if (JSON.stringify(fb.hosting.redirects || []) !== JSON.stringify(redirects)) {
    fb.hosting.redirects = redirects;
    fs.writeFileSync(fbPath, JSON.stringify(fb, null, 2) + "\n");
    console.log(`  Wrote ${redirects.length / 2} redirects to firebase.json`);
  }
}

// Each source: what it supplied (bold, first), then the source, linked.
// Names and links come from sources/sources.json.
const source = (items, key, prefix = "") => {
  const s = SOURCE_LIST[key];
  // "url" in sources.json is where the data was downloaded; "publicUrl" (when
  // set) is the public-facing page readers are sent to instead.
  const href = s.publicUrl || s.url;
  // A license (sources.json "license": { name, url }) follows as a small gray
  // sans serif link in parentheses: "UGRC <small>(CC-BY-4.0)</small>"
  const license = s.license ? ` <small class="font-sans fst-italic text-secondary">(<a href="${s.license.url}" class="link-secondary">${esc(s.license.name)}</a>)</small>` : "";
  return `<strong>${items}:</strong> ${prefix}${href ? `<a href="${href}">${esc(s.name)}</a>` : esc(s.name)}${license}`;
};
// Soil paragraph (build/soil.json via 09_merge.js), under an h3 in Gardening
// Info. Only towns with a UGRC boundary have soil data.
const listText = (items) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const { phLevel, saltLevel, omLevel } = require("./lib/soil_words");
function soilHtml(t) {
  const s = t.soil;
  if (!s) return "";
  // Place notes mark outliers only (08c_soil.js) and mean "mostly there".
  // Textures: "loamy fine sand on benches (14%)". The last two sharing a place
  // read "sandy loam (19%) and loam (10%), both on valley floors".
  const tx = s.textures;
  const n = tx.length;
  const shareLast = n >= 2 && tx[n - 1].landform && tx[n - 1].landform === tx[n - 2].landform;
  const items = tx.map((x, i) =>
    x.landform && !(shareLast && i >= n - 2)
      ? `${esc(x.texture)} ${esc(x.landform)} (${x.pct}%)`
      : `${esc(x.texture)} (${x.pct}%)`);
  const textures = shareLast
    ? `${n > 2 ? `${items.slice(0, -2).join(", ")}, ` : ""}${items[n - 2]} and ${items[n - 1]}, both ${esc(tx[n - 1].landform)}`
    : listText(items);
  // "running from slightly alkaline on floodplains (pH 7.4) to strongly
  // alkaline (pH 9.0)", or "staying neutral (pH 6.8 to 7.2)" when both ends
  // share a level
  const low = phLevel(s.phMin), high = phLevel(s.phMax);
  const lo = s.phMin.toFixed(1), hi = s.phMax.toFixed(1);
  const at = (where) => (where ? ` ${esc(where)}` : "");
  // Name pH by the side the average falls on: "alkalinity averages pH 8.2",
  // "acidity averages pH 6.4", or "pH averages 7.0" when neutral (6.6-7.3)
  const avg = s.phAvg.toFixed(1);
  const phSubject = s.phAvg > 7.3 ? `alkalinity averages pH ${avg}` : s.phAvg < 6.6 ? `acidity averages pH ${avg}` : `pH averages ${avg}`;
  // The end with more land comes first: "running from strongly alkaline
  // (pH 9.0) down to neutral in washes (pH 6.6)"
  const lowEnd = `${low}${at(s.phMinWhere)} (pH ${lo})`;
  const highEnd = `${high}${at(s.phMaxWhere)} (pH ${hi})`;
  const phText = low === high
    ? `staying ${low} (pH ${lo} to ${hi})`
    : s.phHighFirst
      ? `running from ${highEnd} down to ${lowEnd}`
      : `running from ${lowEnd} to ${highEnd}`;
  // Drainage and water outliers get their own sentence:
  // "However, floodplains are mostly poorly drained, and benches hold less water."
  // A place phrase as a subject: "on floodplains" -> "floodplains"
  const placeNoun = (form) =>
    form.startsWith("between ") ? `areas ${form}` : form.replace(/^(on|in) /, "");
  const dv = s.drainageVariation;
  const v = s.awcVariation;
  const water = v && `hold ${v.awc < s.awcAvg ? "less" : "more"} water`;
  const clauses = [];
  if (dv && v && dv.landform === v.landform)
    clauses.push(`${placeNoun(dv.landform)} are mostly ${dv.drainage} and ${water}`);
  else {
    if (dv) clauses.push(`${placeNoun(dv.landform)} are mostly ${dv.drainage}`);
    if (v) clauses.push(`${placeNoun(v.landform)} ${water}`);
  }
  // Outliers run against the sentence before, so they start with "However,"
  const outliers = clauses.length ? ` However, ${esc(clauses.join(", and "))}.` : "";
  // The opening says where the town's gardenable (0-8% slope) land lies, from
  // 08c_soil.js: "Land with slopes most suitable for cultivation lies primarily in
  // the foothills, with soils including...". Spread-out towns: "Slopes
  // suitable for cultivation have soils including...".
  // "In the foothills" and "on mountainsides" keep "slopes" from repeating.
  const OPENING_WORDS = { "on foothill slopes": "in the foothills", "on mountain slopes": "on mountainsides" };
  const forms = s.arableForms.map((f) => OPENING_WORDS[f] || f);
  // "on valley floors and benches above streams", but "in the foothills and on
  // floodplains" when the two take different words
  // Each place gets the town's: "on the city's old lakeshore benches and valley
  // floors", "on the town's floodplains and in its foothills" ("the area's"
  // for places that aren't a city or town)
  const owner = t.placeType === "city" || t.placeType === "town" ? `the ${t.placeType}'s` : "the area's";
  const own = (form, who) => form.replace(/^(on|in) (the )?/, `$1 ${who} `);
  const joinPlaces = ([a, b]) => {
    if (!b) return own(a, owner);
    const pa = a.split(" ")[0], pb = b.split(" ")[0];
    return pa === pb && (pa === "on" || pa === "in")
      ? `${own(a, owner)} and ${b.slice(pb.length + 1).replace(/^the /, "")}`
      : `${own(a, owner)} and ${own(b, "its")}`;
  };
  const opening = forms.length
    ? `Land with slopes most suitable for cultivation lies primarily ${esc(joinPlaces(forms))}, with soils including`
    : `Land with slopes most suitable for cultivation has soils including`;
  // Salt, organic matter, farmland rating and limits.
  // Percentages are shares of the slopes most suitable for cultivation.
  const mostly = (p) => (p.landform ? `, mostly ${esc(p.landform)}` : "");
  const chem = [], farm = [], bedrockText = [], wet = [];
  if (s.ecAvg !== null && s.omAvg !== null) {
    const sv = s.saltVariation;
    chem.push(
      `Topsoil is typically ${saltLevel(s.ecAvg)}${sv ? `, but ${sv.level} ${esc(sv.landform)}` : ""}, with ${omLevel(s.omAvg)} organic matter (${s.omAvg.toFixed(1)}%).`,
    );
  }
  const f = s.farmland;
  const about = (pct) => (pct >= 95 ? "Nearly all" : `About ${pct}%`);
  if (f.prime > 0) {
    const prime = f.primeIfIrrigated >= f.prime * 0.8 ? "prime farmland if irrigated" : "prime farmland";
    farm.push(
      `${about(f.prime)} of this land rates as ${prime}${f.statewide >= 10 ? `, and ${f.statewide}% as farmland of statewide importance` : ""}.`,
    );
  } else if (f.statewide > 0) {
    farm.push(`${about(f.statewide)} of this land rates as farmland of statewide importance.`);
  }
  // Shares of this land: "about 18%", or "nearly all of this land" at 95% or more
  const share = (pct) => (pct >= 95 ? "nearly all of this land" : `about ${pct}%`);
  const cap = (text) => text[0].toUpperCase() + text.slice(1);
  if (s.bedrock) bedrockText.push(`Bedrock lies within 20 inches on ${share(s.bedrock.pct)}${mostly(s.bedrock)}.`);
  // A high water table and flooding in the same place share a sentence
  const wt = s.waterTable, fl = s.flooding;
  if (wt && fl && wt.landform && wt.landform === fl.landform && Math.abs(wt.pct - fl.pct) <= 5)
    wet.push(`${cap(share(Math.max(wt.pct, fl.pct)))}${mostly(wt)}, has a high water table (within 2 feet) and floods occasionally or more often.`);
  else {
    if (wt) wet.push(`A high water table (within 2 feet) affects ${share(wt.pct)}${mostly(wt)}.`);
    if (fl) wet.push(`${cap(share(fl.pct))} floods occasionally or more often${mostly(fl)}.`);
  }

  // Built-over towns end with how much was left out (urban land has no soil data)
  const urban = s.urbanPct >= 15 ? ` About ${s.urbanPct}% of ${esc(t.name)} is built over and not included.` : "";
  // Soil covers arable terrain only, 0-8% slope (08c_soil.js).
  // Left out for now; add back after the textures and "water retention":
  //   " (0&ndash;8% slope)"   `(${s.awcAvg.toFixed(2)} in./in.)`
  // One paragraph: where and what the soil is, bedrock, pH, salt and organic
  // matter, then water (drainage, retention, water table, flooding), with the
  // farmland rating last as a summary
  const sentences = [
    // One texture at 95% or more: "with soils that are nearly all loam"
    s.textures[0].pct >= 95
      ? `${opening.replace(/soils including$/, "soils that are")} nearly all ${esc(s.textures[0].texture)}.`
      : `${opening} ${textures}.`,
    ...bedrockText,
    `Estimated topsoil ${phSubject}, ${phText}.`,
    ...chem,
    `These soils are mostly ${esc(s.drainage)} with ${s.awcDesc}.${outliers}`,
    ...wet,
    ...farm,
  ];
  return `<h3 class="soil-heading h4 mt-4 mb-2">Soil Properties</h3>
    <p class="mb-0">${sentences.join(" ")}${urban}</p>`;
}

// Sources only appear for data the page shows, and their bold label
// names only what's shown (for example "Location" when there's no elevation).
const SOURCES = {
  gnis: (hasElev) =>
    source(hasElev ? "Location and elevation" : "Location", "gnis"),
  ugrcPop: source("Population", "ugrcPop"),
  census: source("Population and households", "census"),
  // also: other sources the name origin draws on ("alsoFrom" in
  // config/origin_rewrites.json), linked after the book: "... and Utah Place Names"
  history: (hasYear, hasOrigin, also = []) =>
    source(
      [hasYear && "Founding", hasOrigin && "name"]
        .filter(Boolean)
        .join(" and ")
        .replace(/^n/, "N"),
      // Name origins are reworded (config/origin_rewrites.json)
      "history",
      hasOrigin ? "Adapted from " : "",
    ).replace(/<\/li>$|$/, (end) =>
      also
        .map((k) => SOURCE_LIST[k])
        .map((x) => ` and <a href="${x.publicUrl || x.url}">${esc(x.name)}</a>`)
        .join("") + end),
  phone: (withPrefixes) =>
    source(
      withPrefixes ? "Area codes and phone prefixes" : "Area codes",
      "phone",
    ),
  zone: source("Hardiness zone", "zone"),
  precip: source("Annual precipitation", "prism"),
  freeze: source("Freeze-free days", "noaa"),
  soil: source("Soil properties", "soil"),
  reservations: source("Reservation boundaries", "censusReservations"),
  // "Law enforcement, fire, park and school": only the Community Services sections shown
  ugrc: (shown) => source(`${capFirst(listText(shown))} info`, "ugrc"),
  // Churches come from OpenStreetMap (through UGRC's places file)
  // "OpenStreetMap (Copyright and License info)": the name links to
  // openstreetmap.org; the credit links to OSM's copyright page, which explains the license
  osm: (label) => {
    const o = SOURCE_LIST.osm;
    return `<strong>${esc(capFirst(label))}:</strong> <a href="${o.publicUrl}">OpenStreetMap</a> <small class="font-sans fst-italic text-secondary">(<a href="${o.url}" class="link-secondary">Copyright and License info</a>)</small>`;
  },
};

// Shared header and footer. home: link from the page to the homepage.
// In the header, the word in "nameBox" (config/site.json) goes in a slanted box.
let siteTitle = esc(site.name);
if (site.nameBox)
  siteTitle = siteTitle.replace(
    esc(site.nameBox),
    `<span class="site-title-box"><span>${esc(site.nameBox)}</span></span>`,
  );
// shadow: Bootstrap shadow class for the header ("shadow" on every page by default)
const header = (home, shadow, root) =>
  fill(template("parts/header.html"), {
    "{Home URL}": home,
    "{Header Shadow}": shadow,
    "{About URL}": link(`${root}about.html`),
    "{Contact URL}": link(`${root}contact.html`),
    "{Blog URL}": link(`${root}blog.html`),
    "{Map URL}": link(`${root}map.html`),
    "{Site Name}": `<span class="site-title-text">${siteTitle}</span>`,
  });
// Social media links ("social" in config/site.json; icons in templates/parts/icons/),
// shared by the footer and the contact page
const socialIcon = (s) =>
  template(`parts/icons/${s.name.toLowerCase()}.svg`).trim();
const footer = fill(template("parts/footer.html"), {
  "{Year}": now.getFullYear(),
  "{Site Name}": esc(site.name),
  "{Privacy Link}": site.consentBanner
    ? `<button type="button" class="footer-privacy btn btn-light btn-sm border font-sans" style="vertical-align: middle; position: relative; top: -0.11rem;" data-consent-open>Privacy Choices</button>`
    : "",
  "{Social Handle}": esc(site.socialHandle),
  "{Social Links}": site.social
    .map(
      (s) =>
        `<a href="${esc(s.url)}" class="social-circle" title="${esc(s.name)}" aria-label="${esc(s.name)}">${socialIcon(s)}</a>`,
    )
    .join("\n      "),
});

// Wraps a page in a full HTML document. Leading <link> and <style> tags from
// the page go into <head>. The header goes at the top of the body and the
// footer before the first script (or at the end).
// Search and social sharing tags for a page's <head>. meta: { description,
// path (the page's address from the site root, like "communities/kanab.html"),
// image and imageAlt (share image in static/images/, 1200 x 630), jsonLd
// (structured data for search engines), noindex }. Full addresses need "url"
// in config/site.json; until it's set, the share image uses a relative link
// and the canonical and og:url tags are left out.
// --- Ad spots ("ads" in config/site.json). mode: "off" shows nothing,
// "setup" shows labeled gray placeholders where ads will go, "on" shows
// Google AdSense ads (needs "client", like "ca-pub-123...", and a slot ID for
// each spot). Every spot is responsive: about 728 x 90 on wide screens and
// 320 x 100 on phones, with room held so the page doesn't jump when an ad loads.
const ADS = site.ads || { mode: "off" };
// Shapes: "banner" (about 728 x 90 on wide screens, 320 x 100 on phones),
// "large" (336 x 280, up to three at the bottom of the homepage) and "rect" (300 x 250,
// up to three at the bottom of town pages).
const AD_SHAPES = {
  banner: {
    label: "728 &times; 90 on wide screens, 320 &times; 100 on phones",
    format: "horizontal",
  },
  large: { label: "336 &times; 280", format: "rectangle" },
  rect: { label: "300 &times; 250", format: "rectangle" },
};
const AD_SPOTS = {
  "home-top-resp": "banner",
  "home-bottom-1-resp": "large",
  "home-bottom-2": "large",
  "home-bottom-3": "large",
  "town-top-resp": "banner",
  "town-middle": "banner",
  "town-lower": "banner",
  "town-bottom-1-resp": "rect",
  "town-bottom-2": "rect",
  "town-bottom-3": "rect",
  "blog-top-resp": "banner",
  "blog-bottom-1-resp": "rect",
  "blog-bottom-2": "rect",
  "blog-bottom-3": "rect",
  "post-top-resp": "banner",
  "post-bottom-1-resp": "rect",
  "post-bottom-2": "rect",
  "post-bottom-3": "rect",
  "post-side": "rect",
};
function adSpot(name, margin = "mb-4") {
  const shapeName = AD_SPOTS[name],
    shape = AD_SHAPES[shapeName];
  if (ADS.mode === "setup")
    return fill(template("parts/ad.html"), {
      "{Mode}": "setup",
      "{Ad Margin}": margin,
      "{Ad Body}": `<div class="ad-box ad-${shapeName}"><span>${esc(name)}</span><small>${shape.label}</small></div>`,
    }).trim();
  if (ADS.mode === "on" && ADS.client && ADS.slots?.[name])
    return fill(template("parts/ad.html"), {
      "{Mode}": "on",
      "{Ad Margin}": margin,
      "{Ad Body}": `<ins class="adsbygoogle ad-box ad-${shapeName}" data-ad-client="${esc(ADS.client)}" data-ad-slot="${esc(ADS.slots[name])}" data-ad-format="${shape.format}" data-full-width-responsive="true"></ins>\n  <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>`,
    }).trim();
  return "";
}
// A row of ads at the bottom of a page. The first shows on every screen; the
// rest appear as the screen gets wide enough for them.
function adRow(spots, cols, rowClass) {
  const ads = spots.map((n) => adSpot(n, "mb-0")); // the row's gutters space them
  if (!ads.some(Boolean)) return "";
  return `<div class="row justify-content-center g-4 ${rowClass}">\n${ads.map((ad, i) => `  <div class="${cols[i]}">${ad}</div>`).join("\n")}\n</div>`;
}
const adSpots = () => ({
  "{Ad home-top-resp}": adSpot("home-top-resp"),
  "{Ad town-top-resp}": adSpot("town-top-resp"),
  "{Ad town-middle}": adSpot("town-middle", "mb-5 d-none d-md-block"), // not on phones
  "{Ad town-lower}": adSpot("town-lower", "mb-5 d-none d-md-block"), // not on phones
  // On home, a rule sets the ads apart from the town list
  "{Ads home-bottom}": ((row) =>
    row && `<hr id="home-ads-rule" class="mt-5 mb-0">\n${row}`)(
    adRow(
      ["home-bottom-1-resp", "home-bottom-2", "home-bottom-3"],
      [
        "col-md-6 col-xl-4",
        "col-md-6 col-xl-4 d-none d-md-block",
        "col-xl-4 d-none d-xl-block",
      ],
      "mt-4 pb-3 mb-4",
    ),
  ),
  // Blog page: a banner above the heading, squares below the post list
  "{Ad blog-top-resp}": adSpot("blog-top-resp", "mb-5"),
  "{Ads blog-bottom}": adRow(
    ["blog-bottom-1-resp", "blog-bottom-2", "blog-bottom-3"],
    [
      "col-md-6 col-xl-4",
      "col-md-6 col-xl-4 d-none d-md-block",
      "col-xl-4 d-none d-xl-block",
    ],
    "mt-4",
  ),
  // Blog posts: a banner above the Blog button, like town pages, and
  // squares across the bottom
  "{Ad post-top-resp}": adSpot("post-top-resp"),
  // In the sidebar, below the tags; wide screens only, so phones get just
  // the one square at the bottom
  "{Ad post-side}": adSpot("post-side", "mb-4 d-none d-lg-block"),
  "{Ads post-bottom}": adRow(
    ["post-bottom-1-resp", "post-bottom-2", "post-bottom-3"],
    [
      "col-md-6 col-xl-4",
      "col-md-6 col-xl-4 d-none d-md-block",
      "col-xl-4 d-none d-xl-block",
    ],
    "mt-4",
  ),
  "{Ads town-bottom}": adRow(
    ["town-bottom-1-resp", "town-bottom-2", "town-bottom-3"],
    [
      "col-md-6 col-xl-4",
      "col-md-6 col-xl-4 d-none d-md-block",
      "col-xl-4 d-none d-xl-block",
    ],
    "mt-3",
  ),
});
// The AdSense script itself (adsbygoogle.js) loads through Google Tag Manager
// as a Custom HTML tag, not from here. The ad units above still need "client".

// Privacy choices ("consentBanner" in config/site.json): analytics and ad
// cookies start off for every Google tag (Consent Mode) until the visitor
// picks in the box (templates/parts/consent.html, static/js/consent.js).
// This has to come before any Google tag in the head.
const CONSENT_DEFAULTS = site.consentBanner
  ? `<script>window.dataLayer = window.dataLayer || []; function gtag() { dataLayer.push(arguments); }
gtag("consent", "default", { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", wait_for_update: 500 });</script>`
  : "";

// The box asks about ads only when ads are set up or on; otherwise just analytics.
const CONSENT_ADS = ADS.mode !== "off";
// With ads, "Choices" opens a switch for each kind; with analytics only, the
// two buttons say it all, so there are no switches.
const CONSENT_BOX = fill(template("parts/consent.html"), {
  "{Consent Text}": CONSENT_ADS
    ? "This site uses cookies for analytics and advertising. Set your preferences for each."
    : "This site uses cookies for analytics.",
  "{Consent Options}": CONSENT_ADS
    ? `    <div id="consent-options" class="consent-options small mb-2" hidden>
      <div class="form-check form-switch mb-1">
        <input class="form-check-input" type="checkbox" id="consent-analytics" />
        <label class="form-check-label" for="consent-analytics"><strong>Analytics</strong>: visits and usage</label>
      </div>
      <div class="form-check form-switch">
        <input class="form-check-input" type="checkbox" id="consent-ads" />
        <label class="form-check-label" for="consent-ads"><strong>Ads</strong>: personalized ads and ad measurement</label>
      </div>
    </div>`
    : "",
  "{Consent Choices Button}": CONSENT_ADS
    ? `
      <button type="button" class="btn btn-sm btn-link link-secondary px-1" id="consent-more" aria-expanded="false" aria-controls="consent-options">Choices</button>`
    : "",
  "{Reject Label}": CONSENT_ADS ? "Reject all" : "Reject",
  "{Accept Label}": CONSENT_ADS ? "Accept all" : "Accept",
}).trim();

// Google Tag Manager ("gtm" in config/site.json, like "GTM-XXXX"). Loads after
// the privacy defaults above, so its tags respect the visitor's choices.
const GTM_HEAD = site.gtm
  ? `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${esc(site.gtm)}');</script>
<!-- End Google Tag Manager -->`
  : "";
const GTM_BODY = site.gtm
  ? `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${esc(site.gtm)}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`
  : "";

// Version tag for CSS and JavaScript links ("site.css?v=1a2b3c4d"), from the
// files' contents. Firebase caches them for a year, so a change to any of
// them gives every page a new tag and browsers fetch the new files.
const VERSION = require("crypto")
  .createHash("md5")
  .update(
    [
      "css/bootstrap.min.css",
      "css/site.css",
      "js/maps.js",
      "js/consent.js",
      "js/schools.js",
      "leaflet/leaflet.js",
      "leaflet/leaflet.css",
    ]
      .map((f) => fs.readFileSync(path.join(paths.dirs.root, "static", f)))
      .join(""),
  )
  .digest("hex")
  .slice(0, 8);

const SHARE_LOGO = {
  image: "images/share-logo.png",
  imageAlt: `${site.name} logo`,
};
function metaTags(meta, title, root) {
  const m = { ...SHARE_LOGO, ...meta };
  const full = (p) =>
    site.url ? `${site.url}/${link(p)}`.replace(/\/\.\/$/, "/") : null;
  const tags = [
    `<meta name="description" content="${esc(m.description)}" />`,
    m.noindex ? `<meta name="robots" content="noindex" />` : "",
    m.path !== undefined && full(m.path)
      ? `<link rel="canonical" href="${esc(full(m.path))}" />`
      : "",
    `<meta property="og:type" content="${m.ogType || "website"}" />`,
    `<meta property="og:site_name" content="${esc(site.name)}" />`,
    // Social title: "ogTitle" when a page gives one (blog posts leave off
    // the " | Beehive Guide Blog" that ends their browser title)
    `<meta property="og:title" content="${m.ogTitle || title}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    m.path !== undefined && full(m.path)
      ? `<meta property="og:url" content="${esc(full(m.path))}" />`
      : "",
    `<meta property="og:image" content="${esc(site.url ? `${site.url}/${m.image}` : root + m.image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(m.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    // Blog posts: author, keywords and article tags (m.article)
    ...(m.article
      ? [
          `<meta name="author" content="${esc(m.article.author)}" />`,
          m.article.tags.length
            ? `<meta name="keywords" content="${esc(m.article.tags.join(", "))}" />`
            : "",
          `<meta property="article:published_time" content="${m.article.published}" />`,
          m.article.modified
            ? `<meta property="article:modified_time" content="${m.article.modified}" />`
            : "",
          ...m.article.tags.map(
            (t) => `<meta property="article:tag" content="${esc(t)}" />`,
          ),
        ]
      : []),
    m.jsonLd
      ? `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", ...m.jsonLd }).replace(/</g, "\\u003c")}</script>`
      : "",
    // Breadcrumbs for search results (structured data only, nothing shows on
    // the page): Home > [Blog >] this page. "crumb" is the page's own name.
    m.crumb && m.path !== undefined && full(m.path)
      ? `<script type="application/ld+json">${JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            [site.name, ""],
            ...(m.path.startsWith("blog/") ? [["Blog", "blog.html"]] : []),
            [m.crumb, m.path],
          ].map(([name, p], i) => ({
            "@type": "ListItem",
            position: i + 1,
            name,
            item: full(p),
          })),
        }).replace(/</g, "\\u003c")}</script>`
      : "",
  ];
  return tags.filter(Boolean).join("\n");
}
const SITE_DESCRIPTION = `Community info for Utah. View location, population, postal, phone, gardening and other community info for towns and cities across the state.`;

function wrapPage(
  html,
  title,
  home,
  root,
  headerShadow = "shadow",
  showFooter = true,
  meta = {},
) {
  html = fill(html, adSpots());
  const headTags = [
    metaTags({ description: SITE_DESCRIPTION, ...meta }, title, root),
    CONSENT_DEFAULTS,
    GTM_HEAD,
  ].filter(Boolean);
  let match;
  while (
    (match = html.match(
      /^\s*(<meta[^>]*\/>|<link[\s\S]*?\/>|<style>[\s\S]*?<\/style>)\s*/,
    ))
  ) {
    headTags.push(match[1]);
    html = html.slice(match[0].length);
  }
  // Page content goes in <main id="main"> (the skip link's target), then the
  // footer, then the page's top-level scripts (ones that start a line;
  // scripts nested inside the page, like the homepage photo picker, stay put)
  const cut = html.search(/^<script/m);
  const content = (cut < 0 ? html : html.slice(0, cut)).trim();
  const scripts = cut < 0 ? "" : html.slice(cut).trim();
  html = [
    GTM_BODY,
    header(home, headerShadow, root).trim(),
    `<main id="main" tabindex="-1">\n${content}\n</main>`,
    showFooter ? footer.trim() : "",
    site.consentBanner ? CONSENT_BOX : "",
    scripts,
    site.consentBanner
      ? `<script defer src="${root}js/consent.js?v=${VERSION}"></script>`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return fill(template("parts/document.html"), {
    "{Title}": title,
    "{Head}": headTags.join("\n"),
    "{Root}": root,
    "{Body}": html.trim(),
  })
    .split("{Version}")
    .join(VERSION); // version tags on CSS and JS links
}

const townTemplate = template("town-page.html");
// Town popup on both maps (filled here for town pages, in the browser on map.html)
const TOWN_POPUP = template("parts/town-popup.html").trim();

// County seats get a small courthouse (courthouse-simple.svg in the Drive
// folder's icons) after the name: inside the link in the town lists, just
// outside it in map popups. Screen readers hear "county seat" instead.
const SEAT_ICON =
  '<svg class="county-seat-icon" viewBox="29.76 30 40.48 40" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M50 30 L69.36 41 H30.64 Z M32.4 41 H67.6 V44.5 H32.4 Z M35.04 47 H40.32 V62.5 H35.04 Z M47.36 47 H52.64 V62.5 H47.36 Z M59.68 47 H64.96 V62.5 H59.68 Z M31.52 64.5 H68.48 V70 H31.52 Z"/></svg>';
// Town pages use the honeycomb version (courthouse-simple-hex.svg) in the note after the name
const SEAT_HEX =
  '<svg class="county-seat-icon me-1" viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" fill-rule="evenodd" d="M50.00 0.76 L92.64 25.38 L92.64 74.62 L50.00 99.24 L7.36 74.62 L7.36 25.38 Z M46.10 11.33 Q50.00 9.08 53.90 11.33 L81.54 27.29 Q85.44 29.54 85.44 34.04 L85.44 65.96 Q85.44 70.46 81.54 72.71 L53.90 88.67 Q50.00 90.92 46.10 88.67 L18.46 72.71 Q14.56 70.46 14.56 65.96 L14.56 34.04 Q14.56 29.54 18.46 27.29 Z"/>' +
  '<path fill="currentColor" fill-rule="evenodd" transform="translate(50 51) scale(0.95) translate(-50 -50)" d="M50 30 L69.36 41 H30.64 Z M32.4 41 H67.6 V44.5 H32.4 Z M35.04 47 H40.32 V62.5 H35.04 Z M47.36 47 H52.64 V62.5 H47.36 Z M59.68 47 H64.96 V62.5 H59.68 Z M31.52 64.5 H68.48 V70 H31.52 Z"/></svg>';
const COUNTY_SEAT = `<span class="county-seat" title="County seat">${SEAT_ICON}<span class="visually-hidden">(county seat)</span></span>`;

// One full-screen map page for all communities: map.html?town=<name>
const mapUrl = (t, root) =>
  link(`${root}map.html`) + `?town=${fileName(t).replace(/\.html$/, "")}`;
// "Open In" links that show the community in each map service
const openInLinks = (t) =>
  [
    [
      "Google Maps",
      `https://www.google.com/maps/search/?api=1&amp;query=${t.lat},${t.lng}`,
    ],
    [
      "Apple Maps",
      `https://maps.apple.com/?ll=${t.lat},${t.lng}&amp;q=${encodeURIComponent(t.name + ", Utah")}`,
    ],
    [
      "OpenStreetMap",
      `https://www.openstreetmap.org/?mlat=${t.lat}&amp;mlon=${t.lng}#map=14/${t.lat}/${t.lng}`,
    ],
  ]
    .map(([name, url]) => `<a href="${url}" class="link-dark">${name}</a>`)
    .join(" &middot; ");

// Nearby communities: the closest ones by straight-line distance, any county
const NEARBY_COUNT = 12;
const milesBetween = (a, b) => {
  const r = Math.PI / 180,
    R = 3958.8; // Earth's radius in miles
  const dLat = (b.lat - a.lat) * r,
    dLng = (b.lng - a.lng) * r;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
function nearbyItems(t) {
  return communities
    .filter((o) => o.id !== t.id)
    .map((o) => ({ o, miles: milesBetween(t, o) }))
    .sort((a, b) => a.miles - b.miles)
    .slice(0, NEARBY_COUNT)
    .map(
      ({ o }) =>
        `      <li><a href="${link(fileName(o))}">${esc(o.name)}${o.countySeat ? COUNTY_SEAT : ""}</a></li>`,
    )
    .join("\n");
}

// --- Community services (schools, places and services from 09_merge.js),
// below Growing Info, each part under its own h2. Sections run public safety
// (police and fire), library, parks and cemeteries, PreK-12 schools, higher
// education, then health care (hospitals only); each is left out when empty.
// Most are sentences. Parks, libraries and cemeteries past BIG_LIST become a three-column list, and
// PreK-12 schools past SCHOOL_ONE_PARAGRAPH get a paragraph per level, and
// past SCHOOL_TABLE_MIN a table with a level column.
const BIG_LIST = 5;
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
// AP style: spell out one through nine
const countWord = (n) => (n < 10 ? NUMBER_WORDS[n] : num(n));
const plural = (n, word, words = `${word}s`) => `${countWord(n)} ${n === 1 ? word : words}`;
const capFirst = (s) => s[0].toUpperCase() + s.slice(1);
const nameLink = (item) =>
  item.url ? `<a href="${esc(item.url)}">${esc(item.name)}</a>` : esc(item.name);
// "the city", "the town" or "the community" (CDPs and places the census doesn't list)
const placeWord = (t) =>
  t.placeType === "city" ? "the city" : t.placeType === "town" ? "the town" : "the community";
// UGRC names come in title case ("Fire And Rescue", "Sheriffs Office")
const tidyName = (s) =>
  s
    .replace(/(?!^)\b(And|Of|The|For|At)\b/g, (w) => w.toLowerCase())
    .replace(/\bSheriffs\b/g, "Sheriff's")
    .replace(/\bDod\b/g, "DOD")
    .replace(/\bAtk\b/g, "ATK");
// "the Logan Police Department", but "Brian Head Public Safety"
const withThe = (name) =>
  /^the /i.test(name) || !/(Department|Office|District|Authority|Agency|Services?|Facility|Corps)( \d+)?$/.test(name)
    ? name
    : `the ${name}`;
// "the Logan Police Department" with the name linked and "the" left outside the link
const linkName = (name, url) => {
  const full = withThe(name);
  const the = /^the /i.test(full) ? full.slice(0, 4) : "";
  const label = esc(full.slice(the.length));
  return esc(the) + (url ? `<a href="${esc(url)}">${label}</a>` : label);
};
const uniqueBy = (items, key) => {
  const seen = new Set();
  return items.filter((i) => !seen.has(key(i)) && seen.add(key(i)));
};

// Police agencies serving a place: ["the Logan Police Department"]
function policeAgencies(t) {
  const lawItems = ((t.services && t.services.law) || []).map((l) => ({ name: tidyName(l.name), url: l.url }));
  const law = lawItems.map((l) => l.name);
  if (!law.length) return [];
  // A city's own department covers it; the sheriff covers places without one.
  // Tribal police (Ute, Navajo Nation, Goshute) work alongside either one on
  // reservation land, so they never replace the sheriff.
  const TRIBAL = /tribal|navajo nation/i;
  const local = law.filter((n) => !/Sheriff/i.test(n) && !TRIBAL.test(n));
  const main = local.length ? local : law.filter((n) => /Sheriff/i.test(n));
  return main.map((n) => linkName(n, (lawItems.find((l) => l.name === n) || {}).url));
}

// Tribal police get their own sentence, since they cover tribal land rather
// than the whole place: "The Ute Tribal Police Department has jurisdiction
// over tribal land within the Uintah and Ouray Reservation."
function tribalPoliceText(t) {
  return ((t.services && t.services.law) || [])
    .filter((l) => l.tribal)
    // "on the Uintah and Ouray Reservation", but "in the Navajo Nation"
    .map((l) => {
      // Hagen v. Utah (1994) shrank the Uintah and Ouray Reservation, so
      // tribal jurisdiction there is tribal land rather than everything inside
      // its outer boundary.
      // The Navajo Nation's reservation was never shrunk, so it covers all of it
      const scope = /^Navajo Nation/.test(l.note)
        ? "within the nation's boundaries"
        : `over tribal land within the ${esc(l.note)}`;
      return `${capFirst(esc(withThe(tidyName(l.name))))} has jurisdiction ${scope}.`;
    })
    .join(" ");
}

function fireText(t) {
  const stations = (t.services && t.services.fireStations) || [];
  if (!stations.length) return { serving: [], sentences: [] };
  // Stations grouped by department: "Logan Fire Department Station 70" and
  // "Beaver County Fire District 1 - Headquarters" give the department name.
  const groups = new Map();
  const deptUrl = new Map();
  let loose = 0;
  const FIRE_WORDS = /fire|rescue|emergency|\bems\b|safety/i;
  for (const s of stations) {
    // Training centers, logistics and the like aren't stations
    if (/training|logistic|\beoc\b|academy|national guard/i.test(s.name)) continue;
    // "Canyonlands National Park - Needles Fire District": the part naming the
    // department. Two towns sharing one ("Lapoint - Tridell Fire Department")
    // are joined with a hyphen.
    const segs = tidyName(s.name).split(/\s+-\s+/);
    let i = segs.findIndex((x) => FIRE_WORDS.test(x));
    if (i < 0) i = 0;
    let dept = segs[i];
    if (i === 1 && !segs[0].includes(" ")) dept = `${segs[0]}-${dept}`;
    dept = dept.replace(/\s+Station\b.*$/i, "").trim();
    // "Lone Peak Fire District Alpine" -> "Lone Peak Fire District"
    if (dept.endsWith(` ${t.name}`)) dept = dept.slice(0, -(t.name.length + 1));
    // Stations named only for a place ("Bullfrog") are counted, not named
    if (!FIRE_WORDS.test(dept)) {
      loose++;
      continue;
    }
    groups.set(dept, (groups.get(dept) || 0) + 1);
    if (s.url && !deptUrl.has(dept)) deptUrl.set(dept, s.url);
  }
  const town = esc(t.name);
  // A town's own one-station department: "The Randolph Fire Department
  // provides fire protection." A town's own bigger department: "The Logan Fire Department has
  // three stations." Others say where: "The Cache County Fire District has a
  // station in Logan."
  const serving = [];
  const sentences = [];
  // The town's own department: "Randolph Fire Department", "Cedar City Fire",
  // "Antimony Volunteer Fire Department", but not "Beaver County Fire District"
  const ownRe = new RegExp(`^${t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( City| Town)? (Volunteer )?Fire\\b`);
  for (const [dept, n] of groups) {
    const name = linkName(dept, deptUrl.get(dept));
    const own = ownRe.test(dept);
    if (own && n === 1) sentences.push(`${capFirst(name)} provides fire protection.`);
    else if (own) sentences.push(`${capFirst(name)} has ${plural(n, "station")}.`);
    else sentences.push(`${capFirst(name)} has ${n === 1 ? "a station" : plural(n, "station")} in ${town}.`);
  }
  if (loose)
    sentences.push(
      groups.size
        ? `${town} also has ${loose === 1 ? "another fire station" : plural(loose, "other fire station")}.`
        : `${town} has ${loose === 1 ? "a fire station" : plural(loose, "fire station")}.`,
    );
  return { serving, sentences };
}

// Police, tribal police, then fire, each in its own sentences, one paragraph: "The Rich
// County Sheriff's Office serves the town. The Randolph Fire Department
// provides fire protection."
function safetyText(t) {
  const police = policeAgencies(t);
  const first = police.length
    ? `${capFirst(listText(police))} ${police.length > 1 ? "serve" : "serves"} ${placeWord(t)}.`
    : "";
  // In the Navajo Nation and tribal communities (config/tribal_first.json),
  // tribal police are the main police, so they go first
  const tribal = tribalPoliceText(t);
  const navajoFirst = ((t.services && t.services.law) || []).some((l) => l.first);
  // On tribal land the county handles crimes by non-Native people
  // (United States v. McBratney, 1882; Oklahoma v. Castro-Huerta, 2022)
  const county = navajoFirst && police.length
    ? `${capFirst(listText(police))} also ${police.length > 1 ? "have" : "has"} jurisdiction over crimes by non-Native people.`
    : first;
  // Elsewhere on a reservation the local police come first, then the tribal
  // police sentence on its own
  const policeText = navajoFirst ? [tribal, county] : [first, tribal];
  const text = [...policeText, ...fireText(t).sentences]
    .filter(Boolean)
    .join(" ");
  return text ? `<p>${text}</p>` : "";
}

// "Main Branch, Salt Lake City Public Library" -> "Main Branch of the Salt
// Lake City Public Library"; "Holladay Library, Salt Lake County Library" ->
// "Holladay Library". Bookmobiles are noted.
function libraryHtml(t) {
  const shownNames = [];
  const libs = ((t.places && t.places.libraries) || []).map((l) => {
    const [own, system] = l.name.split(/,\s*/);
    let name = system && /Branch$/.test(own) ? `${own} of the ${system}` : own;
    // Tribal libraries listed by tribe: "Ute Indian Tribe library"
    if (/tribal/i.test(l.note) && !/librar/i.test(name)) name += " Library";
    // Noted unless the name already says so ("Iron County Bookmobile")
    const note =
      /bookmobile/i.test(l.note) && !/bookmobile/i.test(name) ? " (bookmobile)" : "";
    shownNames.push(name);
    return nameLink({ ...l, name }) + note;
  });
  if (!libs.length) return "";
  if (libs.length > BIG_LIST)
    return `<ul class="col-list">\n      ${libs.map((l) => `<li>${l}</li>`).join("\n      ")}\n    </ul>`;
  // "The Logan Library", "the Cleveland Branch of the Emery County Library
  // System": "the" goes before names that end in a word like Library
  const withThe = libs.map((l, i) => {
    const name = shownNames[i];
    return /^the /i.test(name) || !/(Library|Libraries|Branch|System|Bookmobile|Center|Room|Headquarters)$| Library at /.test(name) ? l : `the ${l}`;
  });
  return `<p>${capFirst(listText(withThe))} ${libs.length > 1 ? "are" : "is"} located in ${placeWord(t)}.</p>`;
}

function cemeteryHtml(t) {
  const list = uniqueBy((t.places && t.places.cemeteries) || [], (c) => c.name.toLowerCase());
  if (!list.length) return "";
  if (list.length === 1) {
    const c = list[0];
    // "The Redmond Cemetery, located in the city, dates to 1876."
    const name = /Cemetery$/.test(c.name) && !/^the /i.test(c.name) ? `The ${esc(c.name)}` : esc(c.name);
    return `<p>${name}${c.year ? `, located in ${placeWord(t)}, dates to ${c.year}.` : ` is located in ${placeWord(t)}.`}</p>`;
  }
  const items = list.map((c) => esc(c.name) + (c.year ? ` (${c.year})` : ""));
  if (list.length > BIG_LIST)
    return `<ul class="col-list">\n      ${items.map((c) => `<li>${c}</li>`).join("\n      ")}\n    </ul>`;
  return `<p>Cemeteries include ${listText(items)}.</p>`;
}

// Generic park names are counted by kind ("three ballparks"); plain "Park"
// counts toward the total only.
const PARK_KINDS = { "ball park": "ballpark", ballpark: "ballpark", "sports park": "sports park" };
// Parks: a three-column list past BIG_LIST, otherwise what follows "Beaver
// has": "five parks, including three ballparks and a sports park". inList
// says whether every park is named in the phrase ("two parks, A and B").
// "City Park", "Town Park" or "Community Park", alone or after the town's
// name ("Aurora City Park"), says nothing new, so it's counted, not named
const plainParkName = (t, name) =>
  new RegExp(`^(${t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} )?(city|town|community) park$`, "i").test(name.trim());
function parkParts(t) {
  const parks = ((t.places && t.places.parks) || []).map((p) =>
    !p.generic && plainParkName(t, p.name) ? { ...p, generic: true } : p,
  );
  const named = uniqueBy(parks.filter((p) => !p.generic), (p) => p.name.toLowerCase());
  const generic = parks.filter((p) => p.generic);
  if (!named.length && !generic.length) return null;
  if (named.length > BIG_LIST) {
    // Unnamed parks aren't mentioned under a list
    const items = named.map((p) => `<li>${esc(p.name)}</li>`).join("\n      ");
    // A count leads the list: "Logan has 27 parks:". When more than half have
    // a type (UGRC's TYPE, kept as the note), the types are counted: "Logan
    // has 27 parks, including 17 neighborhood parks, six community parks and
    // five mini parks."
    const types = {};
    for (const p of named) if (p.note) types[p.note] = (types[p.note] || 0) + 1;
    const typed = Object.values(types).reduce((a, b) => a + b, 0);
    // Only types with two or more parks are named, to keep it short
    const common = Object.entries(types)
      .filter(([, n]) => n > 1)
      .sort((a, b) => b[1] - a[1])
      .map(([type, n]) => {
        const word = esc(type.toLowerCase().replace(/^special use/, "special-use"));
        return plural(n, word, /s$/.test(word) ? word : `${word}s`);
      });
    const lead =
      typed > named.length / 2 && common.length
        ? `${esc(t.name)} has ${plural(named.length, "park")}, including ${listText(common)}.`
        : `${esc(t.name)} has ${plural(named.length, "park")}:`;
    return {
      list: `<p class="mb-2">${lead}</p>\n    <ul class="col-list">\n      ${items}\n    </ul>`,
    };
  }
  const total = named.length + generic.length;
  const kinds = {};
  for (const p of generic) {
    const kind = PARK_KINDS[p.name.toLowerCase()];
    if (kind) kinds[kind] = (kinds[kind] || 0) + 1;
  }
  const parts = [
    ...named.map((p) => esc(p.name)),
    ...Object.entries(kinds).map(([kind, n]) => (n === 1 ? `a ${kind}` : plural(n, kind))),
  ];
  const listed = named.length + Object.values(kinds).reduce((a, b) => a + b, 0);
  if (total === 1) return { head: "one park", rest: named.length ? parts[0] : "", inList: true };
  if (!parts.length) return { head: plural(total, "park"), rest: "", inList: false };
  return { head: plural(total, "park"), rest: listText(parts), inList: listed === total };
}

// Parks and Cemeteries. Small towns with one cemetery: "Beaver has five
// parks, including three ballparks and a sports park. It also has the
// Mountain View Cemetery, which dates to 1856." Otherwise the park sentence
// or list comes first, with the cemetery sentence or list below it.
// "Parks and Cemeteries", or just "Parks", "Park", "Cemeteries" or "Cemetery"
// when a town has only one kind
function parksCemeteriesTitle(t) {
  const parks = parkParts(t);
  const cems = uniqueBy((t.places && t.places.cemeteries) || [], (c) => c.name.toLowerCase());
  if (parks && cems.length) return "Parks and Cemeteries";
  if (parks) return parks.head === "one park" ? "Park" : "Parks";
  return cems.length === 1 ? "Cemetery" : "Cemeteries";
}

function parksCemeteriesHtml(t) {
  const town = esc(t.name);
  const parks = parkParts(t);
  const cems = uniqueBy((t.places && t.places.cemeteries) || [], (c) => c.name.toLowerCase());
  const out = [];
  if (parks && parks.list) out.push(parks.list);
  else if (parks) {
    const join = (sep) => (parks.rest ? `${parks.head}${sep}${parks.rest}` : parks.head);
    // Parks, then the town's one cemetery in a second sentence: "Redmond has
    // four parks. The Redmond Cemetery, located in the city, dates to 1876."
    if (cems.length === 1)
      return `<p>${town} has ${join(parks.inList ? (parks.head === "one park" ? ", " : ": ") : ", including ")}. ${cemeteryHtml(t).replace(/^<p>|<\/p>$/g, "")}</p>`;
    out.push(`<p>${town} has ${join(parks.inList ? (parks.head === "one park" ? ", " : ": ") : ", including ")}.</p>`);
  }
  const cemHtml = cemeteryHtml(t);
  if (!cemHtml) return out.join("\n    ");
  if (!out.length) return cemHtml;
  // Two lists: each gets a small heading so they don't run together
  if (parks.list && cemHtml.startsWith("<ul"))
    return `<h3 class="h4 mt-0 mb-2">Parks</h3>\n    ${parks.list}\n    <h3 class="h4 mt-3 mb-2">Cemeteries</h3>\n    ${cemHtml}`;
  // Two sentences share a paragraph
  if (!parks.list && cemHtml.startsWith("<p>"))
    return out[0].replace(/<\/p>$/, ` ${cemHtml.slice(3)}`);
  return `${out[0]}\n    ${cemHtml.replace(/^<(p|ul)( class="|>)/, (m, tag, rest) => (rest === ">" ? `<${tag} class="mt-3">` : `<${tag} class="mt-3 `))}`;
}

// 1st, 2nd, 3rd, 4th ... 11th, 12th
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const gradeNum = (g) => (g === "PK" ? -1 : g === "K" ? 0 : Number(g) || 0);
// PreK-12 schools: one paragraph up to SCHOOL_ONE_PARAGRAPH, a paragraph per
// level up to SCHOOL_TABLE_MIN, then a table
const SCHOOL_ONE_PARAGRAPH = 8;
const SCHOOL_TABLE_MIN = 15;
const LEVELS = { PREK: "Preschool", ELEM: "Elementary", MID: "Middle", HIGH: "High", K12: "K-12" };
const LEVEL_ORDER = ["Preschool", "Elementary", "Middle", "High", "K-12", "Other"];
const KIND_ORDER = { District: 0, Charter: 1, Private: 2 };
function schoolsHtml(t) {
  const s = t.schools;
  if (!s) return { k12: "", higher: "" };
  const all = Object.entries(s.schools || {})
    .flatMap(([level, list]) =>
      list.map((x) => ({
        ...x,
        level: LEVELS[level] || (x.high === "PK" ? "Preschool" : "Other"),
        // "PreK–5", "K–5", "9–12" (en dash, as HTML)
        grades: [x.low, x.high]
          .filter((g, i, arr) => i === 0 || g !== arr[0])
          .map((g) => (g === "PK" ? "PreK" : esc(g)))
          .join("&ndash;"),
        // In sentences: "kindergarten–6th", "prekindergarten" (AP lowercase)
        gradesText: [x.low, x.high]
          .filter((g, i, arr) => i === 0 || g !== arr[0])
          .map((g) =>
            g === "PK" ? "prekindergarten" : g === "K" ? "kindergarten" : Number(g) ? ordinal(Number(g)) : esc(g),
          )
          .join("&ndash;"),
        kind: x.leaType === "District" ? x.lea : x.leaType || "Other",
      })),
    )
    .sort(
      (a, b) =>
        LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) ||
        (KIND_ORDER[a.leaType] ?? 3) - (KIND_ORDER[b.leaType] ?? 3) ||
        a.kind.localeCompare(b.kind) ||
        // Lower grades first (Young Intermediate, 6-7, before Box Elder Middle, 8-9)
        gradeNum(a.low) - gradeNum(b.low) ||
        a.name.localeCompare(b.name),
    );
  const higher = s.higherEd || [];
  // Four or more colleges go in a three-column list
  const higherBig = higher.length >= 4;
  const higherText = higherBig
    ? `These colleges and universities are located in ${placeWord(t)}:`
    : higher.length
    ? `${listText(higher.map(nameLink))} ${higher.length > 1 ? "are" : "is"} located in ${placeWord(t)}.`
    : "";
  // The town's grade range for the heading: "Kindergarten–5th Grade",
  // "Prekindergarten–12th Grade"
  const lows = all.map((x) => x.low).filter(Boolean), highs = all.map((x) => x.high).filter(Boolean);
  const lowest = lows.sort((a, b) => gradeNum(a) - gradeNum(b))[0];
  const highest = highs.sort((a, b) => gradeNum(b) - gradeNum(a))[0];
  const headWord = (g) => (g === "PK" ? "Prekindergarten" : g === "K" ? "Kindergarten" : `${ordinal(Number(g))} Grade`);
  const range = !lowest
    ? ""
    : lowest === highest
      ? headWord(lowest)
      : `${headWord(lowest).replace(/ Grade$/, "")}&ndash;${headWord(highest)}`;
  const out = { k12: "", higher: higherText
      ? `<p>${higherText}</p>` + (higherBig ? `\n    <ul class="col-list">\n      ${higher.map((h) => `<li>${nameLink(h)}</li>`).join("\n      ")}\n    </ul>` : "")
      : "", count: all.length, range };
  if (!all.length) return out;
  const NOUNS = {
    Preschool: ["preschool", "preschools"], Elementary: ["elementary school", "elementary schools"],
    Middle: ["middle school", "middle schools"], High: ["high school", "high schools"],
    "K-12": ["K&ndash;12 school", "K&ndash;12 schools"], Other: ["other school", "other schools"],
  };
  const tally = (key) => {
    const m = new Map();
    for (const x of all) m.set(key(x), (m.get(key(x)) || 0) + 1);
    return m;
  };
  // "a middle school" and "an elementary school" rather than "one"
  // "a preschool, five elementary schools and a middle school" for a list of schools
  const levelsOf = (list) => {
    const m = new Map();
    for (const x of list) m.set(x.level, (m.get(x.level) || 0) + 1);
    return [...m].map(([lv, n]) =>
      n > 1 || lv === "Other" ? plural(n, ...NOUNS[lv]) : `${/^[aeiou]/.test(NOUNS[lv][0]) ? "an" : "a"} ${NOUNS[lv][0]}`,
    );
  };
  const levels = levelsOf(all);
  // "Roosevelt has four elementary schools, one middle school and one high school."
  // "The city of Logan", "The town of Alta"; other places go by name
  // "Bear River City" and "Big Water Town" already say it
  const sayType = (t.placeType === "city" || t.placeType === "town") && !/ (City|Town)$/i.test(t.name);
  const townHas = `${sayType ? `The ${t.placeType} of ` : ""}${esc(t.name)} has`;
  const levelTally = `${townHas} ${listText(levels)}.`;
  // A tally leads when any level has more than one school
  const showTally = [...tally((x) => x.level).values()].some((n) => n > 1);
  if (all.length > SCHOOL_TABLE_MIN) {
    const rows = all
      .map(
        (x) =>
          `<tr data-level="${esc(x.level)}" data-kind="${esc(x.leaType === "District" ? x.leaShort || x.kind : x.kind)}"><th scope="row" class="fw-normal">${nameLink(x)}${x.alt ? " (alternative)" : ""}</th><td>${esc(x.level)}</td><td>${x.grades}</td><td>${esc(x.leaType === "District" ? x.leaShort || x.kind : x.kind)}</td></tr>`,
      )
      .join("\n          ");
    // Tally above the table: "Logan has five preschools, 11 elementary
    // schools, one middle school and four high schools. Logan City
    // District runs 12, Cache District runs two, four are charter schools and
    // five are private schools."
    const kinds = [...tally((x) => x.kind)]
      .sort((a, b) => (a[0] === "Charter" || a[0] === "Private") - (b[0] === "Charter" || b[0] === "Private") || b[1] - a[1])
      .map(([kind, n]) =>
        kind === "Charter" || kind === "Private" || kind === "Other"
          ? `${countWord(n)} ${n === 1 ? "is a" : "are"} ${kind.toLowerCase()} school${n === 1 ? "" : "s"}`
          : `the ${nameLink({ name: kind, url: (all.find((x) => x.kind === kind) || {}).leaUrl })} runs ${countWord(n)}`,
      );
    const summary = `<p>${levelTally} ${capFirst(listText(kinds))}.</p>`;
    // Search and filters (static/js/schools.js fills the menus from the rows)
    const id = `schools-${slug(t.name)}`;
    out.k12 = `${summary}
    <div class="schools-tools row g-2 mb-2 font-sans" data-table="${id}" hidden>
      <div class="col-md-6">
        <label for="${id}-search" class="visually-hidden">Search schools</label>
        <input id="${id}-search" type="search" class="form-control form-control-sm" placeholder="Search schools ..." autocomplete="off" />
      </div>
      <div class="col-6 col-md-3">
        <label for="${id}-level" class="visually-hidden">Level</label>
        <select id="${id}-level" class="form-select form-select-sm" data-filter="level"><option value="">All levels</option></select>
      </div>
      <div class="col-6 col-md-3">
        <label for="${id}-kind" class="visually-hidden">District or type</label>
        <select id="${id}-kind" class="form-select form-select-sm" data-filter="kind"><option value="">All districts and types</option></select>
      </div>
      <p class="schools-count small text-secondary mb-0" aria-live="polite"></p>
    </div>
    <div class="table-responsive">
      <table id="${id}" class="table table-sm table-striped schools-table">
        <thead class="table-dark"><tr><th scope="col">School</th><th scope="col">Level</th><th scope="col">Grades</th><th scope="col">District or Type</th></tr></thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      <p class="schools-none text-secondary" hidden>No schools match.</p>
    </div>
    <script defer src="../js/schools.js?v=${VERSION}"></script>`;
  } else {
    // Sentences: one per district, then charter and private schools
    const item = (x) => `${nameLink(x)} (${x.gradesText}${x.alt ? ", alternative" : ""})`;
    const sentencesFor = (list) => {
      const byKind = new Map();
      for (const x of list) byKind.set(x.kind, [...(byKind.get(x.kind) || []), x]);
      return [...byKind].map(([kind, group]) => {
        const names = listText(group.map(item));
        // "East School (PK-5) and Union High (9-12) are in the Duchesne County
        // School District."
        if (group[0].leaType === "District")
          return `${names} ${group.length === 1 ? "is" : "are"} part of the ${nameLink({ name: kind, url: group[0].leaUrl })}.`;
        const label = kind === "Charter" ? "charter" : kind === "Private" ? "private" : "other";
        return group.length === 1 ? `${names} is a ${label} school.` : `${capFirst(label)} schools are ${names}.`;
      });
    };
    // One school in a paragraph shares the opening sentence: "Additionally,
    // it has a K–12 school, Terra Academy (K–12), which is a charter school."
    const which = (x) =>
      x.leaType === "District"
        ? `which is part of the ${nameLink({ name: x.kind, url: x.leaUrl })}`
        : `which is a ${x.kind === "Charter" ? "charter" : x.kind === "Private" ? "private" : "other"} school`;
    // Up to SCHOOL_ONE_PARAGRAPH schools: one paragraph. More: a paragraph
    // for elementary and one for middle and high schools, each led in bold.
    if (all.length <= SCHOOL_ONE_PARAGRAPH) {
      // A count leads: by level when a level has more than one school
      // ("The city of Roosevelt has four elementary schools…"), otherwise
      // in all ("The city of Beaver has three schools."). One school shares
      // the sentence: "Neola has one school, Neola School (K–5), which is in…"
      // Three or fewer schools: no count, just who runs them: "Escalante
      // School (prekindergarten–6th) and Escalante High (7th–12th) are part
      // of the Garfield County School District."
      if (all.length <= 3)
        out.k12 = `<p>${sentencesFor(all).join(" ")}</p>`;
      else if (all.length === 1)
        out.k12 = `<p>${townHas} one school, ${item(all[0])}, ${which(all[0])}.</p>`;
      // All in one district (or all charter, or all private): one sentence,
      // "The city of Beaver has three schools, A (pre-K), B (K–6) and C
      // (7–12), which are part of the Beaver County School District."
      else if (new Set(all.map((x) => x.kind)).size === 1) {
        const x = all[0];
        const where =
          x.leaType === "District"
            ? `part of the ${nameLink({ name: x.kind, url: x.leaUrl })}`
            : `${x.kind === "Charter" ? "charter" : x.kind === "Private" ? "private" : "other"} schools`;
        const count = showTally ? listText(levels) : plural(all.length, "school");
        out.k12 = `<p>${townHas} ${count}: ${listText(all.map(item))}, which are ${where}.</p>`;
      } else
        out.k12 = `<p>${[showTally ? levelTally : `${townHas} ${plural(all.length, "school")}.`, ...sentencesFor(all)].join(" ")}</p>`;
      return out;
    }
    const LEVEL_GROUPS = {
      Preschool: "Preschool and elementary", Elementary: "Preschool and elementary",
      // Middle, junior high and high schools share a paragraph
      Middle: "Middle and high school", High: "Middle and high school", "K-12": "K&ndash;12", Other: "Other",
    };
    const byLevel = new Map();
    for (const x of all) {
      const g = LEVEL_GROUPS[x.level];
      byLevel.set(g, [...(byLevel.get(g) || []), x]);
    }
    // Each paragraph opens with what it covers: "Vernal has a preschool and
    // five elementary schools." then "The city also has two middle schools and
    // two high schools." ("It also has" for places that aren't a city or town)
    // Third and later paragraphs: "Additionally, it has"
    const also = t.placeType === "city" || t.placeType === "town" ? `The ${t.placeType} also has` : "It also has";
    const opener = (i) => (i === 0 ? townHas : i === 1 ? also : "Additionally, it has");
    // With more than one paragraph, each gets an h3 for its levels:
    // "Preschool and Elementary Schools", "Middle and High Schools", "K–12 Schools"
    const heading = (list) => {
      const lv = new Set(list.map((x) => x.level));
      const one = list.length === 1;
      const sch = one ? "School" : "Schools";
      // K–12 schools cover every grade, so they would read like elementary and high schools too
      if (lv.has("K-12") || lv.has("Other")) return `Other ${sch}`;
      if (lv.has("Elementary") || lv.has("Preschool"))
        return lv.has("Preschool") && lv.has("Elementary") ? `Preschool and Elementary ${sch}` : lv.has("Preschool") ? (one ? "Preschool" : "Preschools") : `Elementary ${sch}`;
      return lv.has("Middle") && lv.has("High") ? `Middle and High ${sch}` : lv.has("Middle") ? `Middle ${sch}` : `High ${sch}`;
    };
    const multi = byLevel.size > 1;
    out.k12 = [...byLevel]
      .map(([, list], i) =>
        (multi ? `<h3 class="h4 mt-0 mb-2">${heading(list)}</h3>\n    ` : "") +
        (list.length === 1
          ? // "a K–12 school, Terra Academy," without repeating "(K–12)"
            `<p>${opener(i)} ${listText(levelsOf(list))}, ${list[0].level === "K-12" && list[0].grades === "K&ndash;12" && !list[0].alt ? nameLink(list[0]) : item(list[0])}, ${which(list[0])}.</p>`
          : `<p>${opener(i)} ${listText(levelsOf(list))}. ${sentencesFor(list).join(" ")}</p>`),
      )
      .join("\n    ");
    return out;
  }
  return out;
}

// Churches and other places of worship (OpenStreetMap, via UGRC). Same-named
// ones (the LDS Church's many buildings) are listed once with a count; a
// single one links to its map location. Past BIG_LIST, a three-column list.
function churchItems(t, numerals = false) {
  const groups = new Map();
  // Churches only if every place is Christian; otherwise "places of worship"
  let allChristian = true;
  for (const c of (t.places && t.places.churches) || []) {
    // Seminary buildings are classrooms, not churches
    if (/seminary/i.test(c.name)) continue;
    // A temple isn't a church, so a town with one says "places of worship"
    if ((c.faith && c.faith !== "christian") || /\btemple\b/i.test(c.name)) allChristian = false;
    // Variants of the LDS Church's name ("The ...", "Latter-Day", "Latter Day",
    // "(Lund Lane Chapel)") count as one
    const lds = /^(the )?church of jesus christ of latter[ -]day saints(\s*\([^)]*\))?$/i.test(c.name.trim());
    const name = lds ? "The Church of Jesus Christ of Latter-day Saints" : c.name;
    const key = name.toLowerCase();
    const g = groups.get(key) || { name, url: c.noteUrl, n: 0 };
    g.n++;
    groups.set(key, g);
  }
  // The LDS Church's buildings share one name, so they link to its meetinghouse locator
  const LDS = /^the church of jesus christ of latter-day saints$/i;
  const LDS_URL = "https://maps.churchofjesuschrist.org/";
  // A leading "The" stays outside the link
  const link = (url, name) => {
    const the = /^The /.test(name) ? "The " : "";
    const rest = name.slice(the.length);
    return the + (url ? `<a href="${esc(url)}">${esc(rest)}</a>` : esc(rest));
  };
  const items = [...groups.values()]
    .sort((x, y) => x.name.localeCompare(y.name))
    .map((g) => {
      const url = LDS.test(g.name) ? LDS_URL : g.n > 1 ? "" : g.url;
      return `${link(url, g.name)}${g.n > 1 ? ` (${numerals ? g.n : countWord(g.n)} ${LDS.test(g.name) ? "meetinghouses" : "locations"})` : ""}`;
    });
  items.allChristian = allChristian;
  items.total = [...groups.values()].reduce((sum, g) => sum + g.n, 0);
  return items;
}

function churchHtml(t) {
  const items = churchItems(t);
  if (!items.length) return "";
  // In a list the counts are numerals: "(8 meetinghouses)"
  if (items.length > BIG_LIST)
    return `<ul class="col-list">\n      ${churchItems(t, true).map((i) => `<li>${i.replace(/^The (<a [^>]*>)/, "$1The ")}</li>`).join("\n      ")}\n    </ul>`;
  // "Churches include the Cleveland Ward and Hope Baptist Church." or "Alta has a church, Our Lady of the Snows Center Station Church."
  const lower = churchItems(t).map((i) => i.replace(/^The /, "the "));
  // No count in the wording. One: "St. Christopher's Episcopal Church is
  // located in Bluff." Several: "Churches include the Cleveland Ward and ..."
  return items.total > 1 || items.length > 1
    ? `<p>${items.allChristian ? "Churches" : "Places of worship"} include ${endSentence(listText(lower))}</p>`
    : items[0].includes("maps.churchofjesuschrist.org")
      // The LDS Church's entries are its meetinghouses: "A Church of Jesus Christ of Latter-day Saints meetinghouse is located in Levan."
      ? `<p>A ${items[0].replace(/^The /, "")} meetinghouse is located in ${esc(t.name)}.</p>`
      : `<p>${items[0]} is located in ${esc(t.name)}.</p>`;
}

// Outdoor Recreation: trailheads in town (linked to their map pin), the trails near
// them, then the other named trails and paths in town as plain text. A trail is
// linked to a trailhead only when one is within 150 meters of it (06b_trails.js);
// the trail data doesn't show which ends are entry points, so the rest are listed.
// Trail-to-trailhead pairs a public source confirms (config/trailhead_research.json and
// config/trail_verification.json). Only these are listed as "near" a trailhead; any other
// trail falls into the plain list.
const trailKey = (s) => String(s || "").toLowerCase().replace(/trail/g, "").replace(/[^a-z]/g, "");
const CONFIRMED_STATUS = new Set(["confirmed", "confirmed (trail guide)", "starts here", "passes here", "reached from here", "ends here", "starts near"]);
const confirmedPairs = (() => {
  const pairs = [];
  const roads = new Set();
  const read = (f) => { try { return paths.readJson(paths.config(f)); } catch (e) { return []; } };
  for (const r of read("trailhead_research.json"))
    if (CONFIRMED_STATUS.has(r.status)) for (const x of r.trails || []) pairs.push([r.town, r.trailhead, x]);
  for (const r of read("trail_verification.json")) {
    if (CONFIRMED_STATUS.has(r.status)) for (const x of r.trails || []) pairs.push([r.town, r.trailhead, x]);
    if (r.status === "road, not a trail") for (const x of r.trails || []) roads.add(trailKey(x));
  }
  return { pairs: pairs.map(([a, b, c]) => [trailKey(a), trailKey(b), trailKey(c)]), roads };
})();
function isConfirmedTrail(town, head, trail) {
  const a = trailKey(town), b = trailKey(head), c = trailKey(trail);
  return c && confirmedPairs.pairs.some(([ta, tb, tc]) => ta === a && (tb === b || tb.includes(b) || b.includes(tb)) && tc === c);
}
function trailsHtml(t) {
  const d = t.trails;
  if (!d || (!d.trailheads.length && !d.trails.length)) return "";
  const town = esc(t.name);
  // "Dry Canyon (Logan)" -> "Dry Canyon"
  const shown = (name) => name.replace(new RegExp(`\\s*\\(${t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`, "i"), "");
  // "Dry Canyon" -> "Dry Canyon Trailhead" when the name is the start of a sentence
  const link = (h, full) => {
    const nm = shown(h.name);
    const label = full && !/trailhead|\bTH\b/i.test(nm) ? `${nm} Trailhead` : nm;
    return `<a href="https://www.google.com/maps?q=${h.lat},${h.lng}">${esc(label)}</a>`;
  };
  // Only trails a source ties to the trailhead are named with it; the rest go in the plain list.
  const seen = new Set();
  const withTrails = [];
  const plain = [];
  for (const h of d.trailheads) {
    const ok = h.trails.filter((n) => isConfirmedTrail(t.name, h.name, n));
    ok.forEach((n) => seen.add(n.toLowerCase()));
    if (ok.length) withTrails.push({ h, ok }); else plain.push(h);
  }
  const heads = d.trailheads;
  const near = withTrails;
  const others = d.trails.filter((n) => !seen.has(n.toLowerCase()) && !confirmedPairs.roads.has(trailKey(n)));
  const out = [];
  const sentences = [];
  for (const { h, ok } of withTrails) sentences.push(`${link(h, true)} provides access to ${listText(ok.map(esc))}.`);
  if (plain.length) {
    const pl = plain.map((h) => link(h));
    if (!withTrails.length) sentences.push(plain.length === 1 ? `${link(plain[0], true)} is in ${town}.` : `Trailheads include ${listText(pl)}.`);
    else sentences.push(plain.length === 1 ? `${link(plain[0], true)} is also in ${town}.` : `Other trailheads include ${listText(pl)}.`);
  }
  // "is a path in Myton": the noun follows the name's last word (path, loop, parkway, walkway)
  const nounOf = (name) =>
    /\bpath(way)?$/i.test(name) ? "path" : /\bloop$/i.test(name) ? "loop trail" : /\bparkway$/i.test(name) ? "parkway"
      : /\bwalkway$/i.test(name) ? "walkway" : "trail";
  // Loops count as trails; paths, parkways and walkways count as paths
  const kindOf = (name) => (nounOf(name) === "trail" || nounOf(name) === "loop trail" ? "trail" : "path");
  const kindWord = (names) => {
    const kinds = new Set(names.map(kindOf));
    return kinds.size === 1 ? (kinds.has("path") ? "paths" : "trails") : "trails and paths";
  };
  const noun = kindWord(others);
  const lead = near.length ? `Other ${noun} in ${town} include` : `${capFirst(noun)} in ${town} include`;
  // A name that already ends in trail, path, loop or the like needs no noun: "Myton Ball Park Path is in Myton."
  const hasNoun = (name) => /\b(trails?|paths?|pathway|loop|parkway|walkway)$/i.test(name);
  if (others.length === 1 && !near.length)
    sentences.push(hasNoun(others[0]) ? `${esc(others[0])} is located in ${town}.` : `${esc(others[0])} is ${/^[aeiou]/.test(nounOf(others[0])) ? "an" : "a"} ${nounOf(others[0])} in ${town}.`);
  else if (others.length && others.length <= BIG_LIST) sentences.push(`${lead} ${listText(others.map(esc))}.`);
  const bigList = others.length > BIG_LIST;
  if (sentences.length) out.push(`<p>${sentences.join(" ")}</p>`);
  if (bigList)
    out.push(`<p>${sentences.length ? `<strong>${lead}:</strong>` : `${lead}:`}</p>\n    <ul class="col-list">\n      ${others.map((n) => `<li>${esc(n)}</li>`).join("\n      ")}\n    </ul>`);
  // A "Trails" h3 under the Outdoor Recreation h2, like Parks under Parks and Cemeteries
  // "Paths" when every one is a path, "Trails and Paths" when both kinds are listed
  const all = d.trails.filter((n) => !confirmedPairs.roads.has(trailKey(n)));
  const h3 = capFirst(kindWord(all)).replace(" and paths", " and Paths");
  return `<h3 class="h4 mt-0 mb-2">${h3}</h3>\n    ${out.join("\n    ")}`;
}

// "The" goes before hospital and airport names ("The Logan-Cache Airport"), capital at the start
// of a sentence and lowercase after that; saints' and possessive names go without
const takesThe = (name) => !/^the /i.test(name) && !/^(St\.?|Saint|Mount)\b|^\w+'s\b/i.test(name);
const theFirst = (html, name, i) =>
  takesThe(name) ? `${i === 0 ? "The" : "the"} ${html}` : i > 0 ? html.replace(/(^|>)The /, "$1the ") : html;

function hospitalText(t) {
  const list = (t.places && t.places.hospitals) || [];
  if (!list.length) return "";
  return `${listText(list.map((h, i) => theFirst(nameLink(h), h.name, i)))} ${list.length > 1 ? "serve" : "serves"} the area.`;
}

// FAA names are abbreviated ("Cedar City Rgnl", "Delta Muni"); spell them out and end with
// "Airport" or "Field"
const airportUrls = paths.readJson(paths.config("airport_urls.json"));
function airportName(raw) {
  if (/^St George Muni$/i.test(raw.trim())) return "St. George Regional Airport"; // renamed in 2011
  let n = raw
    .replace(/\bRgnl\b/g, "Regional").replace(/\bMuni\b/g, "Municipal").replace(/\bIntl\b/g, "International")
    .replace(/\bMcdonald\b/g, "McDonald").replace(/\bAnd\b/g, "and").replace(/\bSt\b(?!\.)/g, "St.")
    .replace(/\s+/g, " ").trim();
  if (!/\b(airport|airpark|field)\b/i.test(n)) n += " Airport";
  else if (/\/|\s-\s/.test(n)) n = n.replace(/^([^/-]+?)\s*(?=[/-])/, (m) => (/\b(airport|airpark|field)\b/i.test(m) ? m : `${m.trim()} Airport${/\s$/.test(m) ? " " : ""}`));
  return n;
}
function airportList(t) {
  return ((t.places && t.places.airports) || []).filter((a) => !a.note);
}
function airportText(t) {
  const raw = airportList(t).map((a) => airportName(a.name));
  if (!raw.length) return "";
  const list = raw.map((n, i) => theFirst(airportUrls[n] ? `<a href="${esc(airportUrls[n])}">${esc(n)}</a>` : esc(n), n, i));
  return `${listText(list)} ${raw.length === 1 ? "serves" : "serve"} ${esc(t.name)}.`;
}

// Parks and cemeteries source words: ["park", "cemetery"], or just the one shown
function parksCemeteriesLabels(t) {
  const cems = (t.places && t.places.cemeteries) || [];
  return [parkParts(t) && "park", cems.length && "cemetery"].filter(Boolean);
}

// Government and services: for cities and towns (places with a government)
// and for places with a culinary water system, or both. "Alta has a town government. Culinary water
// comes from the Alta Town Water System."
// Official city and town websites, by name (config/government_urls.json); empty until filled
const governmentUrls = paths.readJson(paths.config("government_urls.json"));
// Ends a sentence with a period, unless the text already ends with one
// ("Wellsville City Corp." gets no second period)
const endSentence = (html) => (/\.(<\/a>)?$/.test(html) ? html : `${html}.`);
function hasGovernment(t) {
  return t.placeType === "city" || t.placeType === "town";
}
function governmentHtml(t) {
  const gov = hasGovernment(t);
  const water = (t.services && t.services.water) || [];
  if (!gov && !water.length) return "";
  const named = (w) => (/(system|district|company|works|service|water|\bw?id\b|ssd|wcd)/i.test(w.name) ? withThe(w.name).replace(/^(?!the )/i, "the ") : w.name);
  // "the" stays outside the link: the <a>Alta Town Water System</a>
  const waterNames = water.map((w) => {
    const full = named(w).replace(/^The /, "the ");
    const the = /^the /i.test(full) ? "the " : "";
    const label = esc(full.slice(the.length));
    return the + (w.url ? `<a href="${esc(w.url)}">${label}</a>` : label);
  });
  // "Alpine has a city government." The words "city government" link to the
  // official website when config/government_urls.json has one.
  const url = governmentUrls[t.name];
  const phrase = url ? `<a href="${esc(url)}">${t.placeType} government</a>` : `${t.placeType} government`;
  const sentences = [
    gov ? `${esc(t.name)} has a ${phrase}.` : "",
    water.length ? `Culinary water comes from ${endSentence(listText(waterNames))}` : "",
  ];
  return `<p>${sentences.filter(Boolean).join(" ")}</p>`;
}

// Returns { html, shown, labels }: shown names the sections (for ads); labels
// are the words for the source line ("law enforcement", "fire", "park" ...).
function servicesHtml(t) {
  const p = (text) => (text ? `<p>${text}</p>` : "");
  const schools = schoolsHtml(t);
  const safety = safetyText(t);
  const sections = [
    [hasGovernment(t) ? `${capFirst(t.placeType)} Government and Services` : "Water Service", "government", governmentHtml(t), ["culinary water"]],
    // Police and fire share a paragraph
    ["Public Safety", "police, fire", safety, ["law enforcement", "fire"]],
    // "Library" or "Libraries", "School" or "Schools", by how many there are
    [((t.places && t.places.libraries) || []).length > 1 ? "Libraries" : "Library", "libraries", libraryHtml(t), ["library"]],
    [parksCemeteriesTitle(t), "parks, cemeteries", parksCemeteriesHtml(t), parksCemeteriesLabels(t)],
    [`School${schools.count === 1 ? "" : "s"}${schools.range ? ` (${schools.range})` : ""}`, "schools", schools.k12, ["school"]],
    ["Higher Education", "colleges", schools.higher, ["college"]],
    [((t.places && t.places.hospitals) || []).length > 1 ? "Hospitals" : "Hospital", "hospitals", p(hospitalText(t)), ["hospital"]],
    [airportList(t).length > 1 ? "Airports" : "Airport", "airports", p(airportText(t)), ["airport"]],
    [(() => { const ci = churchItems(t); const one = ci.total === 1; return ci.allChristian ? (one ? "Church" : "Churches") : one ? "Place of Worship" : "Places of Worship"; })(), "churches", churchHtml(t), []],
    ["Outdoor Recreation", "trails", trailsHtml(t), ["trail"]],
  ].filter(([, , body]) => body);
  if (!sections.length) return { html: "", parts: [], shown: [], labels: [], osm: "" };
  // Each part is its own section with an h2, styled like Growing Info
  const parts = sections.map(
    ([title, word, body]) => `<section class="services services-${slug(word)} mb-4">
    <h2 class="rule-fade pb-2 mb-3">${title}</h2>
    ${body}
  </section>`,
  );
  return {
    html: parts.join("\n  "),
    parts,
    shown: sections.map(([, word]) => word),
    labels: sections.flatMap(([, , , labels]) => labels),
    // "Churches" or "Places of worship", credited to OpenStreetMap
    osm: sections.some(([, word]) => word === "churches")
      ? (() => {
          const ci = churchItems(t);
          const one = ci.total === 1;
          return ci.allChristian ? (one ? "church" : "churches") : one ? "place of worship" : "places of worship";
        })()
      : "",
  };
}

// Mountain resort towns this high (Brian Head, Brighton) get no Growing Info
// section: no hardiness zone, precipitation, freeze or soil lines.
const GROWING_MAX_FT = 8500;
// Town page ads go between sections (Growing Info, Public Safety, Library
// ...), by how many sections the page has: "after" lists the section each ad
// follows (0 = before the first, Infinity = after the last, above Sources,
// "sources" = below the Sources list, "schools" = right before the Schools
// section, or above Sources if the page has none).
// The first is the main ad (town-middle), the
// second the optional one (town-lower). Pages with more sections than listed
// use the last rule.
const TOWN_AD_RULES = [
  { sections: 1, after: ["sources"] },
  { sections: 2, after: ["sources"] },
  { sections: 3, after: ["sources"] },
  { sections: 4, after: ["sources"] },
  { sections: 5, after: [0, "sources"] }, // and 6 or more
];
const TOWN_AD_SPOTS = ["town-middle", "town-lower"];
// Service sections with the town's ad spots placed between them, plus the
// spots (if any) that go above Growing Info and below the Sources list
function servicesWithAds(services, hasGrowing) {
  const count = services.parts.length + (hasGrowing ? 1 : 0);
  const out = [...services.parts];
  if (!count) return { html: "", beforeGrowing: "", afterSources: "" };
  const rule =
    TOWN_AD_RULES.find((r) => r.sections === count) ||
    TOWN_AD_RULES[TOWN_AD_RULES.length - 1];
  // "schools": the position right before the Schools section
  const schoolsAt = services.shown.indexOf("schools");
  const spots = rule.after.map((after, i) => [
    after === "schools" ? (schoolsAt >= 0 ? schoolsAt + (hasGrowing ? 1 : 0) : Infinity) : after,
    `{Ad ${TOWN_AD_SPOTS[i]}}`,
  ]);
  // Before the first section: above Growing Info when the page has it
  const beforeGrowing = hasGrowing
    ? spots.filter(([after]) => after === 0).map(([, spot]) => spot).join("\n  ")
    : "";
  // Insert from the end so earlier positions don't shift
  spots
    .filter(([after]) => after !== "sources" && !(hasGrowing && after === 0))
    .map(([after, spot]) => [Math.min(after - (hasGrowing ? 1 : 0), out.length), spot])
    .reverse()
    .forEach(([at, spot]) => {
      if (at >= 0) out.splice(at, 0, spot);
    });
  return {
    html: out.join("\n  "),
    beforeGrowing,
    afterSources: spots.filter(([after]) => after === "sources").map(([, spot]) => spot).join("\n  "),
  };
}

function buildPage(t) {
  if (t.elevationFt !== null && t.elevationFt >= GROWING_MAX_FT)
    t = { ...t, hardinessZone: "", precipIn: null, freezeFreeDays: undefined, soil: null };
  const src = { gnis: SOURCES.gnis(t.elevationFt !== null) };
  const pop = t.population;
  const ph = t.phone;

  // Settled year (own paragraph) and name origin (lead paragraph)
  const intro = [];
  if (t.founded || t.origin) {
    src.history = SOURCES.history(!!t.founded, !!t.origin, t.origin ? t.originSources || [] : []);
    // "Settled 1890" -> "(Settled in 1890)"
    if (t.founded)
      intro.push(
        `<p class="text-secondary mt-2 mb-2"><em>(${esc(t.founded.replace(/^(\w+) (\d{4})$/, "$1 in $2"))})</em></p>`,
      );
    if (t.origin)
      intro.push(`<p class="lead mb-4 mb-lg-3">${esc(t.origin)}</p>`);
  }
  if (pop) src.pop = SOURCES[pop.source];
  if (t.hardinessZone) src.zone = SOURCES.zone;
  if (t.precipIn !== null) src.precip = SOURCES.precip;
  if (t.freezeFreeDays !== undefined) src.freeze = SOURCES.freeze;
  if (t.soil) src.soil = SOURCES.soil;
  const services = servicesHtml(t);
  const withAds = servicesWithAds(
    services,
    Boolean(t.hardinessZone || t.precipIn !== null || t.freezeFreeDays !== undefined || soilHtml(t)),
  );
  if (services.labels.length) src.ugrc = SOURCES.ugrc(services.labels);
  if (services.osm) src.osm = SOURCES.osm(services.osm);
  // Tribal police come from Census reservation boundaries; no source line for
  // them, since readers wouldn't know what it referred to

  // Phone: one "Area Code" line ("801/385" when there are several), then the
  // prefixes under it. With several area codes, each gets its own labeled
  // line ("801 Prefixes: ..."). Prefixes come in as "644, 689" (one area
  // code) or "801: 201, 202\n385: 202, 210" (several).
  // When there are more prefixes in all than "prefixReveal" (config/site.json),
  // the list starts cut short with a fade and one "Show all prefixes" link.
  // Opened, the full list floats over what follows instead of pushing it down.
  let phoneItems = "";
  const showPrefixes = Boolean(ph);
  if (ph) {
    const codes = ph.areaCodes.split(", ");
    // Prefixes, then mobile carriers' prefixes on their own line(s):
    // "Prefixes: 722, 725" and "Mobile: 724, 401"
    const parse = (str) =>
      !str ? [] : codes.length === 1 ? [[codes[0], str]] : str.split("\n").map((line) => line.split(": "));
    // One line per area code: "Prefixes: 722, 725 | Mobile: 724, 401" (the pipe
    // is hidden from screen readers)
    const mobileBy = Object.fromEntries(parse(ph.mobile));
    const plainBy = Object.fromEntries(parse(ph.prefixes));
    const groups = codes
      .filter((c) => plainBy[c] || mobileBy[c])
      .map((c) => [c, plainBy[c] || "", mobileBy[c] || ""]);
    const label = (code, list) =>
      `${codes.length > 1 ? `${esc(code)} ` : ""}Prefix${list.includes(",") ? "es" : ""}:`;
    const count = (list) => (list ? list.split(",").length : 0);
    const total = groups.reduce((n, [, list, mob]) => n + count(list) + count(mob), 0);
    const long = total > site.prefixReveal;
    const line = (code, list, mobile) => {
      // The area code label ("801 Prefixes:") is bold in the open box; a
      // "Mobile:" after the pipe isn't, unless it starts the line; it's only
      // underlined there (mobile-label)
      const em = (text, bold) => `<em${codes.length > 1 && bold ? ' class="prefix-label"' : ""}>${text}</em>`;
      const mobLabel = `${!list && codes.length > 1 ? `${esc(code)} ` : ""}Mobile:`;
      // One area code: "Prefixes:" is underlined (not bold) in the open box too
      const prefixEm = codes.length > 1 ? em(label(code, list), true) : `<em class="mobile-label">${label(code, list)}</em>`;
      const parts = [list && `${prefixEm} ${esc(list)}`, mobile && `${em(mobLabel, !list).replace("<em", list ? '<em class="mobile-label"' : "<em")} ${esc(mobile)}`];
      return `<small class="text-secondary font-sans">${parts.filter(Boolean).join(' <span aria-hidden="true">|</span> ')}</small>`;
    };
    // In the fold-out box each group is its own block with a little space
    // between; otherwise groups are just separate lines
    const text = long
      ? groups
          .map(
            ([code, list, mobile], i) =>
              `<div${i < groups.length - 1 ? ' class="mb-2"' : ""}>${line(code, list, mobile)}</div>`,
          )
          .join("")
      : groups.map(([code, list, mobile]) => line(code, list, mobile)).join("<br />");
    phoneItems = `<li><strong>Area Code${codes.length > 1 ? "s" : ""}:</strong> ${codes.map(esc).join("/")}
          <ul class="list-unstyled mb-0">
            <li>${
              long
                ? `<div class="prefix-box">
                <div class="prefix-reveal">${text}<div class="prefix-close-row"><button type="button" class="prefix-close prefix-toggle btn btn-link btn-sm p-0 font-sans" aria-expanded="true"><span class="prefix-toggle-text me-1">Close</span><svg class="prefix-icon prefix-icon-close" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M5 2 V8 M2 5 H8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></div></div>
                <div><button type="button" class="prefix-open prefix-toggle btn btn-link btn-sm p-0 font-sans" aria-expanded="false"><span class="prefix-toggle-text me-1">Show all prefixes</span><svg class="prefix-icon" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M5 2 V8 M2 5 H8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></div>
              </div>`
                : text
            }</li>
          </ul>
        </li>`;
    src.phone = SOURCES.phone(showPrefixes);
  }

  // Sources listed in the order their data appears on the page
  const sources = [
    src.history,
    src.gnis,
    src.pop,
    src.phone,
    src.zone,
    src.precip,
    src.freeze,
    src.soil,
    src.ugrc,
    src.osm,
    src.reservations,
  ].filter(Boolean);

  let html = townTemplate;
  if (pop && pop.source === "ugrcPop") {
    html = html.replace(
      /<li>\s*<strong>Population:<\/strong> \{Town Population\}\s*<small[\s\S]*?<\/small\s*>\s*<\/li>/,
      `<li><strong>Population:</strong> ${num(pop.count)} <small class="text-secondary font-sans"><em>(2010 est.)</em></small></li>`,
    );
  }
  html = html
    // Founding and name origin lines; either one is left out when missing
    .replace(
      /\n\s*<p class="text-secondary mt-2 mb-2"><em>\(Settled in \{year\}\)<\/em><\/p>\s*<p class="lead">.*?<\/p>/,
      intro.length ? `\n  ${intro.join("\n  ")}` : "",
    )
    .replace(
      /<li><strong>Area Code\{s\}:<\/strong> \{Town Area Code\}<\/li>\s*<li><strong>Phone Prefix\{es\}:<\/strong> \{Town Prefix\}<\/li>/,
      phoneItems || `<li>${NA}</li>`,
    )
    .replace(
      /\s*<p[^>]*>\s*<a href=""[^>]*>Post Office<\/a>\s*<\/p>/,
      (button) =>
        t.postOfficeUrl
          ? button.replace('<a href=""', `<a href="${t.postOfficeUrl}"`)
          : "",
    )
    .replace(
      "<li>{Source}</li>",
      sources.map((s) => `<li>${s}</li>`).join("\n    "),
    );

  html = fill(html, {
    "{Town Name}": esc(t.name),
    "{County Name}": esc(t.county),
    "{Town Latitude}": t.lat.toFixed(4),
    "{Town Longitude}": t.lng.toFixed(4),
    // Map pin uses the full-precision coordinates
    "{Map Latitude}": String(t.lat),
    "{Map Longitude}": String(t.lng),
    "{Town Elevation}":
      t.elevationFt !== null ? `${num(t.elevationFt)} ft.` : NA,
    "{Town Population}": pop ? num(pop.count) : NA,
    "{Town Households}":
      pop && pop.households !== undefined ? num(pop.households) : NA,
    "{Town Hardiness}": t.hardinessZone || NA,
    "{Town Precip}": t.precipIn !== null ? `${t.precipIn.toFixed(1)} in.` : NA,
    "{Town Freeze}":
      t.freezeFreeDays !== undefined
        ? `${t.freezeFreeDays} <small class="text-secondary font-sans"><em>(${t.lastSpringFreeze}&ndash;${t.firstFallFreeze})</em></small>`
        : NA,
    "{Town Soil}": soilHtml(t),
    // Service sections, with the ads between sections (TOWN_AD_RULES)
    "{Town Services}": withAds.html,
    "{Ad After Sources}": withAds.afterSources,
    "{Ad Before Growing}": withAds.beforeGrowing,
    "{Day Month, Year}": DATE_MARK, // set below, once the content is final
    "{Site Name}": esc(site.name),
    "{Home URL}": link("../index.html"),
    "{Community Profiles URL}": COMMUNITY_PROFILES_URL,
    "{Nearby Items}": nearbyItems(t),
    "{Map Page URL}": mapUrl(t, "../"),
    "{Town Popup}": fill(TOWN_POPUP, {
      "{Popup Town}": `<span class="marker-link text-body font-zilla me-2">${esc(t.name)}, Utah</span>`,
      "{Popup County}": `<a href="${link("../map.html")}?county=${slug(t.county)}" class="link-secondary">${esc(t.county)} County</a>`,
      "{Popup Seat}": t.countySeat ? COUNTY_SEAT : "",
      "{Popup Open In}": openInLinks(t),
    }),
  });

  // Drop the whole Population line when there's no population.
  html = html.replace(
    new RegExp(
      `\\s*<li>\\s*<strong>Population:</strong>\\s*${NA}[\\s\\S]*?</li>`,
      "g",
    ),
    "",
  );

  // Drop the "(N households)" note when there's no household count.
  html = html.replace(
    new RegExp(
      `\\s*<small[^>]*>\\s*<em>\\(${NA} households\\)</em>\\s*</small\\s*>`,
      "g",
    ),
    "",
  );

  // Leave out anything not available: drop its line, then adjust or drop the
  // climate normals note, then drop the whole Growing Info section if empty.
  html = html.replace(new RegExp(`\\s*<li>[^\\n]*${NA}[^\\n]*</li>`, "g"), "");

  if (t.precipIn === null && t.freezeFreeDays === undefined) {
    html = html.replace(
      /\s*<p class="[^"]*">\s*<em>1991-2020 precipitation and freeze normals<\/em>\s*<\/p>/,
      "",
    );
  } else if (t.precipIn === null) {
    html = html.replace(
      "1991-2020 precipitation and freeze normals",
      "1991-2020 freeze normals",
    );
  } else if (t.freezeFreeDays === undefined) {
    html = html.replace(
      "1991-2020 precipitation and freeze normals",
      "1991-2020 precipitation normals",
    );
  }

  html = html.replace(
    /\s*<section class="gardening[^"]*">\s*<h2[^>]*>Growing Info<\/h2>\s*<ul class="list-unstyled mb-0">\s*<\/ul>\s*<\/section>/,
    "",
  );
  // Soil but no climate lines: drop the empty list above the soil text
  html = html.replace(/\s*<ul class="list-unstyled mb-0">\s*<\/ul>(\s*<h3 class="soil-heading)/, "$1");

  const leftover = html.match(/\{(?!Ads? |Version\})[A-Z][^}{]*\}/g); // ad spots are filled in wrapPage
  if (leftover)
    console.warn(`  ${t.name}: unfilled ${[...new Set(leftover)].join(", ")}`);
  if (shared(t)) {
    html = html.replace(
      `<h1>${esc(t.name)}, Utah</h1>`,
      `<h1>${esc(t.name)} (${esc(t.county)}), Utah</h1>`,
    );
  }
  // Title matches the heading: "Kanab, Utah | Community Profile | Site Name"
  const h1 = (html.match(/<h1>(.*?)<\/h1>/) || [])[1];
  // County seats: a small note after the name that starts with the
  // courthouse in a honeycomb, like "Kanab, Utah [courthouse] Kane County Seat"
  if (t.countySeat) {
    html = html.replace(
      `<h1>${h1}</h1>`,
      `<h1><span class="county-seat-name">${h1}</span><small class="county-seat-note font-sans fw-normal text-secondary">${SEAT_HEX}${esc(t.county)} County Seat</small></h1>`,
    );
  }
  const place = shared(t) ? `${t.name} (${t.county}), Utah` : `${t.name}, Utah`;
  html = html.split(DATE_MARK).join(apDate(pageDate(fileName(t), html)));
  return wrapPage(
    html,
    `${h1} | Community Profile | ${esc(site.name)}`,
    link("../index.html"),
    "../",
    "shadow",
    true,
    {
      description: `Community profile for ${esc(t.name)}, Utah, in ${t.county} County. Location, population, postal, phone and gardening info.`,
      path: `communities/${fileName(t)}`,
      crumb: place,
      jsonLd: {
        "@type": "Place",
        name: place,
        address: {
          "@type": "PostalAddress",
          addressLocality: t.name,
          addressRegion: "UT",
          addressCountry: "US",
        },
        geo: { "@type": "GeoCoordinates", latitude: t.lat, longitude: t.lng },
        containedInPlace: {
          "@type": "AdministrativeArea",
          name: `${t.county} County, Utah`,
        },
      },
    },
  );
}

// --- Pick communities
let list = communities;
if (wanted.length) {
  const keys = wanted.map((w) => w.toLowerCase());
  list = communities.filter(
    (t) =>
      keys.includes(t.id.toLowerCase()) || keys.includes(t.name.toLowerCase()),
  );
  const found = new Set(
    list.flatMap((t) => [t.id.toLowerCase(), t.name.toLowerCase()]),
  );
  const missing = keys.filter((k) => !found.has(k));
  if (missing.length) console.warn(`Not found: ${missing.join(", ")}`);
}

// --- Static files: static/ (fonts, CSS) is copied into the output as is.
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory())
      copyDir(path.join(from, e.name), path.join(to, e.name));
    else
      fs.writeFileSync(
        path.join(to, e.name),
        fs.readFileSync(path.join(from, e.name)),
      );
  }
}
copyDir(path.join(paths.dirs.root, "static"), outDir);

// --- Town pages
const profileDir = path.join(outDir, "communities");
fs.mkdirSync(profileDir, { recursive: true });
const written = new Set();
for (const t of list) {
  fs.writeFileSync(path.join(profileDir, fileName(t)), buildPage(t));
  written.add(fileName(t));
}
// On a full build, remove pages for communities no longer in the list.
if (!wanted.length) {
  for (const f of fs.readdirSync(profileDir)) {
    if (f.endsWith(".html") && !written.has(f)) {
      fs.unlinkSync(path.join(profileDir, f));
      console.log(`  Removed old page ${f}`);
    }
  }
  for (const f of Object.keys(pageDates))
    if (!written.has(f)) delete pageDates[f];
}
// Save the dates only for real builds, not --out test runs
if (outDir === paths.dirs.public) {
  const sorted = Object.fromEntries(
    Object.keys(pageDates)
      .sort()
      .map((k) => [k, pageDates[k]]),
  );
  paths.writeJson(PAGE_DATES_FILE, sorted);
}

// --- Index: every community that has a page, A to Z, with a county box and
// a search box; nothing shows until one is used.
const pages = communities
  .filter((t) => fs.existsSync(path.join(profileDir, fileName(t))))
  .sort(
    (a, b) => a.name.localeCompare(b.name) || a.county.localeCompare(b.county),
  );
const counties = [...new Set(pages.map((p) => p.county))].sort();
const countyLinks = counties
  .map(
    (c) =>
      `        <li data-county="${esc(c)}"><a href="#community-profiles" class="link-dark">${esc(c)}</a></li>`,
  )
  .join("\n");
const items = pages
  .map(
    (p) =>
      `      <li data-county="${esc(p.county)}" data-name="${esc(p.name.toLowerCase())}" hidden><a href="${link(`communities/${fileName(p)}`)}">${esc(p.name)}<span class="county-suffix"> (${esc(p.county)})</span>${p.countySeat ? COUNTY_SEAT : ""}</a></li>`,
  )
  .join("\n");
// --- Blog (config/posts.json lists the posts; each post's body is
// posts/<slug>.html). Bodies are plain HTML with two tokens for media:
//   {Photo id}                     a photo from config/photos.json with its
//                                  caption and "(<photographer>/<source>)"
//   {Photos id id id}              photos side by side in one row (same
//                                  aspect ratio), each with its own caption
//   {Video youtubeId | caption | credit}  a YouTube video in YouTube's
//                                  privacy-enhanced mode (no cookies until play),
//                                  credited "(<credit>)" with the credit
//                                  linked to the video on YouTube
const posts = (
  fs.existsSync(paths.config("posts.json"))
    ? paths.readJson(paths.config("posts.json"))
    : []
)
  .map((p, i) => ({ ...p, order: i }))
  // Newest first; posts with the same date go in reverse order of the list
  .sort((a, b) => b.date.localeCompare(a.date) || b.order - a.order);
// The photo for a post's thumbnail on the homepage and blog page:
// "thumbPhoto" in config/posts.json, else the post's top photo
const thumbId = (p) =>
  [p.thumbPhoto, p.photo].find((id) => id && photos.some((x) => x.id === id));
const postPhoto = (id) => {
  const p = photos.find((x) => x.id === id);
  if (!p) throw new Error(`Photo "${id}" not found in config/photos.json`);
  return p;
};
// root: path from the page to the site root. lead: the photo at the top of a
// post loads right away; the rest wait until they're scrolled near.
// A photo not yet in config/photos.json is left out with a warning, so a
// post can go up before its photo is ready.
// "Ripe chokecherries." + credit -> "Ripe chokecherries (Terence Larson)."
// A caption without a closing period gets none.
// sep: what goes between the caption and the credit (a line break for
// narrow portraits)
function withCredit(caption, credit, sep = " ") {
  if (!credit) return caption;
  const end = caption.endsWith(".") ? "." : "";
  return `${end ? caption.slice(0, -1) : caption}${sep}(${credit})${end}`;
}
function photoFigure(id, root, lead = false, sizes = "(max-width: 800px) 100vw, 768px") {
  if (!photos.some((x) => x.id === id)) {
    console.warn(`  Photo "${id}" isn't in config/photos.json yet; left out`);
    return "";
  }
  const p = postPhoto(id);
  const d = p.web.desktop,
    m = p.web.mobile;
  // Credit in parentheses before the caption's period:
  // "Chicory flowers (Raj Chattaraj/Unsplash)." with the credit linked to
  // photographerUrl. "credit" in config/photos.json replaces the usual
  // photographer/source ("[text](url)" in it becomes a link).
  const who = `${esc(p.photographer)}${p.source ? `/${esc(p.source)}` : ""}`;
  const credit = p.credit
    ? esc(p.credit).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" class="link-secondary">$1</a>')
    : p.photographer
      ? p.photographerUrl ? `<a href="${esc(p.photographerUrl)}" class="link-secondary">${who}</a>` : who
      : "";
  const caption = withCredit(esc(p.caption), credit);
  // "narrow": true in config/photos.json keeps a portrait small (CSS .post-figure-narrow)
  if (p.narrow) sizes = "170px";
  return `<figure class="post-figure${p.narrow ? " post-figure-narrow" : ""}">
  <img src="${root}${photoPath(d.file)}" srcset="${root}${photoPath(m.file)} ${m.width}w, ${root}${photoPath(d.file)} ${d.width}w" sizes="${sizes}" width="${d.width}" height="${d.height}" alt="${esc(p.alt)}"${lead ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async" />
  <figcaption>${caption}</figcaption>
</figure>`;
}
// Photos side by side in one row, each with its own caption. lead: the row at
// the top of a post ("leadPhotos" in config/posts.json) loads right away.
function photoRow(list, lead = false) {
  const sizes = `(max-width: 800px) ${Math.round(100 / list.length)}vw, ${Math.round(768 / list.length)}px`;
  return `<div class="post-photo-row row g-3">\n${list.map((id) => `<div class="col">${photoFigure(id, "../", lead, sizes)}</div>`).join("\n")}\n</div>`;
}
// Topic pills ("topics" in config/posts.json)
const tagPills = (p, margin) =>
  p.topics && p.topics.length
    ? `<p class="post-tags ${margin}">${p.topics.map((t) => `<span class="badge rounded tag-pill">${esc(t)}</span>`).join(" ")}</p>`
    : "";
function videoFigure(spec) {
  const [id, caption, credit] = spec.split("|").map((x) => x.trim());
  return `<figure class="post-figure">
  <div class="ratio ratio-16x9"><iframe src="https://www.youtube-nocookie.com/embed/${esc(id)}" title="${esc(caption)}" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>
  <figcaption>${withCredit(esc(caption), credit ? `<a href="https://www.youtube.com/watch?v=${esc(id)}" class="link-secondary">${esc(credit)}</a>` : "")}</figcaption>
</figure>`;
}
// Homepage: the newest blog posts as small media items above Community
// Profiles. "homeBlogStyle" in config/site.json picks the look:
//   "light": light gradient card (bg-light-gradient)
//   "dark":  dark gradient card
// Either way, the Community Profiles card is bg-light-gradient.
const HOME_POSTS = 4;
const darkBlog = site.homeBlogStyle === "dark";
const homeBlog = posts.length
  ? `<section style="margin-bottom: 2.25rem" aria-labelledby="home-blog-title">
    <div class="home-blog card ${darkBlog ? "home-blog-dark" : "bg-light-gradient"} shadow-sm rounded-1"${darkBlog ? ' data-bs-theme="dark"' : ""}>
    <div class="card-header bg-transparent rule-fade-end d-flex justify-content-between align-items-baseline">
      <h2 id="home-blog-title" class="h6 fs-md mb-0${darkBlog ? " text-white" : ""}">${esc(site.name)} Blog</h2>
      ${darkBlog
        ? `<a href="${link("blog.html")}" class="home-blog-more btn btn-primary btn-sm border border-1 border-white font-sans">View the Blog &raquo;</a>`
        : `<a href="${link("blog.html")}" class="home-blog-more home-blog-more-light btn btn-secondary btn-sm font-sans">View the Blog &raquo;</a>`}
    </div>
    <div class="card-body py-3">
    <div class="row gx-0 gx-lg-5 gy-2">
${posts
  .filter((p) => !p.hideOnHome)
  .slice(0, HOME_POSTS)
  .map((p) => {
    const ph =
      thumbId(p) ? postPhoto(thumbId(p)) : null;
    const img = ph
      ? `<img src="${photoPath(ph.web.mobile.file)}" width="96" height="54" alt="" loading="lazy" decoding="async" class="home-blog-thumb flex-shrink-0 rounded-1 me-2"${ph.thumbPosition ? ` style="object-position: ${esc(ph.thumbPosition)}"` : ""} />`
      : "";
    return `      <div class="col-lg-3 home-blog-col">
        ${darkBlog
          ? `<a href="${link(`blog/${p.slug}.html`)}" class="home-blog-item d-flex align-items-center h-100 link-light">
          ${img}<span>${(p.topics || []).length ? `<span class="d-block d-lg-none home-blog-tags">${p.topics.map((t) => `<span class="badge rounded tag-pill">${esc(t)}</span>`).join(" ")}</span>` : ""}<span class="d-block fw-bold lh-sm">${esc(p.shortTitle || p.title)}</span></span>
        </a>`
          : `<a href="${link(`blog/${p.slug}.html`)}" class="home-blog-item d-flex align-items-center h-100 text-reset text-decoration-none">
          ${img}<span>${(p.topics || []).length ? `<span class="d-block d-lg-none home-blog-tags">${p.topics.map((t) => `<span class="badge rounded tag-pill">${esc(t)}</span>`).join(" ")}</span>` : ""}<span class="home-blog-title d-block fw-bold lh-sm">${esc(p.shortTitle || p.title)}</span></span>
        </a>`}
      </div>`;
  })
  .join("\n")}
    </div>
    </div>
    </div>
  </section>`
  : "";
const indexHtml = fill(template("index.html"), {
  "{Home Photo Desktop}": homePhoto.desktop,
  // With a top ad showing, a shorter photo on large screens so the ad
  // doesn't push the page's content out of view
  "{Home Band Ads}": adSpot("home-top-resp") ? " home-band-ads" : "",
  // Top ad, between the photo and the blog previews. Spots without an ID
  // leave no blank space.
  "{Home Top Ad}": adSpot("home-top-resp")
    ? `<div class="container pt-4">${adSpot("home-top-resp")}</div>`
    : "",
  // Ad-free, the content sits closer to the photo and the footer
  // Under the top ad: the ad's own margin (24px) plus 8px above the content
  "{Home Content Margin}": adSpot("home-top-resp")
    ? "mt-2 mb-5"
    : ["home-bottom-1-resp", "home-bottom-2", "home-bottom-3"].some((n) => adSpot(n))
      ? "my-5" // 48px gaps, like town pages
      : "mt-5 mb-4",
  "{Home Photo Mobile}": homePhoto.mobile,
  // The tagline's last word stays on the same line as the icon after it
  "{Tagline Start}": esc(site.tagline).replace(/\S+$/, ""),
  "{Tagline Last}": esc(site.tagline).match(/\S+$/)[0],
  "{County Links}": countyLinks,
  "{Profile Items}": items,
  "{Home Blog}": homeBlog,
  // Community Profiles card background follows the blog card's style
  "{Community Card Bg}": "bg-light-gradient",
});
fs.writeFileSync(
  path.join(outDir, "index.html"),
  wrapPage(
    indexHtml,
    `${esc(site.name)} | ${esc(site.tagline)}`,
    link("index.html"),
    "",
    "shadow",
    true,
    {
      // share-home.jpg is a 1200 x 630 crop of the home photo; make a new one if "homePhoto" changes
      path: "",
      image: "images/share-home.jpg",
      imageAlt: homePhoto.alt,
      jsonLd: {
        "@type": "WebSite",
        name: site.name,
        description: SITE_DESCRIPTION,
        ...(site.url ? { url: `${site.url}/` } : {}),
      },
    },
  ),
);

// --- About and Contact pages (templates/about.html, templates/contact.html)
fs.writeFileSync(
  path.join(outDir, "about.html"),
  wrapPage(
    fill(template("about.html"), { "{Site Name}": esc(site.name) }),
    `About | ${esc(site.name)}`,
    link("index.html"),
    "",
    "shadow",
    true,
    {
      path: "about.html",
      crumb: "About",
      jsonLd: { "@type": "AboutPage", name: `About ${site.name}` },
    },
  ),
);
fs.writeFileSync(
  path.join(outDir, "contact.html"),
  wrapPage(
    fill(template("contact.html"), {
      "{Site Name}": esc(site.name),
      "{Email User}": esc(site.email.split("@")[0]),
      "{Email Domain}": esc(site.email.split("@")[1]),
      "{Email Domain Spoken}": esc(
        site.email.split("@")[1].replace(/\./g, " dot "),
      ),
      "{Social Handle}": esc(site.socialHandle),
      "{Social List}": site.social
        .map(
          (s) =>
            `    <li class="mb-2"><a href="${esc(s.url)}" class="social-row link-dark"><span class="social-hex">${socialIcon(s)}</span>${esc(s.name)}</a></li>`,
        )
        .join("\n"),
    }),
    `Contact | ${esc(site.name)}`,
    link("index.html"),
    "",
    "shadow",
    true,
    {
      description: `Questions, comments or corrections? Contact ${site.name}.`,
      path: "contact.html",
      crumb: "Contact",
      jsonLd: { "@type": "ContactPage", name: `Contact ${site.name}` },
    },
  ),
);

{
  const blogDir = path.join(outDir, "blog");
  fs.mkdirSync(blogDir, { recursive: true });
  for (const p of posts) {
    const body = fs
      .readFileSync(path.join(paths.dirs.root, "posts", `${p.slug}.html`), "utf8")
      .replace(/\{Photos ([\w\s-]+)\}/g, (_, ids) => photoRow(ids.trim().split(/\s+/)))
      .replace(/\{Photo ([\w-]+)\}/g, (_, id) => photoFigure(id, "../"))
      .replace(/\{Video ([^}]+)\}/g, (_, x) => videoFigure(x))
      .trim();
    const lead =
      p.photo && photos.some((x) => x.id === p.photo) ? postPhoto(p.photo) : null;
    fs.writeFileSync(
      path.join(blogDir, `${p.slug}.html`),
      wrapPage(
        fill(template("post.html"), {
          "{Blog URL}": link("../blog.html"),
          "{Site Name}": esc(site.name),
          "{Post Title}": esc(p.title),
          // The post's tags, below Recent Posts in the sidebar
          "{Post Tags}": tagPills(p, "mb-4"),
          "{Post Date ISO}": p.date,
          "{Post Date}": apDate(p.date),
          // "by Beehive Guide" links home, like the town pages
          "{Post Author}":
            (p.author || site.name) === site.name
              ? `<a href="${link("../index.html")}" class="link-dark">${esc(site.name)}</a>`
              : esc(p.author),
          // Summary above the article ("lead" in config/posts.json)
          "{Post Lead}": p.lead
            ? `<p class="lead rule-fade-both pb-3 mb-4">${esc(p.lead)}</p>`
            : "",
          // "leadPhotos" (a list of photo IDs) puts a row of photos on top in
          // place of the single "photo," which still serves as the thumbnail
          // and share image
          "{Post Photo}": p.leadPhotos
            ? photoRow(p.leadPhotos, true)
            : p.photo
              ? photoFigure(p.photo, "../", true)
              : "",
          "{Post Body}": body,
          // Sidebar: the newest posts, leaving out this one
          "{Recent Posts}": posts
            .filter((o) => o.slug !== p.slug)
            .slice(0, 4)
            .map(
              (o) =>
                `              <li><a href="${link(`${o.slug}.html`)}" class="fw-bold">${esc(o.title)}</a><br /><small class="text-secondary font-sans">${apDate(o.date)}</small></li>`,
            )
            .join("\n"),
        }),
        `${esc(p.title)} | ${esc(site.name)} Blog`,
        link("../index.html"),
        "../",
        "shadow",
        true,
        {
          description: p.lead,
          path: `blog/${p.slug}.html`,
          crumb: p.title,
          ogType: "article",
          ogTitle: esc(p.title),
          article: {
            author: p.author || site.name,
            published: p.date,
            modified: p.updated,
            tags: p.topics || [],
          },
          ...(p.shareImage
            ? { image: p.shareImage, imageAlt: lead ? lead.alt : p.title }
            : {}),
          jsonLd: {
            "@type": "BlogPosting",
            headline: p.title,
            datePublished: p.date,
            ...(p.updated ? { dateModified: p.updated } : {}),
            author: { "@type": (p.author || site.name) === site.name ? "Organization" : "Person", name: p.author || site.name },
            publisher: { "@type": "Organization", name: site.name },
            ...(p.topics ? { keywords: p.topics.join(", ") } : {}),
            ...(site.url && p.shareImage
              ? { image: `${site.url}/${p.shareImage}` }
              : {}),
          },
        },
      ),
    );
  }
  // Remove pages for posts no longer in config/posts.json
  const keep = new Set(posts.map((p) => `${p.slug}.html`));
  for (const f of fs.readdirSync(blogDir))
    if (f.endsWith(".html") && !keep.has(f)) {
      fs.unlinkSync(path.join(blogDir, f));
      console.log(`  Removed old post page blog/${f}`);
    }
  // Blog index (blog.html at the site root, served at /blog, so its links
  // work the same with or without a trailing slash): newest first
  const postList = posts
    .map((p) => {
      const href = link(`blog/${p.slug}.html`);
      const ph =
        thumbId(p) ? postPhoto(thumbId(p)) : null;
      const img = ph
        ? `<div class="col-md-4 mb-3 mb-md-0"><a href="${href}" tabindex="-1" aria-hidden="true"><img src="${photoPath(ph.web.mobile.file)}" width="${ph.web.mobile.width}" height="${ph.web.mobile.height}" alt="" loading="lazy" decoding="async" /></a></div>`
        : "";
      return `    <article class="post-card row py-4">
      ${img}
      <div class="${ph ? "col-md-8" : "col-12"}">
        <h2 class="h4 mb-2"><a href="${href}">${esc(p.title)}</a></h2>
        ${tagPills(p, "mb-2")}
        <p class="mb-0">${esc(p.lead)}</p>
      </div>
    </article>`;
    })
    .join("\n");
  fs.writeFileSync(
    path.join(outDir, "blog.html"),
    wrapPage(
      fill(template("blog.html"), {
        "{Post List}": postList,
        "{Site Name}": esc(site.name),
      }),
      `${esc(site.name)} | Blog`,
      link("index.html"),
      "",
      "shadow",
      true,
      {
        description: `Articles on native plants, weeds, gardening and nature in Utah and the Mountain West.`,
        path: "blog.html",
        crumb: "Blog",
        jsonLd: { "@type": "Blog", name: `${site.name} Blog` },
      },
    ),
  );
}

// --- 404 page. Served at any missing address, so its links start at the site root.
fs.writeFileSync(
  path.join(outDir, "404.html"),
  wrapPage(
    fill(template("404.html"), {
      "{Community Profiles URL}": site.cleanLinks
        ? "/#community-profiles"
        : "/index.html#community-profiles",
    }),
    `Page not found | ${esc(site.name)}`,
    site.cleanLinks ? "/" : "/index.html",
    "/",
    "shadow",
    true,
    { noindex: true },
  ),
);

// County outlines for the map page. Uses a UGRC county boundaries GeoJSON in
// sources/ugrc/county-boundaries/ if there is one (more detailed), otherwise
// the Census outlines in sources/census/county-boundaries/. Coordinates are
// rounded to keep the page small.
function countyOutlinesJson() {
  const dirs = [
    paths.source("ugrc", "county-boundaries"),
    paths.source("census", "county-boundaries"),
  ];
  const dir = dirs.find(
    (d) =>
      fs.existsSync(d) &&
      fs.readdirSync(d).some((f) => /\.(geo)?json$/i.test(f)),
  );
  if (!dir) {
    console.warn("  No county boundaries found; map counties have no outlines");
    return "null";
  }
  const file = fs.readdirSync(dir).find((f) => /\.(geo)?json$/i.test(f));
  const round = (c) =>
    Array.isArray(c[0])
      ? c.map(round)
      : [Math.round(c[0] * 1e4) / 1e4, Math.round(c[1] * 1e4) / 1e4];
  const out = {};
  for (const f of paths.readJson(path.join(dir, file)).features) {
    const name = String(f.properties.NAME || f.properties.Name || "")
      .toLowerCase()
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
    if (name)
      out[name] = {
        type: f.geometry.type,
        coordinates: round(f.geometry.coordinates),
      };
  }
  return JSON.stringify(out);
}

// Utah's outline for the map page: the union of the Census county outlines,
// in sources/census/state-boundary/ (made once from the county file)
function stateOutlineJson() {
  const dir = paths.source("census", "state-boundary");
  const file =
    fs.existsSync(dir) &&
    fs.readdirSync(dir).find((f) => /\.(geo)?json$/i.test(f));
  if (!file) return "null";
  const round = (c) =>
    Array.isArray(c[0])
      ? c.map(round)
      : [Math.round(c[0] * 1e4) / 1e4, Math.round(c[1] * 1e4) / 1e4];
  const g = paths.readJson(path.join(dir, file)).features[0].geometry;
  return JSON.stringify({ type: g.type, coordinates: round(g.coordinates) });
}

// --- Map page: every community on one full-screen map, with search
{
  const placesJson = JSON.stringify(
    communities.map((t) => [
      shared(t) ? `${t.name} (${t.county})` : t.name,
      t.county,
      Math.round(t.lat * 1e5) / 1e5,
      Math.round(t.lng * 1e5) / 1e5,
      link(`communities/${fileName(t)}`),
      t.countySeat ? 1 : 0,
    ]),
  ).replace(/</g, "\\u003c");
  fs.writeFileSync(
    path.join(outDir, "map.html"),
    wrapPage(
      // No footer here; the copyright sits in the map's panel instead
      fill(template("map.html"), {
        "{Map Places JSON}": placesJson,
        "{Seat Icon JSON}": JSON.stringify(COUNTY_SEAT),
        "{Town Popup JSON}": JSON.stringify(TOWN_POPUP).replace(
          /</g,
          "\\u003c",
        ),
        "{County Outlines JSON}": countyOutlinesJson(),
        "{State Outline JSON}": stateOutlineJson(),
        "{Year}": now.getFullYear(),
        "{Site Name}": esc(site.name),
        "{About URL}": link("about.html"),
        // Reopens the privacy box (no footer on this page)
        "{Privacy Button}": site.consentBanner
          ? `\n    <button type="button" class="map-corner-btn btn btn-secondary font-sans" data-consent-open>Privacy Choices</button>`
          : "",
      }),
      `Map of Utah Communities | ${esc(site.name)}`,
      link("index.html"),
      "",
      "shadow-none",
      false, // the search bar gets the shadow
      {
        description:
          "Search a map of towns and cities across Utah, with county lines.",
        path: "map.html",
        crumb: "Map",
      },
    ),
  );
}

// --- XML sitemap: the homepage and every town page. URLs are relative until
// "url" is set in config/site.json; search engines expect full URLs.
// Town pages use their "Updated" date; the other pages use today.
const lastmod = {};
for (const p of pages)
  if (pageDates[fileName(p)])
    lastmod[
      `/communities/${site.cleanLinks ? fileName(p).replace(/\.html$/, "") : fileName(p)}`
    ] = pageDates[fileName(p)].date;
for (const p of posts)
  lastmod[site.cleanLinks ? `/blog/${p.slug}` : `/blog/${p.slug}.html`] =
    p.updated || p.date;
const urls = [
  "/",
  ...["map", "about", "contact"].map((n) =>
    site.cleanLinks ? `/${n}` : `/${n}.html`,
  ),
  site.cleanLinks ? "/blog" : "/blog.html",
  ...posts.map((p) =>
    site.cleanLinks ? `/blog/${p.slug}` : `/blog/${p.slug}.html`,
  ),
  ...pages.map(
    (p) =>
      `/communities/${site.cleanLinks ? fileName(p).replace(/\.html$/, "") : fileName(p)}`,
  ),
];
fs.writeFileSync(
  path.join(outDir, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${esc(site.url + u)}</loc>
    <lastmod>${lastmod[u] || todayIso}</lastmod>
  </url>`,
  )
  .join("\n")}
</urlset>
`,
);
console.log(
  `Done! Wrote ${list.length} pages, an index of ${pages.length}, about, contact, ${posts.length} blog post${posts.length === 1 ? "" : "s"}, 404.html and sitemap.xml to ${path.relative(paths.dirs.root, outDir) || "."}/`,
);
