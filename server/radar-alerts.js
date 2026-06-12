/**
 * OROS — Système d'alertes radars avec voix
 * ════════════════════════════════════════════════════════
 *
 * Sources de données radars (gratuites, pas d'API key):
 * - OpenStreetMap Overpass API (radars fixes signalés par la communauté)
 * - Base locale enrichie manuellement pour la CI
 * - Mise à jour hebdomadaire automatique
 *
 * Fonctionnement:
 * 1. Chaque position GPS reçue est comparée aux radars en DB
 * 2. Si un radar est à < 500m ET le véhicule se dirige vers lui
 * 3. → Notification push WebSocket → Web Speech API sur l'app
 * 4. Message vocal adapté à la distance (500m, 200m, 100m)
 * ════════════════════════════════════════════════════════
 */

'use strict';

const axios  = require('axios');
const cron   = require('node-cron');
const { pool } = require('./database');
const logger   = require('./utils/logger');

// ── Init table radars ──────────────────────────────────────────────────
async function initRadarTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS radars (
      id          SERIAL PRIMARY KEY,
      lat         DOUBLE PRECISION NOT NULL,
      lon         DOUBLE PRECISION NOT NULL,
      type        TEXT DEFAULT 'fixed',
      speed_limit INTEGER,
      direction   REAL,        -- cap en degrés (null = tous les sens)
      label       TEXT,
      city        TEXT,
      road        TEXT,
      source      TEXT DEFAULT 'osm',
      active      BOOLEAN DEFAULT true,
      verified    BOOLEAN DEFAULT false,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_radars_location ON radars(lat, lon) WHERE active=true;
  `).catch(() => {});
}

// ── Types de radars ────────────────────────────────────────────────────
const RADAR_TYPES = {
  fixed:       { label: 'Radar fixe',              icon: '📷', warning_m: 500 },
  mobile:      { label: 'Radar mobile',            icon: '🚔', warning_m: 300 },
  section:     { label: 'Radar de tronçon',        icon: '📏', warning_m: 1000 },
  red_light:   { label: 'Radar feu rouge',         icon: '🚦', warning_m: 200 },
  average:     { label: 'Vitesse moyenne',         icon: '⏱️', warning_m: 800 },
  school:      { label: 'Zone scolaire',           icon: '🏫', warning_m: 300 },
  toll:        { label: 'Péage',                   icon: '💳', warning_m: 500 },
};

// ── Messages vocaux par distance ───────────────────────────────────────
function buildVoiceMessage(radar, distanceM, speed, lang = 'fr-FR') {
  const type    = RADAR_TYPES[radar.type] || RADAR_TYPES.fixed;
  const limit   = radar.speed_limit;
  const dist    = Math.round(distanceM / 100) * 100;
  const isOver  = limit && speed > limit;
  const city    = radar.city ? ` à ${radar.city}` : '';

  if (lang === 'fr-FR') {
    if (distanceM > 400) {
      return isOver
        ? `Attention. ${type.label}${city} dans ${dist} mètres. Vitesse limite ${limit} kilomètres heure. Vous êtes à ${speed} kilomètres heure. Réduisez votre vitesse immédiatement.`
        : `${type.label}${city} dans ${dist} mètres. Limite ${limit || 'inconnue'} kilomètres heure.`;
    } else if (distanceM > 150) {
      return isOver
        ? `Ralentissez ! ${type.label} dans ${Math.round(distanceM)} mètres. Vous dépassez la limite autorisée.`
        : `${type.label} dans ${Math.round(distanceM)} mètres.`;
    } else {
      return `${type.label}. Contrôle de vitesse imminent.`;
    }
  }

  // Dioula (langue principale CI)
  if (lang === 'dioula') {
    return `Sigida. Radar ${dist} mètre la.`;
  }

  return `Speed camera in ${Math.round(distanceM)} meters. Limit ${limit || 'unknown'}.`;
}

// ── Distance haversine ─────────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Vérifier si le véhicule se dirige vers le radar ───────────────────
function isHeadingTowards(vehicleLat, vehicleLon, vehicleHeading, radarLat, radarLon) {
  if (vehicleHeading === null || vehicleHeading === undefined) return true; // On suppose que oui si inconnu
  // Angle du véhicule vers le radar
  const dLon    = (radarLon - vehicleLon) * Math.PI / 180;
  const dLat    = (radarLat - vehicleLat) * Math.PI / 180;
  const bearing = (Math.atan2(Math.sin(dLon), dLat) * 180 / Math.PI + 360) % 360;
  // Différence angulaire (tolérance ±60°)
  const diff = Math.abs(bearing - vehicleHeading);
  return diff <= 60 || diff >= 300;
}

// ── Analyse position vs radars — appelé à chaque trame ────────────────
const lastAlert = new Map(); // imei → { radarId, alertedAt }

async function checkRadarProximity(pos) {
  const { imei, lat, lon, speed, heading } = pos;
  if (!lat || !lon || speed < 15) return null; // Pas d'alerte si à l'arrêt

  try {
    // Requête géographique : radars dans un rayon de 1km
    const r = await pool.query(`
      SELECT id, lat, lon, type, speed_limit, direction, label, city, road
      FROM radars
      WHERE active = true
        AND ABS(lat - $1) < 0.015
        AND ABS(lon - $2) < 0.015
    `, [lat, lon]);

    if (!r.rows.length) return null;

    for (const radar of r.rows) {
      const distance = haversine(lat, lon, radar.lat, radar.lon);
      const type     = RADAR_TYPES[radar.type] || RADAR_TYPES.fixed;

      if (distance > type.warning_m) continue;
      if (!isHeadingTowards(lat, lon, heading, radar.lat, radar.lon)) continue;

      // Anti-spam : ne pas ré-alerter le même radar avant 2 minutes
      const lastKey   = `${imei}:${radar.id}`;
      const lastEntry = lastAlert.get(lastKey);
      if (lastEntry && (Date.now() - lastEntry) < 2 * 60 * 1000) continue;
      lastAlert.set(lastKey, Date.now());

      // Construire l'alerte vocale
      const message = buildVoiceMessage(radar, distance, speed || 0);
      const isOver  = radar.speed_limit && speed > radar.speed_limit;
      const urgency = distance < 200 ? 'high' : distance < 400 ? 'medium' : 'low';

      logger.info(`[Radar] ${imei} → ${radar.type} dans ${Math.round(distance)}m (${radar.city||'?'})`);

      return {
        type:        'radar_alert',
        imei,
        radarId:     radar.id,
        radarType:   radar.type,
        radarLabel:  type.label,
        radarIcon:   type.icon,
        distance:    Math.round(distance),
        speedLimit:  radar.speed_limit,
        currentSpeed:speed,
        isOverSpeed: isOver,
        urgency,
        city:        radar.city,
        road:        radar.road,
        voice: {
          message,          // Texte à synthétiser
          lang:    'fr-FR', // Langue Web Speech API
          rate:    0.95,    // Vitesse de lecture (légèrement lente pour clarté)
          pitch:   1.0,
          volume:  1.0,
        },
        timestamp: new Date().toISOString(),
      };
    }
  } catch (e) {
    logger.error('[Radar] ' + e.message);
  }
  return null;
}

// ── Importer les radars depuis OpenStreetMap (Overpass API) ───────────
async function importFromOSM(bbox = '4.5,-5.5,6.5,-3.0') { // Bounding box CI
  logger.info('[Radar] Import OSM Overpass API...');
  try {
    const query = `
      [out:json][timeout:60];
      (
        node["highway"="speed_camera"](${bbox});
        node["enforcement"="speed"](${bbox});
        node["traffic_enforcement"="speed_camera"](${bbox});
      );
      out body;
    `;
    const resp = await axios.post(
      'https://overpass-api.de/api/interpreter',
      `data=${encodeURIComponent(query)}`,
      { headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, timeout: 30000 }
    );

    const elements = resp.data?.elements || [];
    let imported = 0;

    for (const el of elements) {
      if (!el.lat || !el.lon) continue;
      const limit = parseInt(el.tags?.maxspeed) || null;
      await pool.query(`
        INSERT INTO radars(lat, lon, type, speed_limit, label, city, source, verified)
        VALUES($1,$2,$3,$4,$5,$6,'osm',false)
        ON CONFLICT DO NOTHING
      `, [
        el.lat, el.lon,
        el.tags?.enforcement === 'average_speed' ? 'section' : 'fixed',
        limit,
        el.tags?.name || 'Radar OSM',
        el.tags?.['addr:city'] || null,
      ]);
      imported++;
    }

    logger.info(`[Radar] ${imported} radars importés depuis OSM`);
    return imported;
  } catch (e) {
    logger.error('[Radar] Import OSM: ' + e.message);
    return 0;
  }
}

// ── Base de données initiale CI (radars connus manuellement) ──────────
async function seedCIRadars() {
  const knownRadars = [
    // Abidjan — axes principaux
    { lat:5.3640, lon:-4.0070, type:'fixed',     speed_limit:50,  city:'Plateau',     road:'Boulevard de la République',    label:'Radar Plateau Centre' },
    { lat:5.3601, lon:-4.0160, type:'fixed',     speed_limit:50,  city:'Cocody',      road:'Avenue Houphouët-Boigny',       label:'Radar Cocody Entrée' },
    { lat:5.3550, lon:-3.9980, type:'fixed',     speed_limit:80,  city:'Marcory',     road:'Voie Express',                  label:'Radar Voie Express Marcory' },
    { lat:5.3460, lon:-4.0340, type:'fixed',     speed_limit:50,  city:'Yopougon',    road:'Boulevard de Yopougon',         label:'Radar Yopougon Centre' },
    { lat:5.3720, lon:-4.0080, type:'fixed',     speed_limit:80,  city:'Riviera',     road:'Autoroute du Nord',             label:'Radar Riviera Échangeur' },
    { lat:5.3510, lon:-4.0250, type:'fixed',     speed_limit:80,  city:'Adjamé',      road:'Boulevard de la Paix',          label:'Radar Adjamé Boulevard' },
    { lat:5.2540, lon:-3.9260, type:'fixed',     speed_limit:70,  city:'Port-Bouët',  road:'Route Aéroport',                label:'Radar Route Aéroport' },
    { lat:5.3200, lon:-4.0100, type:'section',   speed_limit:80,  city:'Koumassi',    road:'Voie Express',                  label:'Radar Tronçon Koumassi' },
    { lat:5.3900, lon:-4.0050, type:'fixed',     speed_limit:50,  city:'Bingerville', road:'RN1',                           label:'Radar RN1 Bingerville' },
    { lat:5.4100, lon:-4.0200, type:'mobile',    speed_limit:80,  city:'Anyama',      road:'Autoroute du Nord',             label:'Zone radar mobile Anyama' },
    // Zone école / hôpital
    { lat:5.3635, lon:-4.0120, type:'school',    speed_limit:30,  city:'Cocody',      road:'Rue des Jardins',               label:'Zone scolaire Cocody' },
    { lat:5.3560, lon:-4.0180, type:'red_light', speed_limit:null,city:'Plateau',     road:'Carrefour Deux Plateaux',       label:'Feu rouge Deux Plateaux' },
  ];

  let seeded = 0;
  for (const r of knownRadars) {
    const exists = await pool.query('SELECT id FROM radars WHERE lat=$1 AND lon=$2', [r.lat, r.lon]).catch(()=>({rows:[]}));
    if (!exists.rows.length) {
      await pool.query(
        'INSERT INTO radars(lat,lon,type,speed_limit,city,road,label,source,verified) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true)',
        [r.lat, r.lon, r.type, r.speed_limit, r.city, r.road, r.label, 'manual']
      ).catch(()=>{});
      seeded++;
    }
  }
  if (seeded > 0) logger.info(`[Radar] ${seeded} radars CI manuels insérés`);
}

// ── Mise à jour hebdomadaire OSM ────────────────────────────────────────
cron.schedule('0 3 * * 0', async () => {
  logger.info('[Radar] Mise à jour hebdo OSM...');
  await importFromOSM();
}, { timezone: 'Africa/Abidjan' });

// ── API : CRUD radars ──────────────────────────────────────────────────
async function getRadars(filters = {}) {
  const { city, type, active = true } = filters;
  let q = 'SELECT * FROM radars WHERE active=$1';
  const params = [active];
  if (city) { params.push(`%${city}%`); q += ` AND city ILIKE $${params.length}`; }
  if (type) { params.push(type);        q += ` AND type=$${params.length}`; }
  q += ' ORDER BY city, road';
  const r = await pool.query(q, params).catch(()=>({rows:[]}));
  return r.rows;
}

async function addRadar(data, userId) {
  const { lat, lon, type='fixed', speedLimit, label, city, road } = data;
  const r = await pool.query(
    'INSERT INTO radars(lat,lon,type,speed_limit,label,city,road,source,verified) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING *',
    [lat, lon, type, speedLimit, label, city, road, 'user']
  );
  return r.rows[0];
}

async function updateRadar(id, data) {
  const { speedLimit, label, city, road, active, verified } = data;
  const r = await pool.query(
    'UPDATE radars SET speed_limit=$1,label=$2,city=$3,road=$4,active=$5,verified=$6,updated_at=NOW() WHERE id=$7 RETURNING *',
    [speedLimit, label, city, road, active!==false, verified||false, id]
  );
  return r.rows[0];
}

// Initialisation
(async () => {
  await initRadarTable();
  await seedCIRadars();
})();

module.exports = {
  checkRadarProximity,
  importFromOSM,
  getRadars,
  addRadar,
  updateRadar,
  buildVoiceMessage,
  RADAR_TYPES,
};
