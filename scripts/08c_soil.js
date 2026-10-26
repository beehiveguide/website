// Builds build/soil.json from USDA gSSURGO soils clipped to town boundaries.
// Reads sources/usda/ssurgo/town_soils.json (made by scripts/tools/clip_ssurgo.py)
// and build/communities.csv (run 02_communities.js first).
//
// Only places with a Census boundary (a polygon, not just a point) get
// soil data. Values cover arable terrain only: soil components whose
// representative slope is 0-8%. Each component counts by its acres in town
// (map unit acres x component percent). Topsoil is the top horizon with a pH
// and water capacity.
//
// Output: { "<Gaz ID>": { textures: [{ texture, pct, landform }], phAvg, phMin, phMax,
//   drainage, awcAvg, awcDesc, awcVariation: { awc, landform } | null } }
const fs = require("fs");
const paths = require("./lib/paths");
const { nameKey } = require("./lib/communities");
const { phLevel, awcWord, awcDesc } = require("./lib/soil_words");

const MAX_SLOPE = 8; // percent; "arable terrain"
const MIN_ARABLE_ACRES = 10; // towns with less arable land get no soil text
const MIN_SHARE = 0.01; // components under 1% of arable acres (edge slivers) are left out
const TEXTURE_SHARE = 0.1; // textures listed: 10% of arable acres or more, up to 3
const MAX_TEXTURES = 3;
const LANDFORM_SHARE = 0.05; // a landform must cover 5% of arable acres to be named
const TEXTURE_LANDFORM_SHARE = 0.5; // a texture names its main landform when half its acres are on it
const MAIN_FORM_SHARE = 0.6; // place notes only when one landform holds 60% of arable acres
const AWC_DIFF = 0.05;
const OUTLIER_SHARE = 0.25; // pH extremes are noted when they cover under 25% of arable acres // in./in. from the town average to count as a drop or spike

const towns = paths.readJson(paths.source("usda", "ssurgo", "town_soils.json"));

// Plain words for landforms ("fan remnants" -> "on foothill slopes")
const { landforms: LANDFORM_WORDS } = paths.readJson(paths.config("landform_words.json"));
const unlisted = new Set();
function plainLandform(form) {
  if (!form) return null;
  const f = form.toLowerCase();
  if (LANDFORM_WORDS[f]) return LANDFORM_WORDS[f];
  unlisted.add(f);
  return `on ${f}`;
}

// Communities, to match each town boundary by census code, GNIS ID, then name
const lines = fs.readFileSync(paths.build("communities.csv"), "utf8").trim().split(/\r?\n/);
const h = lines[0].split(",");
const rows = lines.slice(1).map((l) => {
  const c = l.split(",");
  return { id: c[h.indexOf("Gaz ID")], name: c[h.indexOf("Feature Name")], code: c[h.indexOf("Census Code")] };
});
const key = (n) => nameKey(n.replace(/ City$/i, ""));
function findId(town) {
  const byCode = town.fips && rows.find((r) => r.code === town.fips);
  if (byCode) return byCode.id;
  const byId = rows.find((r) => r.id === town.gnis);
  if (byId) return byId.id;
  const byName = rows.filter((r) => key(r.name) === key(town.name));
  return byName.length === 1 ? byName[0].id : null;
}

// Weighted average of one value over a list of { acres, ... }
const wavg = (list, get) =>
  list.reduce((s, c) => s + get(c) * c.acres, 0) / list.reduce((s, c) => s + c.acres, 0);
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

