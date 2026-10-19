// Builds the website in public/ from build/communities.json.
//
// Usage
//   node scripts/10_pages.js                     every community
//   node scripts/10_pages.js Bluff Moab "Cedar City"
//   node scripts/10_pages.js --out test-run      write somewhere other than public/
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

const site = paths.readJson(paths.config("site.json"));
const SOURCE_LIST = paths.readJson(paths.source("sources.json"));
const communities = paths.readJson(paths.build("communities.json"));
const photos = paths.readJson(paths.config("photos.json"));
// Published path of a photo's web version: "static/images/x.webp" -> "images/x.webp"
const photoPath = (file) => file.replace(/^static\//, "");
// Homepage photo ("homePhoto" in config/site.json, an id from config/photos.json)
const homePhoto = (() => {
  const p = photos.find((x) => x.id === site.homePhoto);
  if (!p) throw new Error(`homePhoto "${site.homePhoto}" not found in config/photos.json`);
  return { desktop: photoPath(p.web.desktop.file), mobile: photoPath(p.web.mobile.file), alt: p.alt };
})();
const template = (f) => fs.readFileSync(path.join(paths.dirs.templates, f), "utf8");
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
  else wanted.push(args[i]);
}

// --- Formatting
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n) => Number(n).toLocaleString("en-US");
const NA = "Not available";
const MONTHS = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
const now = new Date();
const updated = `${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`; // AP style
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Internal links. With cleanLinks (Firebase cleanUrls), ".html" and
// "index.html" are left off: "communities/kanab", "../#community-profiles".
const link = (href) => site.cleanLinks
  ? href.replace(/index\.html(?=#|$)/, "").replace(/\.html(?=#|$)/, "") || "./"
  : href;
const COMMUNITY_PROFILES_URL = link("../index.html#community-profiles");

// Names used by more than one community get the county in their filename
// (avon-cache.html, avon-iron.html) and heading ("Avon (Cache), Utah").
const nameCounts = {};
for (const t of communities) nameCounts[slug(t.name)] = (nameCounts[slug(t.name)] || 0) + 1;
const shared = (t) => nameCounts[slug(t.name)] > 1;
const fileName = (t) => shared(t) ? `${slug(t.name)}-${slug(t.county)}.html` : `${slug(t.name)}.html`;

// Each source: what it supplied (bold, first), then the source, linked.
// Names and links come from sources/sources.json.
const source = (items, key, prefix = "") => {
  const s = SOURCE_LIST[key];
  // "url" in sources.json is where the data was downloaded; "publicUrl" (when
  // set) is the public-facing page readers are sent to instead.
  const href = s.publicUrl || s.url;
  return `<strong>${items}:</strong> ${prefix}${href ? `<a href="${href}" class="link-dark">${esc(s.name)}</a>` : esc(s.name)}`;
};
// Sources only appear for data the page shows, and their bold label
// names only what's shown (for example "Location" when there's no elevation).
const SOURCES = {
  gnis: (hasElev) => source(hasElev ? "Location and elevation" : "Location", "gnis"),
  ugrcPop: source("Population", "ugrcPop"),
  census: source("Population and households", "census"),
  history: (hasYear, hasOrigin) => source(
    [hasYear && "Founding year", hasOrigin && "name origin"].filter(Boolean).join(" and ").replace(/^n/, "N"),
    // Name origins are reworded (config/origin_rewrites.json)
    "history", hasOrigin ? "Adapted from " : ""),
  phone: (withPrefixes) => source(withPrefixes ? "Area codes and phone prefixes" : "Area codes", "phone"),
  zone: source("Hardiness zone", "zone"),
  precip: source("Annual precipitation", "precip"),
};

// Shared header and footer. home: link from the page to the homepage.
// In the header, the word in "nameBox" (config/site.json) goes in a slanted box.
let siteTitle = esc(site.name);
if (site.nameBox) siteTitle = siteTitle.replace(esc(site.nameBox),
  `<span class="site-title-box"><span>${esc(site.nameBox)}</span></span>`);
// shadow: Bootstrap shadow class for the header ("shadow" on every page by default)
const header = (home, shadow, root) => fill(template("parts/header.html"), { "{Home URL}": home, "{Header Shadow}": shadow,
  "{About URL}": link(`${root}about.html`), "{Contact URL}": link(`${root}contact.html`), "{Map URL}": link(`${root}map.html`), "{Site Name}": `<span class="site-title-text">${siteTitle}</span>` });
// Social media links ("social" in config/site.json; icons in templates/parts/icons/),
// shared by the footer and the contact page
const socialIcon = (s) => template(`parts/icons/${s.name.toLowerCase()}.svg`).trim();
const footer = fill(template("parts/footer.html"), { "{Year}": now.getFullYear(), "{Site Name}": esc(site.name),
  "{Privacy Link}": site.consentBanner ? `<button type="button" class="footer-privacy btn btn-light btn-sm border font-sans" data-consent-open>Privacy Choices</button>` : "",
  "{Social Handle}": esc(site.socialHandle),
  "{Social Links}": site.social.map((s) => `<a href="${esc(s.url)}" class="social-circle" title="${esc(s.name)}" aria-label="${esc(s.name)}">${socialIcon(s)}</a>`).join("\n      ") });

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
  banner: { label: "728 &times; 90 on wide screens, 320 &times; 100 on phones", format: "horizontal" },
  large: { label: "336 &times; 280", format: "rectangle" },
  rect: { label: "300 &times; 250", format: "rectangle" },
};
const AD_SPOTS = {
  "home-top": "banner", "home-bottom-1": "large", "home-bottom-2": "large", "home-bottom-3": "large",
  "town-top": "banner", "town-middle": "banner", "town-bottom-1": "rect", "town-bottom-2": "rect", "town-bottom-3": "rect",
};
function adSpot(name, margin = "mb-4") {
  const shapeName = AD_SPOTS[name], shape = AD_SHAPES[shapeName];
  if (ADS.mode === "setup") return fill(template("parts/ad.html"), { "{Mode}": "setup", "{Ad Margin}": margin,
    "{Ad Body}": `<div class="ad-box ad-${shapeName}"><span>${esc(name)}</span><small>${shape.label}</small></div>` }).trim();
  if (ADS.mode === "on" && ADS.client && ADS.slots?.[name]) return fill(template("parts/ad.html"), { "{Mode}": "on", "{Ad Margin}": margin,
    "{Ad Body}": `<ins class="adsbygoogle ad-box ad-${shapeName}" data-ad-client="${esc(ADS.client)}" data-ad-slot="${esc(ADS.slots[name])}" data-ad-format="${shape.format}" data-full-width-responsive="true"></ins>\n  <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>` }).trim();
  return "";
}
// A row of ads at the bottom of a page. The first shows on every screen; the
// rest appear as the screen gets wide enough for them.
function adRow(spots, cols, rowClass) {
  const ads = spots.map((n) => adSpot(n, "mb-0")); // the row's gutters space them
  if (!ads.some(Boolean)) return "";
  return `<div class="row justify-content-center g-4 ${rowClass}">\n${ads.map((ad, i) => `  <div class="${cols[i]}">${ad}</div>`).join("\n")}\n</div>`;
}
const adSpots = () => ({ "{Ad home-top}": adSpot("home-top"), "{Ad town-top}": adSpot("town-top"), "{Ad town-middle}": adSpot("town-middle", "mb-5 d-none d-md-block"), // not on phones
  // On home, a rule sets the ads apart from the town list
  "{Ads home-bottom}": ((row) => row && `<hr id="home-ads-rule" class="mt-5 mb-0">\n${row}`)(adRow(["home-bottom-1", "home-bottom-2", "home-bottom-3"],
    ["col-md-6 col-xl-4", "col-md-6 col-xl-4 d-none d-md-block", "col-xl-4 d-none d-xl-block"], "mt-4 pb-3 mb-4")),
  "{Ads town-bottom}": adRow(["town-bottom-1", "town-bottom-2", "town-bottom-3"],
    ["col-md-6 col-xl-4", "col-md-6 col-xl-4 d-none d-md-block", "col-xl-4 d-none d-xl-block"], "mt-3") });
const AD_SCRIPT = ADS.mode === "on" && ADS.client
  ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(ADS.client)}" crossorigin="anonymous"></script>` : "";

