// Builds build/soil.json from USDA gSSURGO soils clipped to town boundaries.
// Reads sources/usda/ssurgo/town_soils.json (made by scripts/tools/clip_ssurgo.py)
// and build/communities.csv (run 02_communities.js first).
//
// Only places with a Census boundary (a polygon, not just a point) get
// soil data. Values cover arable terrain only: soil components whose
// representative slope is 0-8%, that aren't on landforms nobody gardens
// (mesas, plateaus, ridges, sand dunes, beaches, washes, mountain slopes, hillsides, hills), and whose map
// unit isn't named for slopes steeper than 15% ("1 to 35 percent slopes").
// Each component counts by its acres in town
// (map unit acres x component percent). Topsoil is the top horizon with a pH
// and water capacity. Farmland ratings are the exception: shares of all the
// town's mapped acres.
//
// Output: { "<Gaz ID>": { textures: [{ texture, pct, landform }], phAvg, phMin, phMax,
//   drainage, awcAvg, awcDesc, awcVariation: { awc, landform } | null } }
const fs = require("fs");
const paths = require("./lib/paths");
const { nameKey } = require("./lib/communities");
const { phLevel, awcWord, awcDesc, saltLevel } = require("./lib/soil_words");

const MAX_SLOPE = 8; // percent; "arable terrain"
// Landforms left out of arable terrain, however flat their tops are
const NON_GARDEN_LANDFORMS = new Set(["mesas", "plateaus", "ridges", "cuestas", "dunes", "interdunes", "beaches", "washes", "channels", "drainageways", "fanhead trenches"]);
// Steep landforms (plain words from config/landform_words.json). Some of their
// components are gentle (1-10%) inside map units named for much steeper slopes
const FLAT_TOPS = new Set(["mesas", "plateaus"]); // left out of the paragraph unless the town is built on them
const STEEP_LANDFORMS = new Set(["on mountain slopes", "on hillsides", "on hills"]);
const MAX_UNIT_SLOPE = 15; // percent; map units named "X to Y percent slopes" with Y over this are left out
const unitMaxSlope = (name) => { const m = /(\d+)\s+to\s+(\d+)\s+percent/i.exec(name || ""); return m ? Number(m[2]) : null; };
const MIN_ARABLE_ACRES = 10; // towns with less arable land get no soil text
const MIN_SHARE = 0.01; // components under 1% of arable acres (edge slivers) are left out
const TEXTURE_SHARE = 0.1; // textures listed: 10% of arable acres or more
const TEXTURE_COVERAGE = 0.85; // ...largest first, stopping once the list covers this share
const HAZARD_FORM_SHARE = 0.5; // flooding, water table or bedrock names a landform only when most (half) of that landform has it
const COARSE_SHARE = 0.4; // sandy, gravelly or stony is named as the reason for fast drainage when 40% of acres are
const LANDFORM_SHARE = 0.05; // a landform must cover 5% of arable acres to be named
const TEXTURE_LANDFORM_SHARE = 0.5; // a texture names its main landform when half its acres are on it
const MAIN_FORM_SHARE = 0.6; // place notes only when one landform holds 60% of arable acres
const AWC_DIFF = 0.05;
const LIMIT_SHARE = 0.1; // shallow bedrock or a high water table is noted on 10% of arable acres or more
const FLOOD_SHARE = 0.05; // occasional or more frequent flooding is noted on 5% or more
const BEDROCK_CM = 51; // 20 inches
const WATER_TABLE_CM = 61; // 2 feet
const OUTLIER_SHARE = 0.25; // pH extremes are noted when they cover under 25% of arable acres // in./in. from the town average to count as a drop or spike

const towns = paths.readJson(paths.source("usda", "ssurgo", "town_soils.json"));

