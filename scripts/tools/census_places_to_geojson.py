#!/usr/bin/env python3
"""Turns the Census TIGER/Line Utah places shapefile into a small GeoJSON.

Reads:  sources/census/place-boundaries/tl_*_49_place.zip
Writes: sources/census/place-boundaries/places.geojson
        (cities, towns and CDPs; properties PLACEFP, NAME, CLASSFP)

10_pages.js uses it for the town map zoom and outline of places UGRC's
municipal boundaries don't cover (CDPs and other unincorporated places).
Run once after downloading a new TIGER file:
  pip install pyshp
  python3 scripts/tools/census_places_to_geojson.py
"""
import glob, io, json, os, zipfile
import shapefile

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
folder = os.path.join(root, "sources", "census", "place-boundaries")
src = sorted(glob.glob(os.path.join(folder, "tl_*_49_place.zip")))[-1]
z = zipfile.ZipFile(src)
member = lambda ext: io.BytesIO(z.read([n for n in z.namelist() if n.endswith(ext)][0]))
r = shapefile.Reader(shp=member(".shp"), dbf=member(".dbf"), shx=member(".shx"))

features = []
for rec, shp in zip(r.records(), r.shapes()):
    d = rec.as_dict()
    parts = list(shp.parts) + [len(shp.points)]
    rings = [[[round(x, 5), round(y, 5)] for x, y in shp.points[parts[i]:parts[i + 1]]]
             for i in range(len(shp.parts))]
    # Each ring becomes its own polygon (TIGER holes are rare for places)
    features.append({
        "type": "Feature",
        "properties": {"PLACEFP": d["PLACEFP"], "NAME": d["NAME"], "CLASSFP": d["CLASSFP"]},
        "geometry": {"type": "MultiPolygon", "coordinates": [[ring] for ring in rings]},
    })

out = os.path.join(folder, "places.geojson")
with open(out, "w") as f:
    json.dump({"type": "FeatureCollection", "features": features}, f, separators=(",", ":"))
print(f"{len(features)} places -> {out} ({os.path.getsize(out) / 1e6:.1f} MB)")
