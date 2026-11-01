// Fingerprint of a town page's readable content, for its "Updated" date.
// Counts the words and link targets only, so these don't count as updates:
// markup and class changes, scripts and styles, ads, the date itself, and
// links with or without ".html" (npm run deploy uses clean links).
const crypto = require("crypto");

const DATE_MARK = "@@PAGE_UPDATED@@";

function pageText(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\{Ads? [^}]*\}/g, " ")
    .replace(DATE_MARK, "@@")
    .replace(/Updated\s+[A-Z][a-z]+\.? \d{1,2}, \d{4}\./, "Updated @@.")
    // keep where each link goes, without ".html" or "index.html"
    .replace(/<a\b[^>]*?\bhref="([^"]*)"[^>]*>/gi, (m, href) =>
      ` [${href
        .replace(/index\.html(?=[#?]|$)/, "")
        .replace(/\.html(?=[#?]|$)/, "")
        .replace(/^\.\/$/, "")}] `,
    )
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const fingerprint = (html) =>
  crypto.createHash("sha256").update(pageText(html)).digest("hex").slice(0, 16);

module.exports = { DATE_MARK, pageText, fingerprint };
