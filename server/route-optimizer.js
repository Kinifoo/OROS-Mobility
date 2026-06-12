/**
 * OROS — Optimiseur d'itinéraires
 * Utilise OSRM public API (gratuit, pas de clé)
 * Fallback: GraphHopper API (gratuit jusqu'à 500 req/jour)
 *
 * Fonctionnalités:
 * 1. Meilleur chemin A→B avec alternatives
 * 2. Optimisation tournée multi-stops (algorithme nearest-neighbor + 2-opt)
 * 3. Estimation durée / distance / ETA
 * 4. Zones à éviter (géofences interdites)
 */
'use strict';

const axios  = require('axios');
const logger = require('./utils/logger');

const OSRM_BASE = 'https://router.project-osrm.org';
const GH_BASE   = process.env.GRAPHHOPPER_URL || 'https://graphhopper.com/api/1';
const GH_KEY    = process.env.GRAPHHOPPER_KEY || '';

// ── Route simple A → B ────────────────────────────────────────────────
async function getRoute(fromLat, fromLon, toLat, toLon, options = {}) {
  const { alternatives = true, steps = true, vehicle = 'car' } = options;
  try {
    const coords = `${fromLon},${fromLat};${toLon},${toLat}`;
    const url = `${OSRM_BASE}/route/v1/driving/${coords}`;
    const resp = await axios.get(url, {
      params: {
        alternatives: alternatives ? 'true' : 'false',
        steps: steps ? 'true' : 'false',
        geometries: 'geojson',
        overview: 'full',
        annotations: 'duration,distance',
      },
      timeout: 8000,
    });

    if (resp.data.code !== 'Ok') throw new Error('OSRM: ' + resp.data.message);

    return resp.data.routes.map((r, idx) => ({
      index:       idx,
      distance:    Math.round(r.distance),         // mètres
      distanceKm:  Math.round(r.distance / 100) / 10,
      duration:    Math.round(r.duration),          // secondes
      durationMin: Math.round(r.duration / 60),
      eta:         new Date(Date.now() + r.duration * 1000).toISOString(),
      geometry:    r.geometry,                      // GeoJSON LineString
      legs:        r.legs,
      steps:       steps ? r.legs.flatMap(l => l.steps.map(s => ({
        instruction: s.maneuver?.type + ' ' + (s.name||''),
        distance:    Math.round(s.distance),
        duration:    Math.round(s.duration),
        coords:      s.maneuver?.location,
      }))) : [],
    }));
  } catch (e) {
    logger.error('[Router] OSRM erreur: ' + e.message);
    // Fallback: ligne droite avec estimation
    const d = haversineMeters(fromLat, fromLon, toLat, toLon);
    return [{
      index: 0, distance: d, distanceKm: Math.round(d/100)/10,
      duration: Math.round(d/8.33), // ~30km/h moyen
      durationMin: Math.round(d/8.33/60),
      eta: new Date(Date.now() + d/8.33*1000).toISOString(),
      geometry: { type:'LineString', coordinates:[[fromLon,fromLat],[toLon,toLat]] },
      legs: [], steps: [], fallback: true,
    }];
  }
}

// ── Matrice de distances (pour optimisation multi-stops) ──────────────
async function getDistanceMatrix(waypoints) {
  // waypoints: [{lat, lon, name}]
  if (waypoints.length < 2) return null;
  try {
    const coords = waypoints.map(w => `${w.lon},${w.lat}`).join(';');
    const url = `${OSRM_BASE}/table/v1/driving/${coords}`;
    const resp = await axios.get(url, {
      params: { annotations: 'duration,distance' },
      timeout: 10000,
    });
    if (resp.data.code !== 'Ok') throw new Error(resp.data.message);
    return {
      durations:  resp.data.durations,   // matrice N×N en secondes
      distances:  resp.data.distances,   // matrice N×N en mètres
      sources:    resp.data.sources,
      destinations: resp.data.destinations,
    };
  } catch (e) {
    logger.error('[Router] Matrice OSRM: ' + e.message);
    return buildFallbackMatrix(waypoints);
  }
}

