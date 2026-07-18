const fs = require('fs');
const path = require('path');

const TRAVEL_DIR = path.join(__dirname, '..');
const csvPath = path.join(TRAVEL_DIR, 'airports.csv');
const outPath = path.join(TRAVEL_DIR, 'airports-map.html');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

const csvText = fs.readFileSync(csvPath, 'utf-8');

const rows = parseCsv(csvText);
const header = rows[0];
const dataRows = rows.slice(1);

const idx = {
  iata: header.indexOf('iata'),
  icao: header.indexOf('icao'),
  name: header.indexOf('name'),
  city: header.indexOf('city'),
  country: header.indexOf('country'),
  lat: header.indexOf('lat'),
  lng: header.indexOf('lng'),
  distanceHub: header.indexOf('distance_hub'),
  isolated: header.indexOf('isolated'),
  regional: header.indexOf('regional'),
};

const airports = dataRows
  .filter((r) => r.length >= header.length && r[idx.iata])
  .map((r) => ({
    iata: r[idx.iata],
    icao: r[idx.icao],
    name: r[idx.name],
    city: r[idx.city],
    country: r[idx.country],
    lat: parseFloat(r[idx.lat]),
    lng: parseFloat(r[idx.lng]),
    // Internal-only flags: rendered as colored markers on this map, never exposed via API/DTOs.
    distanceHub: idx.distanceHub !== -1 && r[idx.distanceHub] === '1',
    isolated: idx.isolated !== -1 && r[idx.isolated] === '1',
    regional: idx.regional !== -1 && r[idx.regional] === '1',
  }))
  .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lng));

console.log(`Parsed ${airports.length} airports from ${dataRows.length} data rows`);
console.log(`  distance hubs: ${airports.filter((a) => a.distanceHub).length}`);
console.log(`  isolated: ${airports.filter((a) => a.isolated).length}`);
console.log(`  regional: ${airports.filter((a) => a.regional).length}`);

const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Travel Airports Map</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
    <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: #f0f0f0;
        }
        #header {
            background: #2c3e50;
            color: white;
            padding: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        #header h1 {
            font-size: 24px;
            margin-bottom: 5px;
        }
        #header p {
            font-size: 14px;
            opacity: 0.9;
        }
        #map {
            position: absolute;
            top: 100px;
            bottom: 0;
            width: 100%;
            z-index: 1;
        }
        #stats {
            position: absolute;
            bottom: 20px;
            right: 20px;
            background: white;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            z-index: 1000;
            font-size: 14px;
            min-width: 180px;
        }
        #stats div {
            margin-bottom: 8px;
        }
        #stats div:last-child {
            margin-bottom: 0;
        }
        .stat-label {
            font-weight: bold;
            color: #2c3e50;
        }
        .stat-value {
            color: #3498db;
            font-weight: 500;
        }
        .legend-dot {
            display: inline-block;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            margin-right: 6px;
        }
        .leaflet-popup-content {
            font-size: 13px;
        }
        .popup-title {
            font-weight: bold;
            margin-bottom: 5px;
            color: #2c3e50;
        }
        .popup-detail {
            font-size: 12px;
            color: #555;
        }
    </style>
</head>
<body>
    <div id="header">
        <h1>Travel Airports Map</h1>
        <p>Interactive map showing all available airports</p>
    </div>
    <div id="map"></div>
    <div id="stats">
        <div><span class="stat-label">Total Airports:</span> <span class="stat-value" id="airport-count">0</span></div>
        <div><span class="stat-label">Countries:</span> <span class="stat-value" id="country-count">0</span></div>
        <div><span class="legend-dot" style="background:#3388ff;"></span>Standard</div>
        <div><span class="legend-dot" style="background:#2ecc71;"></span>Hub</div>
        <div><span class="legend-dot" style="background:#e67e22;"></span>Isolated</div>
        <div><span class="legend-dot" style="background:#7b7b7b;"></span>Regional</div>
    </div>

    <script>
        const map = L.map('map').setView([20, 0], 2);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(map);

        const airports = ${JSON.stringify(airports, null, 4)};

        const countrySet = new Set();

        const greenIcon = new L.Icon({
            iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-green.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        });

        const orangeIcon = new L.Icon({
            iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-orange.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        });

        const greyIcon = new L.Icon({
            iconUrl: 'https://cdn.jsdelivr.net/gh/pointhi/leaflet-color-markers@master/img/marker-icon-grey.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        });

        airports.forEach(airport => {
            const markerOptions = { title: airport.iata };
            if (airport.isolated) {
                markerOptions.icon = orangeIcon;
            } else if (airport.distanceHub) {
                markerOptions.icon = greenIcon;
            } else if (airport.regional) {
                markerOptions.icon = greyIcon;
            }
            const marker = L.marker([airport.lat, airport.lng], markerOptions);

            const popupContent = '<div class="popup-title">' + airport.iata + ' - ' + airport.name + '</div>' +
                                 '<div class="popup-detail"><strong>City:</strong> ' + airport.city + '</div>' +
                                 '<div class="popup-detail"><strong>Country:</strong> ' + airport.country + '</div>' +
                                 '<div class="popup-detail"><strong>ICAO:</strong> ' + airport.icao + '</div>' +
                                 '<div class="popup-detail"><strong>Coordinates:</strong> ' + airport.lat.toFixed(4) + ', ' + airport.lng.toFixed(4) + '</div>';

            marker.bindPopup(popupContent);
            marker.addTo(map);

            countrySet.add(airport.country);
        });

        document.getElementById('airport-count').textContent = airports.length;
        document.getElementById('country-count').textContent = countrySet.size;

        if (airports.length > 0) {
            const bounds = L.latLngBounds(airports.map(a => [a.lat, a.lng]));
            map.fitBounds(bounds, {padding: [50, 50]});
        }
    </script>
</body>
</html>
`;

fs.writeFileSync(outPath, html, 'utf-8');
console.log(`Wrote ${outPath}`);
