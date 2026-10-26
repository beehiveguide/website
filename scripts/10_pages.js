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
const communities = paths.readJson(paths.build("communities.json"));
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
const updated = `${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`; // AP style
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

// Each source: what it supplied (bold, first), then the source, linked.
// Names and links come from sources/sources.json.
const source = (items, key, prefix = "") => {
  const s = SOURCE_LIST[key];
  // "url" in sources.json is where the data was downloaded; "publicUrl" (when
  // set) is the public-facing page readers are sent to instead.
  const href = s.publicUrl || s.url;
  // A license (sources.json "license": { name, url }) follows after a comma:
  // "UGRC, CC-BY-4.0"
  const license = s.license ? `, <a href="${s.license.url}">${esc(s.license.name)}</a>` : "";
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
  // 08c_soil.js: "Slopes suitable for cultivation lie mostly in
  // the foothills, with soils including...". Spread-out towns: "Slopes
  // suitable for cultivation have soils including...".
  // "In the foothills" and "on mountainsides" keep "slopes" from repeating.
  const OPENING_WORDS = { "on foothill slopes": "in the foothills", "on mountain slopes": "on mountainsides" };
  const forms = s.arableForms.map((f) => OPENING_WORDS[f] || f);
  // "on valley floors and benches above streams", but "in the foothills and on
  // floodplains" when the two take different words
  const joinPlaces = ([a, b]) => {
    if (!b) return a;
    const pa = a.split(" ")[0], pb = b.split(" ")[0];
    return pa === pb && (pa === "on" || pa === "in") ? `${a} and ${b.slice(pb.length + 1)}` : `${a} and ${b}`;
  };
  const opening = forms.length
    ? `Slopes suitable for cultivation lie mostly ${esc(joinPlaces(forms))}, with soils including`
    : `Slopes suitable for cultivation have soils including`;
  // Salt, organic matter, farmland rating and limits.
  // Percentages are shares of the slopes suitable for cultivation.
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
  history: (hasYear, hasOrigin) =>
    source(
      [hasYear && "Founding", hasOrigin && "name"]
        .filter(Boolean)
        .join(" and ")
        .replace(/^n/, "N"),
      // Name origins are reworded (config/origin_rewrites.json)
      "history",
      hasOrigin ? "Adapted from " : "",
    ),
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
  // "Police, fire, parks and schools": only the Community Services sections shown
  ugrc: (shown) => source(capFirst(listText(shown)), "ugrc"),
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
  "home-top": "banner",
  "home-bottom-1": "large",
  "home-bottom-2": "large",
  "home-bottom-3": "large",
  "town-top": "banner",
  "town-middle": "banner",
  "town-bottom-1": "rect",
  "town-bottom-2": "rect",
  "town-bottom-3": "rect",
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
  "{Ad home-top}": adSpot("home-top"),
  "{Ad town-top}": adSpot("town-top"),
  "{Ad town-middle}": adSpot("town-middle", "mb-5 d-none d-md-block"), // not on phones
  // On home, a rule sets the ads apart from the town list
  "{Ads home-bottom}": ((row) =>
    row && `<hr id="home-ads-rule" class="mt-5 mb-0">\n${row}`)(
    adRow(
      ["home-bottom-1", "home-bottom-2", "home-bottom-3"],
      [
        "col-md-6 col-xl-4",
        "col-md-6 col-xl-4 d-none d-md-block",
        "col-xl-4 d-none d-xl-block",
      ],
      "mt-4 pb-3 mb-4",
    ),
  ),
  "{Ads town-bottom}": adRow(
    ["town-bottom-1", "town-bottom-2", "town-bottom-3"],
    [
      "col-md-6 col-xl-4",
      "col-md-6 col-xl-4 d-none d-md-block",
      "col-xl-4 d-none d-xl-block",
    ],
    "mt-3",
  ),
});
const AD_SCRIPT =
  ADS.mode === "on" && ADS.client
    ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(ADS.client)}" crossorigin="anonymous"></script>`
    : "";

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
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(site.name)}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    m.path !== undefined && full(m.path)
      ? `<meta property="og:url" content="${esc(full(m.path))}" />`
      : "",
    `<meta property="og:image" content="${esc(site.url ? `${site.url}/${m.image}` : root + m.image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(m.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    m.jsonLd
      ? `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", ...m.jsonLd }).replace(/</g, "\\u003c")}</script>`
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
    AD_SCRIPT,
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
// Directions links that open each service with the community as the destination
const directionsLinks = (t) =>
  [
    [
      "Google Maps",
      `https://www.google.com/maps/dir/?api=1&amp;destination=${t.lat},${t.lng}`,
    ],
    ["Apple Maps", `https://maps.apple.com/?daddr=${t.lat},${t.lng}`],
    [
      "OpenStreetMap",
      `https://www.openstreetmap.org/directions?to=${t.lat}%2C${t.lng}`,
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
const uniqueBy = (items, key) => {
  const seen = new Set();
  return items.filter((i) => !seen.has(key(i)) && seen.add(key(i)));
};

// Police agencies serving a place: ["the Logan Police Department"]
function policeAgencies(t) {
  const law = ((t.services && t.services.law) || []).map((l) => tidyName(l.name));
  if (!law.length) return [];
  // A city's own department covers it; the sheriff covers places without one.
  // Tribal police (Ute, Navajo Nation, Goshute) work alongside either one on
  // reservation land, so they never replace the sheriff.
  const TRIBAL = /tribal|navajo nation/i;
  const local = law.filter((n) => !/Sheriff/i.test(n) && !TRIBAL.test(n));
  const main = local.length ? local : law.filter((n) => /Sheriff/i.test(n));
  return main.map(withThe).map(esc);
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
    const name = esc(withThe(dept));
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
  return `<p>${capFirst(listText(withThe))} ${libs.length > 1 ? "serve" : "serves"} ${placeWord(t)}.</p>`;
}

function cemeteryHtml(t) {
  const list = uniqueBy((t.places && t.places.cemeteries) || [], (c) => c.name.toLowerCase());
  if (!list.length) return "";
  if (list.length === 1) {
    const c = list[0];
    return `<p>${c.year ? `${esc(c.name)} dates to ${c.year}.` : `${esc(c.name)} serves ${placeWord(t)}.`}</p>`;
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
function parkParts(t) {
  const parks = (t.places && t.places.parks) || [];
  const named = uniqueBy(parks.filter((p) => !p.generic), (p) => p.name.toLowerCase());
  const generic = parks.filter((p) => p.generic);
  if (!named.length && !generic.length) return null;
  if (named.length > BIG_LIST) {
    // Unnamed parks aren't mentioned under a list
    const items = named.map((p) => `<li>${esc(p.name)}</li>`).join("\n      ");
    return { list: `<ul class="col-list">\n      ${items}\n    </ul>` };
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
    // Parks, then the town's one cemetery in a second sentence: "Mendon has
    // two parks. It also has the Mendon City Cemetery, which dates to 1860."
    if (cems.length === 1) {
      const c = cems[0];
      const the = /^the /i.test(c.name) ? "" : "the ";
      const cem = c.year ? `${the}${esc(c.name)}, which dates to ${c.year}` : `${the}${esc(c.name)}`;
      return `<p>${town} has ${join(parks.inList ? (parks.head === "one park" ? ", " : ": ") : ", including ")}. It also has ${cem}.</p>`;
    }
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
  const higherText = higher.length
    ? `${listText(higher.map(nameLink))} ${higher.length > 1 ? "are" : "is"} located in ${placeWord(t)}.`
    : "";
  const out = { k12: "", higher: higherText ? `<p>${higherText}</p>` : "" };
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
  const townHas = `${t.placeType === "city" || t.placeType === "town" ? `The ${t.placeType} of ` : ""}${esc(t.name)} has`;
  const levelTally = `${townHas} ${listText(levels)}.`;
  // A tally leads when any level has more than one school
  const showTally = [...tally((x) => x.level).values()].some((n) => n > 1);
  if (all.length > SCHOOL_TABLE_MIN) {
    const rows = all
      .map(
        (x) =>
          `<tr><th scope="row" class="fw-normal">${nameLink(x)}${x.alt ? " (alternative)" : ""}</th><td>${esc(x.level)}</td><td>${x.grades}</td><td>${esc(x.leaType === "District" ? x.leaShort || x.kind : x.kind)}</td></tr>`,
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
    out.k12 = `${summary}
    <div class="table-responsive">
      <table class="table table-sm schools-table">
        <thead><tr><th scope="col">School</th><th scope="col">Level</th><th scope="col">Grades</th><th scope="col">District or Type</th></tr></thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>`;
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
          return `${names} ${group.length === 1 ? "is" : "are"} located in the ${nameLink({ name: kind, url: group[0].leaUrl })}.`;
        const label = kind === "Charter" ? "charter" : kind === "Private" ? "private" : "other";
        return group.length === 1 ? `${names} is a ${label} school.` : `${capFirst(label)} schools are ${names}.`;
      });
    };
    // One school in a paragraph shares the opening sentence: "Additionally,
    // it has a K–12 school, Terra Academy (K–12), which is a charter school."
    const which = (x) =>
      x.leaType === "District"
        ? `which is located in the ${nameLink({ name: x.kind, url: x.leaUrl })}`
        : `which is a ${x.kind === "Charter" ? "charter" : x.kind === "Private" ? "private" : "other"} school`;
    // Up to SCHOOL_ONE_PARAGRAPH schools: one paragraph. More: a paragraph
    // for elementary and one for middle and high schools, each led in bold.
    if (all.length <= SCHOOL_ONE_PARAGRAPH) {
      // A count leads: by level when a level has more than one school
      // ("The city of Roosevelt has four elementary schools…"), otherwise
      // in all ("The city of Beaver has three schools."). One school shares
      // the sentence: "Neola has one school, Neola School (K–5), which is in…"
      if (all.length === 1)
        out.k12 = `<p>${townHas} one school, ${item(all[0])}, ${which(all[0])}.</p>`;
      // All in one district (or all charter, or all private): one sentence,
      // "The city of Beaver has three schools, A (pre-K), B (K–6) and C
      // (7–12), which are located in the Beaver County School District."
      else if (new Set(all.map((x) => x.kind)).size === 1) {
        const x = all[0];
        const where =
          x.leaType === "District"
            ? `located in the ${nameLink({ name: x.kind, url: x.leaUrl })}`
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
    out.k12 = [...byLevel]
      .map(([, list], i) =>
        list.length === 1
          ? // "a K–12 school, Terra Academy," without repeating "(K–12)"
            `<p>${opener(i)} ${listText(levelsOf(list))}, ${list[0].level === "K-12" && list[0].grades === "K&ndash;12" && !list[0].alt ? nameLink(list[0]) : item(list[0])}, ${which(list[0])}.</p>`
          : `<p>${opener(i)} ${listText(levelsOf(list))}. ${sentencesFor(list).join(" ")}</p>`,
      )
      .join("\n    ");
    return out;
  }
  return out;
}

function hospitalText(t) {
  const list = (t.places && t.places.hospitals) || [];
  if (!list.length) return "";
  return `${listText(list.map(nameLink))} ${list.length > 1 ? "serve" : "serves"} the area.`;
}

// Returns { html, shown } where shown names the sections for the source line.
function servicesHtml(t) {
  const p = (text) => (text ? `<p>${text}</p>` : "");
  const schools = schoolsHtml(t);
  const safety = safetyText(t);
  const sections = [
    // Police and fire share a paragraph
    ["Public Safety", "police, fire", safety],
    ["Library", "libraries", libraryHtml(t)],
    [parksCemeteriesTitle(t), "parks, cemeteries", parksCemeteriesHtml(t)],
    ["Schools (Prekindergarten&ndash;12th Grade)", "schools", schools.k12],
    ["Higher Education", "colleges", schools.higher],
    ["Health Care", "hospitals", p(hospitalText(t))],
  ].filter(([, , body]) => body);
  if (!sections.length) return { html: "", shown: [] };
  // Each part is its own section with an h2, styled like Growing Info
  const html = sections
    .map(
      ([title, word, body]) => `<section class="services services-${slug(word)} mb-4">
    <h2 class="rule-fade pb-2 mb-3">${title}</h2>
    ${body}
  </section>`,
    )
    .join("\n  ");
  return {
    html,
    shown: sections.map(([, word]) => word),
  };
}

// Mountain resort towns this high (Brian Head, Brighton) get no Growing Info
// section: no hardiness zone, precipitation, freeze or soil lines.
const GROWING_MAX_FT = 8500;

function buildPage(t) {
  if (t.elevationFt !== null && t.elevationFt >= GROWING_MAX_FT)
    t = { ...t, hardinessZone: "", precipIn: null, freezeFreeDays: undefined, soil: null };
  const src = { gnis: SOURCES.gnis(t.elevationFt !== null) };
  const pop = t.population;
  const ph = t.phone;

  // Settled year (own paragraph) and name origin (lead paragraph)
  const intro = [];
  if (t.founded || t.origin) {
    src.history = SOURCES.history(!!t.founded, !!t.origin);
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
  if (services.shown.length) src.ugrc = SOURCES.ugrc(services.shown);
  // Tribal police come from the reservation boundaries
  if (((t.services && t.services.law) || []).some((l) => /tribal|navajo nation/i.test(l.name)))
    src.reservations = SOURCES.reservations;

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
      const em = (text) => `<em${codes.length > 1 ? ' class="prefix-label"' : ""}>${text}</em>`;
      const mobLabel = `${!list && codes.length > 1 ? `${esc(code)} ` : ""}Mobile:`;
      const parts = [list && `${em(label(code, list))} ${esc(list)}`, mobile && `${em(mobLabel)} ${esc(mobile)}`];
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
    src.reservations,
  ].filter(Boolean);

  let html = townTemplate;
  if (pop && pop.source === "ugrcPop") {
    html = html.replace(
      /<li><strong>Population:<\/strong> \{Town Population\} <small[^\n]*<\/li>/,
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
    "{Town Services}": services.html,
    "{Day Month, Year}": updated,
    "{Site Name}": esc(site.name),
    "{Home URL}": link("../index.html"),
    "{Community Profiles URL}": COMMUNITY_PROFILES_URL,
    "{Nearby Items}": nearbyItems(t),
    "{Map Page URL}": mapUrl(t, "../"),
    "{Town Popup}": fill(TOWN_POPUP, {
      "{Popup Town}": `<span class="marker-link text-body font-zilla me-2">${esc(t.name)}, Utah</span>`,
      "{Popup County}": `<a href="${link("../map.html")}?county=${encodeURIComponent(t.county)}" class="link-secondary">${esc(t.county)} County</a>`,
      "{Popup Seat}": t.countySeat ? COUNTY_SEAT : "",
      "{Popup Directions}": directionsLinks(t),
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
const indexHtml = fill(template("index.html"), {
  "{Home Photo Desktop}": homePhoto.desktop,
  "{Home Band Ads}": ADS.mode === "off" ? "" : " home-band-ads",
  // Ad-free, the content sits closer to the photo and the footer
  "{Home Top Ad}":
    ADS.mode === "off"
      ? ""
      : `<div class="container pt-4">${adSpot("home-top")}</div>`,
  "{Home Content Margin}": ADS.mode === "off" ? "mt-5 mb-4" : "my-5", // 48px gaps, like town pages
  "{Home Photo Mobile}": homePhoto.mobile,
  // The tagline's last word stays on the same line as the icon after it
  "{Tagline Start}": esc(site.tagline).replace(/\S+$/, ""),
  "{Tagline Last}": esc(site.tagline).match(/\S+$/)[0],
  "{County Links}": countyLinks,
  "{Profile Items}": items,
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
      jsonLd: { "@type": "ContactPage", name: `Contact ${site.name}` },
    },
  ),
);

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
      }),
      `Map of Utah Communities | ${esc(site.name)}`,
      link("index.html"),
      "",
      "shadow-none",
      false, // the search bar gets the shadow
      {
        description:
          "Search a map of towns and cities across Utah, with county lines and directions.",
        path: "map.html",
      },
    ),
  );
}

// --- XML sitemap: the homepage and every town page. URLs are relative until
// "url" is set in config/site.json; search engines expect full URLs.
const today = now.toISOString().slice(0, 10);
const urls = [
  "/",
  ...["map", "about", "contact"].map((n) =>
    site.cleanLinks ? `/${n}` : `/${n}.html`,
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
    <lastmod>${today}</lastmod>
  </url>`,
  )
  .join("\n")}
</urlset>
`,
);
console.log(
  `Done! Wrote ${list.length} pages, an index of ${pages.length}, about, contact, 404.html and sitemap.xml to ${path.relative(paths.dirs.root, outDir) || "."}/`,
);