// Privacy choices ("consentBanner" in config/site.json): analytics and ad
// cookies start off for every Google tag (Consent Mode) until the visitor
// picks in the box (templates/parts/consent.html, static/js/consent.js).
// This has to come before any Google tag in the head.
const CONSENT_DEFAULTS = site.consentBanner ? `<script>window.dataLayer = window.dataLayer || []; function gtag() { dataLayer.push(arguments); }
gtag("consent", "default", { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", wait_for_update: 500 });</script>` : "";

// The box asks about ads only when ads are set up or on; otherwise just analytics.
const CONSENT_ADS = ADS.mode !== "off";
const CONSENT_BOX = fill(template("parts/consent.html"), {
  "{Consent Text}": CONSENT_ADS
    ? "This site uses cookies for analytics and advertising. Set your preferences for each."
    : "This site uses cookies for analytics. Set your preference.",
  "{Consent Ads Switch}": CONSENT_ADS ? `<div class="form-check form-switch">
        <input class="form-check-input" type="checkbox" id="consent-ads" />
        <label class="form-check-label" for="consent-ads"><strong>Ads</strong>: personalized ads and ad measurement</label>
      </div>` : "",
}).trim();

const SHARE_LOGO = { image: "images/share-logo.png", imageAlt: `${site.name} logo` };
function metaTags(meta, title, root) {
  const m = { ...SHARE_LOGO, ...meta };
  const full = (p) => site.url ? `${site.url}/${link(p)}`.replace(/\/\.\/$/, "/") : null;
  const tags = [
    `<meta name="description" content="${esc(m.description)}" />`,
    m.noindex ? `<meta name="robots" content="noindex" />` : "",
    m.path !== undefined && full(m.path) ? `<link rel="canonical" href="${esc(full(m.path))}" />` : "",
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(site.name)}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    m.path !== undefined && full(m.path) ? `<meta property="og:url" content="${esc(full(m.path))}" />` : "",
    `<meta property="og:image" content="${esc(site.url ? `${site.url}/${m.image}` : root + m.image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(m.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    m.jsonLd ? `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", ...m.jsonLd }).replace(/</g, "\\u003c")}</script>` : "",
  ];
  return tags.filter(Boolean).join("\n");
}
const SITE_DESCRIPTION = `Community info for Utah. View location, population, postal, phone, gardening and other community info for towns and cities across the state.`;

