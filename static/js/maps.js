// Shared setup for the site's Leaflet maps (town pages and the full-screen
// map): USGS aerial imagery with roads and place names, and short credits.
window.beehiveMap = (el, options = {}) => {
  const map = L.map(el, options);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  L.tileLayer(
    "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}",
    {
      maxNativeZoom: 16,
      maxZoom: 19,
      attribution: 'Imagery: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>',
    },
  ).addTo(map);
  return map;
};
