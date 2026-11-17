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

// Shared setup for the site's Leaflet maps (town pages and the full-screen
// map): USGS aerial imagery with roads and place names, and short credits.
window.beehiveMap = (el, options = {}) => {
  const map = L.map(el, options);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  L.tileLayer(
    "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
    {
      maxNativeZoom: 16,
      maxZoom: 19,
      attribution: 'Imagery: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>',
    },
  ).addTo(map);
  return map;
};
