// Words for soil values, shared by 08c_soil.js and 10_pages.js.

// USDA NRCS soil reaction classes (Soil Survey Manual), by highest pH in each
const PH_LEVELS = [
  [3.4, "ultra acid"],
  [4.4, "extremely acid"],
  [5.0, "very strongly acid"],
  [5.5, "strongly acid"],
  [6.0, "moderately acid"],
  [6.5, "slightly acid"],
  [7.3, "neutral"],
  [7.8, "slightly alkaline"],
  [8.4, "moderately alkaline"],
  [9.0, "strongly alkaline"],
  [Infinity, "very strongly alkaline"],
];
const phLevel = (ph) => PH_LEVELS.find(([max]) => ph <= max)[1];

// Available water capacity classes, in inches of water per inch of soil.
// The common soil-judging classes for a 60-inch profile (very low under 3 in.,
// low 3-6, moderate 6-9, high 9-12, very high over 12), divided by 60.
const awcWord = (a) =>
  a < 0.05 ? "very low" : a < 0.1 ? "low" : a < 0.15 ? "moderate" : a < 0.2 ? "high" : "very high";
const awcDesc = (a) => `${awcWord(a)} ${a < 0.15 ? "water retention" : "water capacity"}`;

// NRCS salinity classes, by electrical conductivity (dS/m)
const saltLevel = (ec) =>
  ec < 2 ? "nonsaline" : ec < 4 ? "very slightly saline" : ec < 8 ? "slightly saline" : ec < 16 ? "moderately saline" : "strongly saline";

// Organic matter classes (% by weight), as used in USDA county soil survey reports
const omLevel = (om) =>
  om < 0.5 ? "very low" : om < 1 ? "low" : om < 2 ? "moderately low" : om < 4 ? "moderate" : om < 8 ? "high" : "very high";

module.exports = { phLevel, awcWord, awcDesc, saltLevel, omLevel };