function wrapPage(html, title, home, root, headerShadow = "shadow", showFooter = true, meta = {}) {
  html = fill(html, adSpots());
  const headTags = [metaTags({ description: SITE_DESCRIPTION, ...meta }, title, root), CONSENT_DEFAULTS, AD_SCRIPT].filter(Boolean);
  let match;
  while ((match = html.match(/^\s*(<meta[^>]*\/>|<link[\s\S]*?\/>|<style>[\s\S]*?<\/style>)\s*/))) {
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
    header(home, headerShadow, root).trim(),
    `<main id="main" tabindex="-1">\n${content}\n</main>`,
    showFooter ? footer.trim() : "",
    site.consentBanner ? CONSENT_BOX : "",
    scripts,
    site.consentBanner ? `<script src="${root}js/consent.js"></script>` : "",
  ].filter(Boolean).join("\n\n");
  return fill(template("parts/document.html"), {
    "{Title}": title, "{Head}": headTags.join("\n"), "{Root}": root, "{Body}": html.trim(),
  });
}

const townTemplate = template("town-page.html");
// Town popup on both maps (filled here for town pages, in the browser on map.html)
const TOWN_POPUP = template("parts/town-popup.html").trim();

// County seats get a small courthouse (courthouse-simple.svg in the Drive
// folder's icons) after the name, just outside the link, in the town lists and
// map popups. Screen readers hear "county seat" instead.
const SEAT_ICON = '<svg class="county-seat-icon" viewBox="27 30 46 40" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M50 30 L72 41 H28 Z M30 41 H70 V44.5 H30 Z M33 47 H39 V63 H33 Z M47 47 H53 V63 H47 Z M61 47 H67 V63 H61 Z M27 65.5 H73 V70 H27 Z"/></svg>';
// Town pages use the honeycomb version (courthouse-simple-hex.svg) in the note after the name
const SEAT_HEX = '<svg class="county-seat-icon me-1" viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" fill-rule="evenodd" d="M50.00 0.76 L92.64 25.38 L92.64 74.62 L50.00 99.24 L7.36 74.62 L7.36 25.38 Z M46.10 11.33 Q50.00 9.08 53.90 11.33 L81.54 27.29 Q85.44 29.54 85.44 34.04 L85.44 65.96 Q85.44 70.46 81.54 72.71 L53.90 88.67 Q50.00 90.92 46.10 88.67 L18.46 72.71 Q14.56 70.46 14.56 65.96 L14.56 34.04 Q14.56 29.54 18.46 27.29 Z"/>' +
  '<path fill="currentColor" fill-rule="evenodd" transform="translate(50 51) scale(0.95) translate(-50 -50)" d="M50 30 L72 41 H28 Z M30 41 H70 V44.5 H30 Z M33 47 H39 V63 H33 Z M47 47 H53 V63 H47 Z M61 47 H67 V63 H61 Z M27 65.5 H73 V70 H27 Z"/></svg>';