const output = {};
const skipped = [];
for (const town of towns) {
  const id = findId(town);
  if (!id) { skipped.push(`${town.name} (no community)`); continue; }

  let arable = town.components
    .filter((c) => c.slope[1] !== null && c.slope[1] <= MAX_SLOPE)
    .filter((c) => c.ph[1] !== null && c.awc !== null && c.texture)
    .map((c) => ({ ...c, landform: plainLandform(c.landform), acres: (c.muAcres * c.pct) / 100 }));
  // Same component can show up once per map unit piece; already summed by map unit
  const total0 = arable.reduce((s, c) => s + c.acres, 0);
  arable = arable.filter((c) => c.acres >= total0 * MIN_SHARE);
  const total = arable.reduce((s, c) => s + c.acres, 0);
  if (total < MIN_ARABLE_ACRES) { skipped.push(`${town.name} (${total.toFixed(0)} arable acres)`); continue; }

  // Share of arable acres by some grouping, largest first
  const shares = (get) => {
    const g = {};
    for (const c of arable) { const k = get(c); if (k) g[k] = (g[k] || []).concat(c); }
    return Object.entries(g)
      .map(([k, list]) => ({ k, list, share: list.reduce((s, c) => s + c.acres, 0) / total }))
      .sort((a, b) => b.share - a.share);
  };

  // The town's main landform. Textures mostly on it get no place note, and
  // with no clear main landform (an even split), no texture gets one.
  const topForm = shares((c) => c.landform)[0];
  const mainForm = topForm && topForm.share >= MAIN_FORM_SHARE ? topForm.k : null;
  // Where the arable land lies, for the opening: the main landform, or the
  // top two when together they hold 60% (each 20% or more); else none.
  // Outlier notes only point to landforms other than these.
  const allForms = shares((c) => c.landform);
  const homeForms = mainForm
    ? [mainForm]
    : allForms.length >= 2 && allForms[1].share >= 0.2 && allForms[0].share + allForms[1].share >= MAIN_FORM_SHARE
      ? [allForms[0].k, allForms[1].k]
      : [];
  const tex = shares((c) => c.texture.toLowerCase());
  const textures = tex
    .filter((t, i) => i === 0 || t.share >= TEXTURE_SHARE)
    .slice(0, MAX_TEXTURES)
    .map((t) => {
      // Main landform for this texture, like "stream terraces"
      const acres = t.list.reduce((s, c) => s + c.acres, 0);
      const forms = {};
      for (const c of t.list) if (c.landform) forms[c.landform] = (forms[c.landform] || 0) + c.acres;
      const [form, formAcres] = Object.entries(forms).sort((a, b) => b[1] - a[1])[0] || [];
      // Only outliers get a place: textures mostly on some other landform
      const landform = homeForms.length && form && !homeForms.includes(form) && formAcres / acres >= TEXTURE_LANDFORM_SHARE ? form : null;
      return { texture: t.k, pct: Math.round(t.share * 100), landform };
    });

  const drainage = shares((c) => c.drainage)[0];
  const awcAvg = wavg(arable, (c) => c.awc);
  const phAvg = wavg(arable, (c) => c.ph[1]);
  const phMin = Math.min(...arable.map((c) => c.ph[0] ?? c.ph[1]));
  const phMax = Math.max(...arable.map((c) => c.ph[2] ?? c.ph[1]));
  // Landforms that can hold an outlier: any but the home ones. With no clear
  // home landforms, nothing is an outlier, so no place notes at all.
  const landforms = homeForms.length ? allForms.filter((l) => !homeForms.includes(l.k)) : [];

  // Where a pH extreme is, when it's an outlier: a small share of the land,
  // a different pH level from the average, and mostly on one landform
  // other than the main one
  const phWhere = (ph, end) => {
    if (!homeForms.length || phLevel(ph) === phLevel(phAvg)) return null;
    const list = arable.filter((c) => (end === 0 ? c.ph[0] ?? c.ph[1] : c.ph[2] ?? c.ph[1]) === ph);
    const acres = list.reduce((s, c) => s + c.acres, 0);
    if (acres / total >= OUTLIER_SHARE) return null;
    const forms = {};
    for (const c of list) if (c.landform) forms[c.landform] = (forms[c.landform] || 0) + c.acres;
    const [form, formAcres] = Object.entries(forms).sort((a, b) => b[1] - a[1])[0] || [];
    return form && !homeForms.includes(form) && formAcres / acres >= TEXTURE_LANDFORM_SHARE ? form : null;
  };

  // A landform (5% of arable acres or more, not the main one) that's mostly a
  // different drainage class; the largest one is noted
  let drainageVariation = null;
  for (const l of landforms) {
    if (l.share < LANDFORM_SHARE) continue;
    const g = {};
    for (const c of l.list) if (c.drainage) g[c.drainage] = (g[c.drainage] || 0) + c.acres;
    const [cls, clsAcres] = Object.entries(g).sort((a, b) => b[1] - a[1])[0] || [];
    const acres = l.list.reduce((s, c) => s + c.acres, 0);
    if (cls && drainage && cls !== drainage.k && clsAcres / acres >= TEXTURE_LANDFORM_SHARE) {
      drainageVariation = { drainage: cls.toLowerCase(), landform: l.k };
      break; // landforms are largest first
    }
  }

  // Largest drop or spike in water capacity on one landform (not the main
  // one), when it's a different class from the average
  let awcVariation = null;
  for (const l of landforms) {
    if (l.share < LANDFORM_SHARE) continue;
    const awc = wavg(l.list, (c) => c.awc);
    if (Math.abs(awc - awcAvg) >= AWC_DIFF && awcWord(awc) !== awcWord(awcAvg) &&
        (!awcVariation || Math.abs(awc - awcAvg) > Math.abs(awcVariation.awc - awcAvg)))
      awcVariation = { awc: round(awc, 2), landform: l.k };
  }

  output[id] = {
    town: town.name,
    arableAcres: Math.round(total),
    // Share of the town mapped as urban land (built over, no soil data)
    urbanPct: Math.round(
      (100 * town.components
        .filter((c) => /urban land/i.test(c.compname || ""))
        .reduce((s, c) => s + (c.muAcres * (c.pct || 0)) / 100, 0)) / town.mappedAcres),
    mainLandform: mainForm, // "on foothill slopes", or null with no clear main landform
    arableForms: homeForms,
    textures,
    phAvg: round(phAvg, 1),
    phMin,
    phMax,
    // The end with more land behind it is named first on the page
    phHighFirst:
      arable.filter((c) => (c.ph[2] ?? c.ph[1]) === phMax).reduce((s, c) => s + c.acres, 0) >
      arable.filter((c) => (c.ph[0] ?? c.ph[1]) === phMin).reduce((s, c) => s + c.acres, 0),
    // Both ends in the same place isn't telling, so neither is noted
    ...(() => {
      const lo = phWhere(phMin, 0), hi = phWhere(phMax, 2);
      return lo && lo === hi ? { phMinWhere: null, phMaxWhere: null } : { phMinWhere: lo, phMaxWhere: hi };
    })(),
    drainage: drainage ? drainage.k.toLowerCase() : "",
    drainageVariation,
    awcAvg: round(awcAvg, 2),
    awcDesc: awcDesc(awcAvg),
    awcVariation,
  };
}

paths.writeJson(paths.build("soil.json"), output);
if (unlisted.size) console.warn(`  Landforms not in config/landform_words.json: ${[...unlisted].join(", ")}`);
if (skipped.length) console.log(`  No soil text: ${skipped.join(", ")}`);
console.log(`Done! Wrote soil data for ${Object.keys(output).length} of ${towns.length} town boundaries to build/soil.json`);
