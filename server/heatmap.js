/**
 * OROS — Heatmap des zones fréquentées
 * Agrège les positions pour créer une carte de chaleur
 * Retourne des clusters de points pour Leaflet.heat
 */
'use strict';

const { pool } = require('./database');

async function getHeatmapData(params = {}) {
  const { from, to, imei, resolution = 0.002 } = params; // ~200m par cellule
  try {
    let q = `
      SELECT
        ROUND(lat::numeric / $1) * $1 AS lat_bucket,
        ROUND(lon::numeric / $1) * $1 AS lon_bucket,
        COUNT(*) AS intensity,
        AVG(speed) AS avg_speed,
        MAX(speed) AS max_speed
      FROM positions
      WHERE lat IS NOT NULL AND lon IS NOT NULL
        AND lat BETWEEN 4.5 AND 6.5
        AND lon BETWEEN -5.5 AND -3.0
    `;
    const params2 = [resolution];
    if (imei) { params2.push(imei); q += ` AND imei=$${params2.length}`; }
    if (from)  { params2.push(from); q += ` AND time >= $${params2.length}`; }
    if (to)    { params2.push(to);   q += ` AND time <= $${params2.length}`; }
    q += ` GROUP BY lat_bucket, lon_bucket HAVING COUNT(*) >= 3 ORDER BY intensity DESC LIMIT 2000`;

    const r = await pool.query(q, params2);
    const maxInt = r.rows[0]?.intensity || 1;

    // Format Leaflet.heat: [lat, lon, intensity 0-1]
    return r.rows.map(row => [
      parseFloat(row.lat_bucket),
      parseFloat(row.lon_bucket),
      Math.min(1, parseInt(row.intensity) / maxInt),
    ]);
  } catch (e) {
    return [];
  }
}

// Zones les plus fréquentées (pour le rapport)
async function getTopZones(limit = 10, from, to) {
  try {
    const r = await pool.query(`
      SELECT
        ROUND(lat::numeric / 0.005) * 0.005 AS lat_c,
        ROUND(lon::numeric / 0.005) * 0.005 AS lon_c,
        COUNT(*) AS visits,
        COUNT(DISTINCT imei) AS unique_vehicles,
        AVG(speed) AS avg_speed,
        MIN(time) AS first_seen,
        MAX(time) AS last_seen
      FROM positions
      WHERE lat BETWEEN 4.5 AND 6.5 AND lon BETWEEN -5.5 AND -3.0
        AND ($1::timestamptz IS NULL OR time >= $1)
        AND ($2::timestamptz IS NULL OR time <= $2)
      GROUP BY lat_c, lon_c
      ORDER BY visits DESC
      LIMIT $3
    `, [from||null, to||null, limit]);
    return r.rows;
  } catch (e) { return []; }
}

// Corridors (routes les plus empruntées)
async function getCorridors(from, to) {
  try {
    const r = await pool.query(`
      SELECT
        ROUND(lat::numeric / 0.01) * 0.01 AS lat_c,
        ROUND(lon::numeric / 0.01) * 0.01 AS lon_c,
        COUNT(*) AS freq,
        AVG(speed) AS avg_speed
      FROM positions
      WHERE speed > 10 AND lat BETWEEN 4.5 AND 6.5 AND lon BETWEEN -5.5 AND -3.0
        AND ($1::timestamptz IS NULL OR time >= $1)
        AND ($2::timestamptz IS NULL OR time <= $2)
      GROUP BY lat_c, lon_c
      HAVING COUNT(*) >= 5
      ORDER BY freq DESC LIMIT 500
    `, [from||null, to||null]);
    return r.rows;
  } catch (e) { return []; }
}

module.exports = { getHeatmapData, getTopZones, getCorridors };
