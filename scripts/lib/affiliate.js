// Affiliate ads: Bookshop.org books, Awin pictures and text links, and the
// "Follow" banners for Beehive Guide's own channels.
// The page only holds empty containers (data-ad="follow", "row", "side",
// "text", made by 10_pages.js). static/js/ads.js fills them in the visitor's
// browser by rotating through the lists below, one step per page view, so a
// spot doesn't show the same ad twice in a row. This file builds the lists
// (public/js/ads-data.js) from config/bookshop.json, config/awin.json and
// config/site.json. Bookshop and Awin ads (third-party, with tracking links)
// are included only in a live build, node scripts/10_pages.js --live-ads,
// which "npm run deploy" adds. A plain "npm run pages" shows gray labeled
// blocks instead, so local pages never carry tracking links.
const fs = require("fs");
const path = require("path");
const paths = require("./paths");

const read = (f) => {
  try {
    return paths.readJson(paths.config(f));
  } catch {
    return null;
  }
};
const tpl = (f) => {
  try {
    return fs.readFileSync(path.join(paths.dirs.templates, f), "utf8").trim();
  } catch {
    return "";
  }
};

function buildData(site, live) {
  const a = site.affiliate || {};
  const bookshop = read("bookshop.json") || { books: [] };
  const awin = read("awin.json") || { images: [], text: [] };
  const every = (share, fallback) =>
    Math.max(1, Math.round(1 / (share || fallback)));
  const logo = tpl("parts/icons/logo.svg")
    .replace(/<title[\s\S]*?<\/title>/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(' role="img" aria-labelledby="t"', ' aria-hidden="true"');
  // Dropped from the build: past an "ends" date (YYYY-MM-DD), disabled, or found
  // broken by scripts/check-ads.js (config/ads-broken.json). static/js/ads.js
  // also checks "ends" in the browser, so a promo stops on its date without a deploy.
  const broken = read("ads-broken.json") || {};
  const today = new Date().toISOString().slice(0, 10);
  const alive = (x) => !x.disabled && (!x.ends || x.ends >= today);
  const bad = (url) => (broken.urls || []).includes(url);
  const off = awin.disabledBrands || [];
  awin.images = awin.images.filter((i) => alive(i) && !off.includes(i.brand) && !bad(i.src));
  awin.text = awin.text.filter((t) => alive(t) && !off.includes(t.brand) && !bad(t.href));
  bookshop.books = bookshop.books.filter((b) => alive(b) && !(broken.books || []).includes(b.isbn));
  const copy = awin.brandCopy || {};
  const bt = awin.brandTopics || {};
  const withCopy = (i) => ({ topics: bt[i.brand] || [], ...(i.bare ? {} : copy[i.brand]), ...i });
  const data = {
    live,
    // One page view in N shows each of these
    followEvery: every(a.followShare, 0.2),
    bookshopEvery: every(a.bookshopShare, 0.35),
    textEvery: awin.textPageShare === 0 ? 0 : every(awin.textPageShare, 0.15),
    // Follow channels by weight, like { Instagram: 5, YouTube: 3, Threads: 1 }
    followWeights: a.followWeights || {},
    social: (site.social || []).map((s) => ({
      name: s.name,
      url: s.url,
      icon: tpl(`parts/icons/${s.name.toLowerCase()}.svg`),
    })),
    handle: site.socialHandle || "",
    logo,
  };
  // The shop banner comes up in the same rotation as the Follow banners,
  // weighted by followWeights.Bookshop (0 or missing leaves it out)
  if ((a.followWeights || {}).Bookshop > 0 && a.shopUrl) {
    data.social.push({
      name: "Bookshop",
      shop: true,
      url: a.shopUrl,
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8h12l2 13H4z"/><path d="M9 11V6.5a3 3 0 0 1 6 0V11"/></svg>',
    });
  }
  if (live) {
    data.affiliateId = bookshop.affiliateId;
    data.books = bookshop.books
      .filter((b) => !b.disabled)
      .map((b) => ({ isbn: b.isbn, featuredOnly: Boolean(b.featuredOnly), topics: b.topics || [], ends: b.ends }));
    data.banners = awin.images
      .filter((i) => i.shape === "banner")
      .map(withCopy).map(({ brand, href, src, logoSrc, logoWidth, logoHeight, alt, title, text, flip, width, height, topics, ends }) => ({ brand, href, src, logoSrc, logoWidth, logoHeight, alt, title, text, flip, width, height, topics }));
    data.tall = awin.images
      .filter((i) => i.shape === "tall" || i.shape === "side")
      .map(withCopy).map(({ brand, href, src, alt, title, blurb, cta, native, width, height, topics, ends }) => ({ brand, href, src, alt, title, blurb, cta, native, width, height, topics, ends }));
    data.images = awin.images
      .filter((i) => i.shape === "box")
      .map(withCopy)
      .map(({ brand, href, src, alt, title, blurb, cta, logo, logoWidth, pad, width, height, topics, ends }) => ({
        brand, href, src, alt, title, blurb, cta, logo, logoWidth, pad, width, height, topics, ends,
      }));
    data.text = awin.text.map(({ brand, label, href, ends }) => ({ brand, label, href, ends, topics: bt[brand] || [] }));
    // Brands that have pictures get their text links less often
    data.picBrands = [...new Set(awin.images.map((i) => i.brand))];
  } else {
    // Local build: placeholders only, labeled by brand
    data.books = bookshop.books.filter((b) => !b.disabled).map((b) => ({ isbn: b.isbn, featuredOnly: Boolean(b.featuredOnly) }));
    data.images = awin.images.filter((i) => i.shape === "box").map(({ brand }) => ({ brand }));
    data.banners = awin.images.filter((i) => i.shape === "banner").map(({ brand }) => ({ brand }));
    data.tall = awin.images.filter((i) => i.shape === "tall" || i.shape === "side").map(({ brand }) => ({ brand }));
    data.text = awin.text.map(({ brand, label }) => ({ brand, label }));
    data.picBrands = [...new Set(awin.images.map((i) => i.brand))];
  }
  return data;
}

module.exports = { buildData };