const COUNTY_SEAT = `<span class="county-seat" title="County seat">${SEAT_ICON}<span class="visually-hidden">(county seat)</span></span>`;

// One full-screen map page for all communities: map.html?town=<name>
const mapUrl = (t, root) => link(`${root}map.html`) + `?town=${fileName(t).replace(/\.html$/, "")}`;
// Directions links that open each service with the community as the destination
const directionsLinks = (t) => [
  ["Google Maps", `https://www.google.com/maps/dir/?api=1&amp;destination=${t.lat},${t.lng}`],
  ["Apple Maps", `https://maps.apple.com/?daddr=${t.lat},${t.lng}`],
  ["OpenStreetMap", `https://www.openstreetmap.org/directions?to=${t.lat}%2C${t.lng}`],
].map(([name, url]) => `<a href="${url}" class="link-dark">${name}</a>`).join(" &middot; ");

// Nearby communities: the closest ones by straight-line distance, any county
const NEARBY_COUNT = 12;
const milesBetween = (a, b) => {
  const r = Math.PI / 180, R = 3958.8; // Earth's radius in miles
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
function nearbyItems(t) {
  return communities.filter((o) => o.id !== t.id)
    .map((o) => ({ o, miles: milesBetween(t, o) }))
    .sort((a, b) => a.miles - b.miles)
    .slice(0, NEARBY_COUNT)
    .map(({ o }) => `      <li><a href="${link(fileName(o))}">${esc(o.name)}</a>${o.countySeat ? COUNTY_SEAT : ""}</li>`)
    .join("\n");
}

function buildPage(t) {
  const sources = [SOURCES.gnis(t.elevationFt !== null)];
  const pop = t.population;
  const ph = t.phone;

  // Settled year (own paragraph) and name origin (lead paragraph)
  const intro = [];
  if (t.founded || t.origin) {
    sources.push(SOURCES.history(!!t.founded, !!t.origin));
    // "Settled 1890" -> "(Settled in 1890)"
    if (t.founded) intro.push(`<p class="text-secondary mt-2 mb-2"><em>(${esc(t.founded.replace(/^(\w+) (\d{4})$/, "$1 in $2"))})</em></p>`);
    if (t.origin) intro.push(`<p class="lead mb-4 mb-lg-3">${esc(t.origin)}</p>`);
  }
  if (pop) sources.push(SOURCES[pop.source]);
  if (t.hardinessZone) sources.push(SOURCES.zone);
  if (t.precipIn !== null) sources.push(SOURCES.precip);

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
    const groups = codes.length === 1
      ? [[codes[0], ph.prefixes]]
      : ph.prefixes.split("\n").map((line) => line.split(": "));
    const label = (code, list) =>
      `${codes.length > 1 ? `${esc(code)} ` : ""}Prefix${list.includes(",") ? "es" : ""}:`;
    const total = groups.reduce((n, [, list]) => n + list.split(",").length, 0);
    const long = total > site.prefixReveal;
    const line = (code, list) =>
      `<small class="text-secondary font-sans"><em${codes.length > 1 ? ' class="prefix-label"' : ""}>${label(code, list)}</em> ${esc(list)}</small>`;
    // In the fold-out box each group is its own block with a little space
    // between; otherwise groups are just separate lines
    const text = long
      ? groups.map(([code, list], i) =>
        `<div${i < groups.length - 1 ? ' class="mb-2"' : ""}>${line(code, list)}</div>`).join("")
      : groups.map(([code, list]) => line(code, list)).join("<br />");
    phoneItems = `<li><strong>Area Code${codes.length > 1 ? "s" : ""}:</strong> ${codes.map(esc).join("/")}
          <ul class="list-unstyled mb-0">
            <li>${long
              ? `<div class="prefix-box">
                <div class="prefix-reveal">${text}<div class="prefix-close-row"><button type="button" class="prefix-close prefix-toggle btn btn-link btn-sm p-0 font-sans" aria-expanded="true"><span class="prefix-toggle-text me-1">Close</span><svg class="prefix-icon prefix-icon-close" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M5 2 V8 M2 5 H8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></div></div>
                <div><button type="button" class="prefix-open prefix-toggle btn btn-link btn-sm p-0 font-sans" aria-expanded="false"><span class="prefix-toggle-text me-1">Show all prefixes</span><svg class="prefix-icon" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M5 2 V8 M2 5 H8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></div>
              </div>`
              : text}</li>
          </ul>
        </li>`;
    sources.push(SOURCES.phone(showPrefixes));
  }

  let html = townTemplate;
  if (pop && pop.source === "ugrcPop") {
    html = html.replace(/<li><strong>Population:<\/strong> \{Town Population\} <small[^\n]*<\/li>/,
      `<li><strong>Population:</strong> ${num(pop.count)} <small class="text-secondary font-sans"><em>(2010 est.)</em></small></li>`);
  }
  html = html
    // Founding and name origin lines; either one is left out when missing
    .replace(/\n\s*<p class="text-secondary mt-2 mb-2"><em>\(Settled in \{year\}\)<\/em><\/p>\s*<p class="lead">.*?<\/p>/,
      intro.length ? `\n  ${intro.join("\n  ")}` : "")
    .replace(/<li><strong>Area Code\{s\}:<\/strong> \{Town Area Code\}<\/li>\s*<li><strong>Phone Prefix\{es\}:<\/strong> \{Town Prefix\}<\/li>/,
      phoneItems || `<li>${NA}</li>`)
    .replace(/\s*<p>\s*<a href=""[^>]*>Post Office<\/a>\s*<\/p>/, (button) =>
      t.postOfficeUrl ? button.replace('<a href=""', `<a href="${t.postOfficeUrl}"`) : "")
    .replace("<li>{Source}</li>", sources.map((s) => `<li>${s}</li>`).join("\n    "));

  html = fill(html, {
    "{Town Name}": esc(t.name),
    "{County Name}": esc(t.county),
    "{Town Latitude}": t.lat.toFixed(4),
    "{Town Longitude}": t.lng.toFixed(4),
    // Map pin uses the full-precision coordinates
    "{Map Latitude}": String(t.lat),
    "{Map Longitude}": String(t.lng),
    "{Town Elevation}": t.elevationFt !== null ? `${num(t.elevationFt)} ft.` : NA,
    "{Town Population}": pop ? num(pop.count) : NA,
    "{Town Households}": pop && pop.households !== undefined ? num(pop.households) : NA,
    "{Town Hardiness}": t.hardinessZone || NA,
    "{Town Precip}": t.precipIn !== null ? `${t.precipIn.toFixed(1)} in.` : NA,
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

  // Leave out anything not available: drop its line, then the precipitation
  // note if there's no precipitation, then the whole Gardening Info section if empty.
  html = html.replace(new RegExp(`\\s*<li>[^\\n]*${NA}[^\\n]*</li>`, "g"), "");
  if (t.precipIn === null) html = html.replace(/\s*<p class="[^"]*">\s*<em>1991-2020 precipitation normals<\/em><\/p>/, "");
  html = html.replace(/\s*<section class="gardening[^"]*">\s*<h2[^>]*>Gardening Info<\/h2>\s*<ul class="list-unstyled mb-0">\s*<\/ul>\s*<\/section>/, "");

  const leftover = html.match(/\{(?!Ads? )[A-Z][^}{]*\}/g); // ad spots are filled in wrapPage
  if (leftover) console.warn(`  ${t.name}: unfilled ${[...new Set(leftover)].join(", ")}`);
  if (shared(t)) {
    html = html.replace(`<h1>${esc(t.name)}, Utah</h1>`, `<h1>${esc(t.name)} (${esc(t.county)}), Utah</h1>`);
  }
  // Title matches the heading: "Kanab, Utah | Community Profile | Site Name"
  const h1 = (html.match(/<h1>(.*?)<\/h1>/) || [])[1];
  // County seats: a small note after the name that starts with the
  // courthouse in a honeycomb, like "Kanab, Utah [courthouse] Kane County Seat"
  if (t.countySeat) {
    html = html.replace(`<h1>${h1}</h1>`,
      `<h1><span class="county-seat-name">${h1}</span><small class="county-seat-note font-sans fw-normal text-secondary">${SEAT_HEX}${esc(t.county)} County Seat</small></h1>`);
  }
  const place = shared(t) ? `${t.name} (${t.county}), Utah` : `${t.name}, Utah`;
  return wrapPage(html, `${h1} | Community Profile | ${esc(site.name)}`, link("../index.html"), "../", "shadow", true, {
    description: `Community profile for ${place}, in ${t.county} County. Location, population, postal, phone and gardening info.`,
    path: `communities/${fileName(t)}`,
    jsonLd: {
      "@type": "Place", name: place,
      address: { "@type": "PostalAddress", addressLocality: t.name, addressRegion: "UT", addressCountry: "US" },
      geo: { "@type": "GeoCoordinates", latitude: t.lat, longitude: t.lng },
      containedInPlace: { "@type": "AdministrativeArea", name: `${t.county} County, Utah` },
    },
  });
}

// --- Pick communities
let list = communities;
if (wanted.length) {
  const keys = wanted.map((w) => w.toLowerCase());
  list = communities.filter((t) => keys.includes(t.id.toLowerCase()) || keys.includes(t.name.toLowerCase()));
  const found = new Set(list.flatMap((t) => [t.id.toLowerCase(), t.name.toLowerCase()]));
  const missing = keys.filter((k) => !found.has(k));
  if (missing.length) console.warn(`Not found: ${missing.join(", ")}`);
}

// --- Static files: static/ (fonts, CSS) is copied into the output as is.
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) copyDir(path.join(from, e.name), path.join(to, e.name));
    else fs.writeFileSync(path.join(to, e.name), fs.readFileSync(path.join(from, e.name)));
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
const pages = communities.filter((t) => fs.existsSync(path.join(profileDir, fileName(t))))
  .sort((a, b) => a.name.localeCompare(b.name) || a.county.localeCompare(b.county));
const counties = [...new Set(pages.map((p) => p.county))].sort();
const countyLinks = counties.map((c) =>
  `        <li data-county="${esc(c)}"><a href="#community-profiles" class="link-dark">${esc(c)}</a></li>`).join("\n");
const items = pages.map((p) =>
  `      <li data-county="${esc(p.county)}" data-name="${esc(p.name.toLowerCase())}" hidden><a href="${link(`communities/${fileName(p)}`)}">${esc(p.name)}<span class="county-suffix"> (${esc(p.county)})</span></a>${p.countySeat ? COUNTY_SEAT : ""}</li>`).join("\n");
const indexHtml = fill(template("index.html"), {
  "{Home Photo Desktop}": homePhoto.desktop, "{Home Band Ads}": ADS.mode === "off" ? "" : " home-band-ads",
  // Ad-free, the content sits closer to the photo and the footer
  "{Home Top Ad}": ADS.mode === "off" ? "" : `<div class="container pt-4">${adSpot("home-top")}</div>`,
  "{Home Content Margin}": ADS.mode === "off" ? "mt-5 mb-4" : "my-5", // 48px gaps, like town pages
  "{Home Photo Mobile}": homePhoto.mobile,
  // The tagline's last word stays on the same line as the icon after it
  "{Tagline Start}": esc(site.tagline).replace(/\S+$/, ""),
  "{Tagline Last}": esc(site.tagline).match(/\S+$/)[0], "{County Links}": countyLinks, "{Profile Items}": items });
fs.writeFileSync(path.join(outDir, "index.html"),
  wrapPage(indexHtml, `${esc(site.name)} | ${esc(site.tagline)}`, link("index.html"), "", "shadow", true, {
    // share-home.jpg is a 1200 x 630 crop of the home photo; make a new one if "homePhoto" changes
    path: "", image: "images/share-home.jpg", imageAlt: homePhoto.alt,
    jsonLd: { "@type": "WebSite", name: site.name, description: SITE_DESCRIPTION, ...(site.url ? { url: `${site.url}/` } : {}) },
  }));

// --- About and Contact pages (templates/about.html, templates/contact.html)
fs.writeFileSync(path.join(outDir, "about.html"), wrapPage(
  fill(template("about.html"), { "{Site Name}": esc(site.name) }),
  `About | ${esc(site.name)}`, link("index.html"), "", "shadow", true, { path: "about.html", jsonLd: { "@type": "AboutPage", name: `About ${site.name}` } }));
fs.writeFileSync(path.join(outDir, "contact.html"), wrapPage(
  fill(template("contact.html"), { "{Site Name}": esc(site.name), "{Email User}": esc(site.email.split("@")[0]), "{Email Domain}": esc(site.email.split("@")[1]), "{Email Domain Spoken}": esc(site.email.split("@")[1].replace(/\./g, " dot ")), "{Social Handle}": esc(site.socialHandle),
    "{Social List}": site.social.map((s) => `    <li class="mb-2"><a href="${esc(s.url)}" class="social-row link-dark"><span class="social-circle social-hex">${socialIcon(s)}</span>${esc(s.name)}</a></li>`).join("\n") }),
  `Contact | ${esc(site.name)}`, link("index.html"), "", "shadow", true, {
    description: `Questions, comments or corrections? Contact ${site.name}.`, path: "contact.html", jsonLd: { "@type": "ContactPage", name: `Contact ${site.name}` } }));

// --- 404 page. Served at any missing address, so its links start at the site root.
fs.writeFileSync(path.join(outDir, "404.html"), wrapPage(
  fill(template("404.html"), { "{Community Profiles URL}": site.cleanLinks ? "/#community-profiles" : "/index.html#community-profiles" }),
  `Page not found | ${esc(site.name)}`, site.cleanLinks ? "/" : "/index.html", "/", "shadow", true, { noindex: true }));

// County outlines for the map page. Uses a UGRC county boundaries GeoJSON in
// sources/ugrc/county-boundaries/ if there is one (more detailed), otherwise
// the Census outlines in sources/census/county-boundaries/. Coordinates are
// rounded to keep the page small.
function countyOutlinesJson() {
  const dirs = [paths.source("ugrc", "county-boundaries"), paths.source("census", "county-boundaries")];
  const dir = dirs.find((d) => fs.existsSync(d) && fs.readdirSync(d).some((f) => /\.(geo)?json$/i.test(f)));
  if (!dir) { console.warn("  No county boundaries found; map counties have no outlines"); return "null"; }
  const file = fs.readdirSync(dir).find((f) => /\.(geo)?json$/i.test(f));
  const round = (c) => Array.isArray(c[0]) ? c.map(round) : [Math.round(c[0] * 1e4) / 1e4, Math.round(c[1] * 1e4) / 1e4];
  const out = {};
  for (const f of paths.readJson(path.join(dir, file)).features) {
    const name = String(f.properties.NAME || f.properties.Name || "").toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
    if (name) out[name] = { type: f.geometry.type, coordinates: round(f.geometry.coordinates) };
  }
  return JSON.stringify(out);
}

// Utah's outline for the map page: the union of the Census county outlines,
// in sources/census/state-boundary/ (made once from the county file)
function stateOutlineJson() {
  const dir = paths.source("census", "state-boundary");
  const file = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => /\.(geo)?json$/i.test(f));
  if (!file) return "null";
  const round = (c) => Array.isArray(c[0]) ? c.map(round) : [Math.round(c[0] * 1e4) / 1e4, Math.round(c[1] * 1e4) / 1e4];
  const g = paths.readJson(path.join(dir, file)).features[0].geometry;
  return JSON.stringify({ type: g.type, coordinates: round(g.coordinates) });
}

