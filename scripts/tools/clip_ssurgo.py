"""Clips the USDA gSSURGO Utah geodatabase to town boundaries.

Writes sources/usda/ssurgo/town_soils.json: for every Census place boundary
(cities, towns and census-designated places),
the soil components that fall inside it, with their acres in town and the
surface-horizon values 08c_soil.js needs (texture, pH, water capacity,
organic matter, salinity) and map unit limits (farmland class, bedrock and
water table depth, flooding). Everything outside the town
boundaries is left out, so the big geodatabase isn't needed after this runs.

Run by hand (not part of npm run build), from the website folder:
  pip install geopandas pyogrio
  python3 scripts/tools/clip_ssurgo.py ../downloads/gSSURGO_UT.gdb

Town boundaries: sources/census/place-boundaries/tl_*_49_place.zip (TIGER/Line places)
"""
import glob, json, os, sys
import geopandas as gpd
import pandas as pd
import pyogrio

root = os.path.join(os.path.dirname(__file__), "..", "..")
gdb = sys.argv[1]
place_file = sorted(glob.glob(os.path.join(root, "sources", "census", "place-boundaries", "tl_*_49_place.zip")))[-1]
out_dir = os.path.join(root, "sources", "usda", "ssurgo")
os.makedirs(out_dir, exist_ok=True)

ACRES_PER_M2 = 1 / 4046.8564224

# Town boundaries in the geodatabase's equal-area projection (EPSG:5070)
towns = gpd.read_file(place_file)
# PLACEFP is the census place code; PLACENS is the GNIS ID (leading zeros dropped)
towns = towns.assign(FIPS=towns.PLACEFP, GNIS=towns.PLACENS.str.lstrip("0"))
towns = towns[["NAME", "GNIS", "FIPS", "geometry"]].to_crs(5070)
towns["geometry"] = towns.geometry.make_valid()

# Map unit polygons that touch any town
polys = gpd.read_file(gdb, layer="MUPOLYGON", columns=["MUKEY"], bbox=tuple(towns.total_bounds))
polys = polys[polys.intersects(towns.union_all())]
polys["geometry"] = polys.geometry.make_valid()
pieces = gpd.overlay(towns, polys, how="intersection", keep_geom_type=True)
pieces["acres"] = pieces.geometry.area * ACRES_PER_M2
town_mu = pieces.groupby(["NAME", "GNIS", "FIPS", "MUKEY"], as_index=False)["acres"].sum()
town_area = (towns.assign(acres=towns.geometry.area * ACRES_PER_M2)
             .groupby(["NAME", "GNIS", "FIPS"])["acres"].sum())
print(f"{len(towns)} towns, {len(polys)} map unit polygons, {len(town_mu)} town/map unit pairs")

def table(name, cols):
    return pyogrio.read_dataframe(gdb, layer=name, columns=cols, read_geometry=False)

mukeys = set(town_mu.MUKEY)
mapunit = table("mapunit", ["mukey", "muname", "farmlndcl"])
# Map unit limits: shallowest bedrock and water table (cm), main flooding frequency
muagg = table("muaggatt", ["mukey", "brockdepmin", "wtdepannmin", "flodfreqdcd"])
mapunit = mapunit.merge(muagg, on="mukey", how="left")
comp = table("component", ["mukey", "cokey", "compname", "comppct_r", "compkind", "majcompflag",
                           "slope_l", "slope_r", "slope_h", "drainagecl", "geomdesc"])
comp = comp[comp.mukey.isin(mukeys)]
cokeys = set(comp.cokey)

# Main landform for each component, like "alluvial fan"
geo = table("cogeomordesc", ["cokey", "geomftname", "geomfname", "rvindicator"])
geo = geo[geo.cokey.isin(cokeys) & (geo.geomftname == "Landform")]
geo = geo.sort_values("rvindicator", ascending=False).drop_duplicates("cokey")
landform = dict(zip(geo.cokey, geo.geomfname))

# Surface horizon: the top mineral horizon with a pH and water capacity.
# Organic (O) horizons are leaf litter on top of the soil, so they're skipped.
hz = table("chorizon", ["cokey", "chkey", "hzname", "desgnmaster", "hzdept_r", "hzdepb_r",
                        "ph1to1h2o_l", "ph1to1h2o_r", "ph1to1h2o_h", "awc_r",
                        "om_r", "ec_r"])
hz = hz[hz.cokey.isin(cokeys) & hz.ph1to1h2o_r.notna() & hz.awc_r.notna()]
organic = (hz.desgnmaster == "O") | hz.hzname.fillna("").str.match(r"^\d*O")
hz = hz[~organic]
hz = hz.sort_values(["cokey", "hzdept_r"]).drop_duplicates("cokey")
tex = table("chtexturegrp", ["chkey", "texdesc", "rvindicator"])
tex = tex[tex.chkey.isin(set(hz.chkey))].sort_values("rvindicator", ascending=False).drop_duplicates("chkey")
hz = hz.merge(tex[["chkey", "texdesc"]], on="chkey", how="left")

comp = comp.merge(hz, on="cokey", how="left").merge(mapunit, on="mukey", how="left")

def val(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    return round(float(v), 3) if isinstance(v, float) else v

out = []
for (name, gnis, fips), group in town_mu.groupby(["NAME", "GNIS", "FIPS"]):
    comps = []
    for mu in group.itertuples():
        for c in comp[comp.mukey == mu.MUKEY].itertuples():
            comps.append({
                "mukey": mu.MUKEY, "muname": c.muname, "muAcres": round(mu.acres, 2),
                "cokey": c.cokey, "compname": c.compname, "compkind": c.compkind,
                "major": c.majcompflag == "Yes", "pct": val(c.comppct_r),
                "slope": [val(c.slope_l), val(c.slope_r), val(c.slope_h)],
                "drainage": c.drainagecl, "landform": landform.get(c.cokey) or None,
                "horizon": val(c.hzname), "depthCm": [val(c.hzdept_r), val(c.hzdepb_r)],
                "texture": val(c.texdesc),
                "ph": [val(c.ph1to1h2o_l), val(c.ph1to1h2o_r), val(c.ph1to1h2o_h)],
                "awc": val(c.awc_r),
                "om": val(c.om_r),  # organic matter, % by weight
                "ec": val(c.ec_r),  # salinity, dS/m
                "farmland": c.farmlndcl,
                "bedrockCm": val(c.brockdepmin),
                "waterTableCm": val(c.wtdepannmin),
                "flooding": c.flodfreqdcd,
            })
    out.append({"name": name, "gnis": gnis, "fips": fips,
                "townAcres": round(float(town_area[(name, gnis, fips)]), 1),
                "mappedAcres": round(group.acres.sum(), 1), "components": comps})

with open(os.path.join(out_dir, "town_soils.json"), "w") as f:
    json.dump(out, f, separators=(",", ":"))
print(f"Wrote {len(out)} towns to sources/usda/ssurgo/town_soils.json")