// Plain words for landforms ("fan remnants" -> "on foothill slopes")
const { landforms: LANDFORM_WORDS, byParentMaterial: BY_MATERIAL } = paths.readJson(paths.config("landform_words.json")); // eslint-disable-line
const BY_TOWN = paths.readJson(paths.config("landform_words.json")).byTown || {};
const unlisted = new Set();
// A vague landform ("terraces") gets a specific phrase from what the soil formed
// from ("Lacustrine deposits" -> "on ancient lakeshore benches"), when listed
function plainLandform(form, material, flooding, town) {
  if (!form) return null;
  const f = form.toLowerCase();
  if (BY_TOWN[town] && BY_TOWN[town][f]) return BY_TOWN[town][f];
  // Terraces that flood, with no recorded material, sit beside a stream (a lake never floods them)
  if (f === "terraces" && !material && flooding && flooding !== "None") return "on flat land beside streams";
  if (BY_MATERIAL[f] && BY_MATERIAL[f][material]) return BY_MATERIAL[f][material];
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

  // Components with soil data, whatever the slope: the base for how much of
  // the town's mapped soil counts as arable
  const withData = town.components.filter((c) => c.slope[1] !== null && c.ph[1] !== null && c.awc !== null && c.texture);
  const dataAcres = withData.reduce((s, c) => s + (c.muAcres * c.pct) / 100, 0);
  // Mesas and plateaus count when the town is built on them: when they are half
  // or more of its gentle land, or the town is listed in config byTown
  // (includeLandforms) after checking where it sits
  const gentle = withData.filter((c) => c.slope[1] <= MAX_SLOPE);
  const gentleAcres = gentle.reduce((t, c) => t + (c.muAcres * c.pct) / 100, 0);
  const flatTopAcres = gentle.filter((c) => FLAT_TOPS.has((c.landform || "").toLowerCase())).reduce((t, c) => t + (c.muAcres * c.pct) / 100, 0);
  const nonGarden = new Set(NON_GARDEN_LANDFORMS);
  const includeForms = (BY_TOWN[town.name] && BY_TOWN[town.name].includeLandforms) || (gentleAcres && flatTopAcres / gentleAcres >= 0.5 ? [...FLAT_TOPS] : []);
  for (const f of includeForms) nonGarden.delete(f);
  let arable = withData
    .filter((c) => c.slope[1] <= MAX_SLOPE)
    .filter((c) => !nonGarden.has((c.landform || "").toLowerCase()))
    .map((c) => ({ ...c, landform: plainLandform(c.landform, c.parentMaterial, c.flooding, town.name), acres: (c.muAcres * c.pct) / 100 }))
    .filter((c) => !STEEP_LANDFORMS.has(c.landform))
    .filter((c) => { const m = unitMaxSlope(c.muname); return m === null || m <= MAX_UNIT_SLOPE; });
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
  let covered = 0;
  const textures = tex
    .filter((t, i) => i === 0 || t.share >= TEXTURE_SHARE)
    .filter((t) => { const keep = covered < TEXTURE_COVERAGE; covered += t.share; return keep; })
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

  // Salinity and organic matter (topsoil, area-weighted)
  const withEc = arable.filter((c) => c.ec !== null);
  const ecAvg = withEc.length ? wavg(withEc, (c) => c.ec) : null;
  let saltVariation = null;
  if (ecAvg !== null)
    for (const l of landforms) {
      if (l.share < LANDFORM_SHARE) continue;
      const list = l.list.filter((c) => c.ec !== null);
      if (!list.length) continue;
      const ec = wavg(list, (c) => c.ec);
      if (ec > ecAvg && saltLevel(ec) !== saltLevel(ecAvg) &&
          (!saltVariation || ec > saltVariation.ec))
        saltVariation = { ec: round(ec, 1), level: saltLevel(ec), landform: l.k };
    }
  const withOm = arable.filter((c) => c.om !== null);
  const omAvg = withOm.length ? round(wavg(withOm, (c) => c.om), 1) : null;

  // Share of arable acres matching a test, and the landform most of it is on
  // (when half or more is on one)
  const part = (test) => {
    const list = arable.filter(test);
    const acres = list.reduce((s, c) => s + c.acres, 0);
    const forms = {};
    for (const c of list) if (c.landform) forms[c.landform] = (forms[c.landform] || 0) + c.acres;
    const [form, formAcres] = Object.entries(forms).sort((a, b) => b[1] - a[1])[0] || [];
    // The landform is named only when most of the hazard is on it AND the
    // hazard is on most of that landform ("Foothill slopes flood" would be
    // wrong when only part of them do)
    const formTotal = form ? arable.filter((c) => c.landform === form).reduce((t, c) => t + c.acres, 0) : 0;
    const named = form && formAcres / acres >= 0.5 && formAcres / formTotal >= HAZARD_FORM_SHARE;
    return { pct: Math.round((100 * acres) / total), landform: named ? form : null };
  };
  // Farmland ratings are shares of the whole town (all mapped acres, whatever
  // the slope), not of the arable land the other numbers use
  const farmShare = (re) =>
    Math.round(
      (100 * town.components
        .filter((c) => re.test(c.farmland || ""))
        .reduce((s, c) => s + (c.muAcres * (c.pct || 0)) / 100, 0)) / town.mappedAcres);
  const farmland = {
    prime: farmShare(/^(prime|all areas are prime)/i),
    primeIfIrrigated: farmShare(/^prime farmland if irrigated/i),
    statewide: farmShare(/^farmland of statewide/i),
  };
  const keep = (p, min) => (p.pct >= min * 100 ? p : null);
  const bedrock = keep(part((c) => c.bedrockCm !== null && c.bedrockCm < BEDROCK_CM), LIMIT_SHARE);
  const hardpan = keep(part((c) => c.hardpanCm !== null && c.hardpanCm !== undefined && c.hardpanCm < BEDROCK_CM), LIMIT_SHARE);
  const claypan = keep(part((c) => c.claypanCm !== null && c.claypanCm !== undefined && c.claypanCm < BEDROCK_CM), LIMIT_SHARE);
  const waterTable = keep(part((c) => c.waterTableCm !== null && c.waterTableCm < WATER_TABLE_CM), LIMIT_SHARE);
  const floodTest = (c) => /^(occasional|frequent|very frequent)$/i.test(c.flooding || "");
  const flooding = keep(part(floodTest), FLOOD_SHARE);
  // How often: the class covering the most flooded acres
  if (flooding) {
    const g = {};
    for (const c of arable.filter(floodTest)) g[c.flooding.toLowerCase()] = (g[c.flooding.toLowerCase()] || 0) + c.acres;
    flooding.level = Object.entries(g).sort((x, y) => y[1] - x[1])[0][0];
  }

  // Why soil drains fast or holds little water: sandy, gravelly or stony soil
  // (each when 40% or more of the acres are that way)
  const coarseWords = (list) => {
    const sum = (re, not) => list.filter((c) => re.test(c.texture) && !(not && not.test(c.texture))).reduce((t, c) => t + c.acres, 0);
    const all = list.reduce((t, c) => t + c.acres, 0);
    if (!all) return null;
    const words = [];
    if (sum(/sand/i, /sandy clay/i) / all >= COARSE_SHARE) words.push("sandy");
    if (sum(/gravelly|channery/i) / all >= COARSE_SHARE) words.push("gravelly");
    if (sum(/stony|cobbly|bouldery/i) / all >= COARSE_SHARE) words.push("stony");
    return words.length ? words.join(" and ") : null;
  };
  const coarseByForm = {};
  for (const l of allForms) { const w = coarseWords(l.list); if (w) coarseByForm[l.k] = w; }

  output[id] = {
    town: town.name,
    arableAcres: Math.round(total),
    // Share of the town's soil with data that counts as arable (the page says
    // "on slopes most suitable for cultivation" only when this is low)
    arableShare: dataAcres ? round(total / dataAcres, 2) : 1,
    // Share of the town mapped as urban land (built over, no soil data)
    urbanPct: Math.round(
      (100 * town.components
        .filter((c) => /urban land/i.test(c.compname || ""))
        .reduce((s, c) => s + (c.muAcres * (c.pct || 0)) / 100, 0)) / town.mappedAcres),
    mainLandform: mainForm, // "on foothill slopes", or null with no clear main landform
    arableForms: homeForms,
    coarseAll: coarseWords(arable), // "sandy and gravelly", or null
    coarseByForm, // the same for each landform
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
    ecAvg, // not rounded: 3.96 must stay "very slightly saline", not round up to 4.0
    saltVariation,
    omAvg,
    farmland,
    hardpan, // { pct, landform } with a cemented layer (caliche, duripan) within 20 in., or null
    claypan, // { pct, landform } with a dense sodium clay layer within 20 in., or null
    bedrock, // { pct, landform } with bedrock within 20 in., or null
    waterTable, // { pct, landform } with a water table within 2 ft., or null
    flooding, // { pct, landform, level } flooding occasionally or more often, or null
  };
}

paths.writeJson(paths.build("soil.json"), output);
if (unlisted.size) console.warn(`  Landforms not in config/landform_words.json: ${[...unlisted].join(", ")}`);
if (skipped.length) console.log(`  No soil text: ${skipped.join(", ")}`);
console.log(`Done! Wrote soil data for ${Object.keys(output).length} of ${towns.length} town boundaries to build/soil.json`);
