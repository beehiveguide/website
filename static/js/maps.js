// Town marker: a small hexagon with rounded corners, point up like the
// logo's. Drawn on the canvas, so maps using it need a canvas renderer.
// Sized to cover about the same area as a circle of the same radius; taps
// still use the circle around it.
window.BeehiveHexMarker = L.CircleMarker.extend({
  _updatePath() {
    const r = this._renderer;
    if (!r._drawing || this._empty()) return;
    const ctx = r._ctx, p = this._point, R = this._radius * 1.12;
    const pts = [];
    for (let k = 0; k < 6; k++) {
      const a = (Math.PI / 3) * k - Math.PI / 2;
      pts.push([p.x + R * Math.cos(a), p.y + R * Math.sin(a)]);
    }
    // Start halfway along the last side, then round each corner
    ctx.beginPath();
    ctx.moveTo((pts[5][0] + pts[0][0]) / 2, (pts[5][1] + pts[0][1]) / 2);
    for (let k = 0; k < 6; k++) {
      const [x1, y1] = pts[k], [x2, y2] = pts[(k + 1) % 6];
      ctx.arcTo(x1, y1, x2, y2, R * 0.3);
    }
    ctx.closePath();
    ctx.lineJoin = "round";
    r._fillStroke(ctx, this);
  },
});

// USDA NAIP aerial photos for the closest zooms (17 and 18), where USGS's
// tiles run out. The USDA service makes each tile on request instead of
// serving saved tiles, so this asks it for the picture covering each tile's
// area (Web Mercator meters). "jpgpng" gives a JPEG, or a PNG with see-through
// pixels where the USDA mosaic has gaps (parts of neighboring states), so the
// USGS tiles underneath show there.
window.BeehiveNaipLayer = L.TileLayer.extend({
  getTileUrl(coords) {
    const world = 2 * Math.PI * 6378137;
    const tile = world / 2 ** coords.z;
    const xmin = -world / 2 + coords.x * tile;
    const ymax = world / 2 - coords.y * tile;
    const px = 256 * (L.Browser.retina ? 2 : 1);
    return (
      "https://apps.geo.fpac.usda.gov/geo-imagery/rest/services/naip/conus_naip/ImageServer/exportImage" +
      `?bbox=${xmin},${ymax - tile},${xmin + tile},${ymax}` +
      `&bboxSR=3857&imageSR=3857&size=${px},${px}&format=jpgpng&bandIds=0,1,2&f=image`
    );
  },
});

// Shared setup for the site's Leaflet maps (town pages and the full-screen
// map): aerial imagery and short credits.
window.beehiveMap = (el, options = {}) => {
  // 18 is as close as the USDA photos stay sharp
  const map = L.map(el, { maxZoom: 18, ...options });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  L.tileLayer(
    "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
    {
      maxNativeZoom: 16,
      maxZoom: 18,
      attribution: 'Imagery: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>',
    },
  ).addTo(map);
  // Sharper photos on top from zoom 17. The stretched USGS tiles stay
  // underneath, so the map isn't blank while these load or where the USDA
  // mosaic has gaps. The USDA layer is only on the map from zoom 17, so its
  // credit shows only then (Leaflet ignores a layer's zoom range for credits).
  const naip = new BeehiveNaipLayer("", {
    maxZoom: 18,
    attribution: '<a href="https://naip-usdaonline.hub.arcgis.com">USDA NAIP</a>',
  });
  map.on("load zoomend", () => {
    const close = map.getZoom() >= 17;
    if (close && !map.hasLayer(naip)) naip.addTo(map);
    else if (!close && map.hasLayer(naip)) naip.remove();
  });
  return map;
};