// ── Optimisation tournée (Traveling Salesman Problem — approx.) ───────
async function optimizeTour(depot, stops) {
  // depot: {lat, lon, name} — point de départ ET d'arrivée
  // stops: [{lat, lon, name, id}]

  const allPoints = [depot, ...stops, depot];
  const matrix = await getDistanceMatrix([depot, ...stops]);

  if (!matrix) return { order: stops, totalKm: 0, totalMin: 0 };

  const n = stops.length;
  const dist = matrix.durations; // On optimise sur le temps

  // Nearest Neighbor heuristic
  let visited   = new Array(n).fill(false);
  let order     = [];
  let current   = 0; // commence au dépôt (index 0)
  let totalTime = 0;

  for (let step = 0; step < n; step++) {
    let nearest = -1, nearestDist = Infinity;
    for (let j = 1; j <= n; j++) { // indices 1..n = stops
      if (!visited[j-1] && dist[current][j] < nearestDist) {
        nearest = j; nearestDist = dist[current][j];
      }
    }
    visited[nearest-1] = true;
    order.push(stops[nearest-1]);
    totalTime += dist[current][nearest];
    current = nearest;
  }
  // Retour au dépôt
  totalTime += dist[current][0];

  // 2-opt amélioration
  order = twoOpt(order, dist, n);

  // Calculer la route complète optimisée
  const orderedPoints = [depot, ...order, depot];
  const routes = [];
  let totalDistM = 0;

  for (let i = 0; i < orderedPoints.length - 1; i++) {
    const r = await getRoute(
      orderedPoints[i].lat, orderedPoints[i].lon,
      orderedPoints[i+1].lat, orderedPoints[i+1].lon,
      { alternatives: false, steps: false }
    );
    if (r[0]) {
      routes.push({ from: orderedPoints[i], to: orderedPoints[i+1], ...r[0] });
      totalDistM += r[0].distance;
    }
  }

  return {
    order,
    depot,
    routes,
    totalKm:    Math.round(totalDistM / 100) / 10,
    totalMin:   Math.round(totalTime / 60),
    totalHours: Math.round(totalTime / 3600 * 10) / 10,
    eta:        new Date(Date.now() + totalTime * 1000).toISOString(),
    stopsCount: stops.length,
  };
}

// 2-opt: amélioration locale de l'ordre des stops
function twoOpt(route, distMatrix, n) {
  let improved = true;
  let best = [...route];

  while (improved) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        // Calculer le gain d'un échange i↔j
        const before = routeCost([...best], distMatrix, n);
        const swapped = [...best];
        // Inverser le sous-segment entre i et j
        let l = i, r = j;
        while (l < r) { [swapped[l], swapped[r]] = [swapped[r], swapped[l]]; l++; r--; }
        const after = routeCost(swapped, distMatrix, n);
        if (after < before - 1) {
          best = swapped; improved = true;
        }
      }
    }
  }
  return best;
}

function routeCost(route, distMatrix, n) {
  let cost = distMatrix[0][stopIndex(route[0], n)] || 0;
  for (let i = 0; i < route.length - 1; i++) {
    cost += distMatrix[stopIndex(route[i], n)][stopIndex(route[i+1], n)] || 0;
  }
  cost += distMatrix[stopIndex(route[route.length-1], n)][0] || 0;
  return cost;
}

function stopIndex(stop, n) {
  // Les stops ont des indices 1..n dans la matrice (0 = dépôt)
  return (stop._matrixIdx !== undefined) ? stop._matrixIdx : 1;
}

// ── Isochrone (zone atteignable en N minutes) ─────────────────────────
async function getIsochrone(lat, lon, minutes = 15) {
  try {
    if (!GH_KEY) throw new Error('GraphHopper key non configurée');
    const resp = await axios.get(`${GH_BASE}/isochrone`, {
      params: { point: `${lat},${lon}`, time_limit: minutes*60, vehicle:'car', key: GH_KEY },
      timeout: 8000,
    });
    return resp.data.polygons?.[0]?.geometry || null;
  } catch (e) {
    logger.error('[Router] Isochrone: ' + e.message);
    // Retourner un cercle approximatif
    const r = (minutes * 30000) / 60; // ~30km/h
    return approximateCircle(lat, lon, r);
  }
}

// ── Snap au réseau routier ────────────────────────────────────────────
async function snapToRoad(lat, lon) {
  try {
    const resp = await axios.get(`${OSRM_BASE}/nearest/v1/driving/${lon},${lat}`, {
      params: { number: 1 }, timeout: 5000,
    });
    if (resp.data.code !== 'Ok') return { lat, lon };
    const loc = resp.data.waypoints[0].location;
    return { lat: loc[1], lon: loc[0], name: resp.data.waypoints[0].name };
  } catch (e) {
    return { lat, lon };
  }
}

// ── Utilitaires ───────────────────────────────────────────────────────
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function buildFallbackMatrix(waypoints) {
  const n = waypoints.length;
  const durations = Array.from({length:n}, (_,i) =>
    Array.from({length:n}, (_,j) => i===j ? 0 :
      haversineMeters(waypoints[i].lat,waypoints[i].lon,waypoints[j].lat,waypoints[j].lon)/8.33
    )
  );
  return { durations, distances: durations.map(r => r.map(v => v*8.33)) };
}

function approximateCircle(lat, lon, radiusM, points = 32) {
  const coords = [];
  for (let i = 0; i <= points; i++) {
    const angle = (i/points)*2*Math.PI;
    const dLat = (radiusM/111320)*Math.cos(angle);
    const dLon = (radiusM/(111320*Math.cos(lat*Math.PI/180)))*Math.sin(angle);
    coords.push([lon+dLon, lat+dLat]);
  }
  return { type:'Polygon', coordinates:[coords] };
}

module.exports = { getRoute, getDistanceMatrix, optimizeTour, getIsochrone, snapToRoad };
