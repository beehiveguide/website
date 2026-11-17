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

// USDA NAIP aerial photos for the closest zoom, where USGS's tiles are
// stretched too far. The USDA service makes each tile on request instead of
// serving saved tiles, so this asks it for the picture covering each tile's
// area (Web Mercator meters). The USDA mosaic has gaps in some neighboring
// states, so the layer only asks for Utah (see UTAH_BOUNDS) and USGS tiles
// show elsewhere.
// First zoom that uses the USDA photos (the closest zoom is 18).
const NAIP_FROM_ZOOM = 15;
// true: USGS also stays on the map at NAIP_FROM_ZOOM, under the USDA photos,
// so the map isn't gray while they load (both credits show at that zoom).
// false: USGS is used only below it.
const OVERLAP_ONE_ZOOM = true;
const UTAH_BOUNDS = L.latLngBounds([36.95, -114.1], [42.05, -109.0]);
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
      `&bboxSR=3857&imageSR=3857&size=${px},${px}&format=jpg&bandIds=0,1,2&f=image`
    );
  },
});

// Test overlay: USGS National Map roads and road names drawn over the
// photos. Like the USDA photos, the service draws each picture on request
// (a MapServer "export"). Tiles are 512 px so names get cut at tile edges less.
window.BeehiveRoadsLayer = L.TileLayer.extend({
  options: { tileSize: 512 },
  getTileUrl(coords) {
    const world = 2 * Math.PI * 6378137;
    // 512 px tiles cover twice the area of 256 px ones at the same zoom
    const tile = world / 2 ** (coords.z - 1);
    const xmin = -world / 2 + coords.x * tile;
    const ymax = world / 2 - coords.y * tile;
    // Groups 13, 14 and 26, then highways and connecting roads (29-31).
    // Names repeat along a road at a set spacing, which is redundant when
    // zoomed out, so they come in as you get closer: highway names (19) from
    // zoom 14 and route shields (16-18) from zoom 15. Local road names
    // (20-21), local roads (32) and ramps (33) are left out.
    const names = coords.z >= 14 ? ",19" : "";
    const shields = coords.z >= 15 ? ",16,17,18" : "";
    const show = `13,14,26,29,30,31${names}${shields}`;
    return (
      "https://carto.nationalmap.gov/arcgis/rest/services/transportation/MapServer/export" +
      `?bbox=${xmin},${ymax - tile},${xmin + tile},${ymax}` +
      `&bboxSR=3857&imageSR=3857&size=512,512&dpi=72&format=png32&transparent=true&layers=show:${show}&f=image`
    );
  },
});

// Shared setup for the site's Leaflet maps (town pages and the full-screen
// map): aerial imagery and short credits.
// Test switch: roads and road names over the photos from zoom 12 (off: too slow to load)
const ROADS_OVERLAY = false;

window.beehiveMap = (el, options = {}) => {
  // 18 is as close as the USDA photos stay sharp. Panning stays within Utah
  // (a little extra for towns at the border).
  const map = L.map(el, {
    maxZoom: 18,
    maxBounds: UTAH_BOUNDS.pad(0.1),
    maxBoundsViscosity: 1,
    ...options,
  });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  const usgs = L.tileLayer(
    "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
    {
      maxNativeZoom: 16,
      maxZoom: 18,
      attribution: 'Imagery: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>',
    },
  );
  // USDA photos start at NAIP_FROM_ZOOM, earlier than USGS's tiles run out so
  // more of the site shows the newer photos. With OVERLAP_ONE_ZOOM off, only
  // one imagery layer is on the map at a time, so the map is briefly gray
  // while USDA tiles load.
  const naip = new BeehiveNaipLayer("", {
    zIndex: 2, // above USGS however they were added
    bounds: UTAH_BOUNDS,
    maxZoom: 18,
    attribution: 'Imagery: <a href="https://naip-usdaonline.hub.arcgis.com">USDA NAIP</a>',
  });
  const show = (layer, on) => {
    if (on && !map.hasLayer(layer)) layer.addTo(map);
    else if (!on && map.hasLayer(layer)) layer.remove();
  };
  // Leaflet ignores a layer's zoom range for credits, so layers are added and
  // removed to keep each credit to the zooms where its layer is on the map.
  map.on("load zoomend", () => {
    const z = map.getZoom();
    show(usgs, z < NAIP_FROM_ZOOM + (OVERLAP_ONE_ZOOM ? 1 : 0));
    show(naip, z >= NAIP_FROM_ZOOM);
  });
  if (ROADS_OVERLAY) {
    // On top of both photo layers; the USGS credit above already covers it
    new BeehiveRoadsLayer("", { zIndex: 3, minZoom: 12, maxZoom: 18 }).addTo(map);
  }
  return map;
};