// --- Map page: every community on one full-screen map, with search
{
  const placesJson = JSON.stringify(communities.map((t) => [
    shared(t) ? `${t.name} (${t.county})` : t.name, t.county,
    Math.round(t.lat * 1e5) / 1e5, Math.round(t.lng * 1e5) / 1e5,
    link(`communities/${fileName(t)}`), t.countySeat ? 1 : 0,
  ])).replace(/</g, "\\u003c");
  fs.writeFileSync(path.join(outDir, "map.html"), wrapPage(
    // No footer here; the copyright sits in the map's panel instead
    fill(template("map.html"), { "{Map Places JSON}": placesJson, "{Seat Icon JSON}": JSON.stringify(COUNTY_SEAT), "{Town Popup JSON}": JSON.stringify(TOWN_POPUP).replace(/</g, "\\u003c"), "{County Outlines JSON}": countyOutlinesJson(), "{State Outline JSON}": stateOutlineJson(), "{Year}": now.getFullYear(), "{Site Name}": esc(site.name), "{About URL}": link("about.html") }),
    `Map of Utah Communities | ${esc(site.name)}`, link("index.html"), "", "shadow-none", false, // the search bar gets the shadow
    { description: "Search a map of towns and cities across Utah, with county lines and directions.", path: "map.html" }));
}

// --- XML sitemap: the homepage and every town page. URLs are relative until
// "url" is set in config/site.json; search engines expect full URLs.
const today = now.toISOString().slice(0, 10);
const urls = ["/", ...["map", "about", "contact"].map((n) => site.cleanLinks ? `/${n}` : `/${n}.html`), ...pages.map((p) => `/communities/${site.cleanLinks ? fileName(p).replace(/\.html$/, "") : fileName(p)}`)];
fs.writeFileSync(path.join(outDir, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${esc(site.url + u)}</loc>
    <lastmod>${today}</lastmod>
  </url>`).join("\n")}
</urlset>
`);
console.log(`Done! Wrote ${list.length} pages, an index of ${pages.length}, about, contact, 404.html and sitemap.xml to ${path.relative(paths.dirs.root, outDir) || "."}/`);
