/**
 * OROS — Détecteur automatique de trajets
 * Logique : départ = mouvement > 10km/h pendant > 30s
 *           arrivée = vitesse < 5km/h pendant > 2min OU moteur coupé
 */
'use strict';

const { pool } = require('./database');
const logger = require('./utils/logger');
const { haversine } = require('./alert-engine');

// État par traceur
const tripState = new Map();
// {imei: {tripId, startTime, startLat, startLon, startOdo, distance, maxSpeed, totalSpeed, samples, movingSince, stoppedSince, harshBrakes, harshAccels, overSpeeds}}

const SPEED_THRESHOLD_START = 10; // km/h pour démarrer un trajet
const SPEED_THRESHOLD_END   = 5;  // km/h pour clôturer
const START_DELAY_MS        = 30 * 1000;  // 30s en mouvement = départ confirmé
const END_DELAY_MS          = 2 * 60 * 1000; // 2min arrêt = arrivée

async function processPosition(pos) {
  const { imei, speed, lat, lon, ignition, timestamp, rpm } = pos;
  const state = tripState.get(imei) || {
    tripId: null, startTime: null, startLat: null, startLon: null,
    distance: 0, maxSpeed: 0, totalSpeed: 0, samples: 0,
    harshBrakes: 0, harshAccels: 0, overSpeeds: 0,
    movingSince: null, stoppedSince: null,
    lastLat: null, lastLon: null, lastTime: null
  };

  const now = new Date(timestamp || new Date());
  const isMoving = speed > SPEED_THRESHOLD_START;
  const isStopped = speed < SPEED_THRESHOLD_END;

  // ── Accumulation distance sur trajet actif ────────────────────────
  if (state.tripId && state.lastLat !== null) {
    const d = haversine(state.lastLat, state.lastLon, lat, lon);
    if (d < 500) { // filtre les sauts GPS aberrants
      state.distance += d;
    }
    state.maxSpeed = Math.max(state.maxSpeed, speed);
    state.totalSpeed += speed;
    state.samples++;
    if (speed > (await getMaxSpeed(imei))) state.overSpeeds++;
  }

  // ── Détection départ ─────────────────────────────────────────────
  if (!state.tripId) {
    if (isMoving) {
      if (!state.movingSince) state.movingSince = now;
      const movingMs = now - state.movingSince;
      if (movingMs >= START_DELAY_MS) {
        // Démarrer un trajet
        const r = await pool.query(
          'INSERT INTO trips(device_id,start_time,start_lat,start_lon) SELECT id,$1,$2,$3 FROM devices WHERE imei=$4 RETURNING id',
          [state.movingSince, lat, lon, imei]
        );
        if (r.rows[0]) {
          state.tripId = r.rows[0].id;
          state.startTime = state.movingSince;
          state.startLat = lat; state.startLon = lon;
          state.distance = 0; state.maxSpeed = 0; state.totalSpeed = 0; state.samples = 0;
          state.stoppedSince = null;
          logger.info(`[TRIP] Départ trajet #${state.tripId} — ${imei}`);
        }
      }
    } else {
      state.movingSince = null;
    }
  }

  // ── Détection arrivée ─────────────────────────────────────────────
  if (state.tripId) {
    if (isStopped || ignition === false) {
      if (!state.stoppedSince) state.stoppedSince = now;
      const stoppedMs = now - state.stoppedSince;
      if (stoppedMs >= END_DELAY_MS || ignition === false) {
        await closeTrip(state, imei, lat, lon, now);
        state.tripId = null; state.startTime = null;
        state.movingSince = null; state.stoppedSince = null;
        state.distance = 0; state.maxSpeed = 0; state.totalSpeed = 0; state.samples = 0;
      }
    } else {
      state.stoppedSince = null;
    }
  }

  state.lastLat = lat; state.lastLon = lon; state.lastTime = now;
  tripState.set(imei, state);
}

async function closeTrip(state, imei, endLat, endLon, endTime) {
  if (!state.tripId || !state.startTime) return;
  const durationMs   = endTime - new Date(state.startTime);
  const durationMin  = Math.round(durationMs / 60000);
  const distanceKm   = state.distance / 1000;
  const avgSpeed     = state.samples > 0 ? Math.round(state.totalSpeed / state.samples) : 0;
  const score        = computeDrivingScore(state);

  try {
    await pool.query(`
      UPDATE trips SET
        end_time=$1, end_lat=$2, end_lon=$3,
        distance=$4, duration_minutes=$5,
        avg_speed=$6, max_speed=$7,
        harsh_brakes=$8, harsh_accels=$9, over_speed_count=$10,
        driving_score=$11
      WHERE id=$12
    `, [endTime, endLat, endLon,
        distanceKm.toFixed(3), durationMin,
        avgSpeed, state.maxSpeed,
        state.harshBrakes||0, state.harshAccels||0, state.overSpeeds||0,
        score, state.tripId]);
    logger.info(`[TRIP] Trajet #${state.tripId} clôturé — ${distanceKm.toFixed(1)}km, ${durationMin}min, score:${score}`);
    // Mettre à jour le score conducteur global
    await updateDriverScore(imei);
  } catch (e) {
    logger.error('[TripDetector] Erreur clôture: ' + e.message);
  }
}

function computeDrivingScore(state) {
  let score = 100;
  score -= Math.min(30, (state.harshBrakes || 0) * 5);
  score -= Math.min(20, (state.harshAccels || 0) * 4);
  score -= Math.min(30, (state.overSpeeds  || 0) * 3);
  return Math.max(0, Math.round(score));
}

async function updateDriverScore(imei) {
  try {
    // Score moyen des 30 derniers trajets
    const r = await pool.query(`
      SELECT AVG(t.driving_score) AS avg_score, COUNT(*) AS trip_count
      FROM trips t
      JOIN devices d ON d.id = t.device_id
      WHERE d.imei=$1 AND t.driving_score IS NOT NULL
        AND t.start_time > NOW() - INTERVAL '30 days'
    `, [imei]);
    if (!r.rows[0]?.avg_score) return;
    const score = Math.round(r.rows[0].avg_score);
    // Chercher le conducteur affecté à ce véhicule
    await pool.query(`
      UPDATE drivers SET driving_score=$1
      FROM assignments a
      JOIN vehicles v ON v.id=a.vehicle_id
      JOIN devices d ON d.id=v.device_id
      WHERE d.imei=$2 AND a.ended_at IS NULL AND drivers.id=a.driver_id
    `, [score, imei]);
  } catch (e) {
    logger.error('[TripDetector] Erreur score conducteur: ' + e.message);
  }
}

async function getMaxSpeed(imei) {
  try {
    const r = await pool.query('SELECT max_speed FROM devices WHERE imei=$1', [imei]);
    return r.rows[0]?.max_speed || 100;
  } catch (e) { return 100; }
}

// Appelé depuis l'alert-engine pour enrichir les stats de trajet
function recordHarshEvent(imei, type) {
  const state = tripState.get(imei);
  if (!state?.tripId) return;
  if (type === 'harsh_brake') state.harshBrakes = (state.harshBrakes||0) + 1;
  if (type === 'harsh_accel') state.harshAccels = (state.harshAccels||0) + 1;
  tripState.set(imei, state);
}

module.exports = { processPosition, recordHarshEvent };
