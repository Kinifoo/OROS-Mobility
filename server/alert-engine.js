/**
 * OROS — Moteur d'alertes temps réel
 * Analyse chaque position reçue et génère des événements
 */
'use strict';

const { pool, saveEvent } = require('./database');
const aiAlerts = require('./ai-alert-engine');
const logger = require('./utils/logger');

// État mémoire par traceur (évite d'interroger la DB à chaque trame)
const deviceState = new Map();
// {imei: {lastPos, inGeofences:Set, offlineTimer, prevIgnition}}

// ── Seuils configurables (peuvent venir de la DB plus tard) ──────────
const OVERSPEED_DEFAULT   = 100; // km/h
const OFFLINE_TIMEOUT_MS  = 5 * 60 * 1000; // 5 min sans trame = hors ligne
const IDLE_TIMEOUT_MS     = 3 * 60 * 1000; // 3 min moteur coupé = arrêt

let broadcaster = null;
function setBroadcaster(fn) {
  broadcaster = fn;
  aiAlerts.setBroadcaster(fn);
}

function emit(type, imei, data = {}) {
  // Nouveau moteur IA — traitement intelligent
  aiAlerts.processAlert(type, imei, data).catch(()=>{});
  // Fallback broadcast direct pour compatibilité
  if (broadcaster) broadcaster({ type: 'alert', eventType: type, imei, ...data });
}

// ── Analyse principale ────────────────────────────────────────────────
async function analyzePosition(pos) {
  const { imei, speed, ignition, lat, lon, battery, timestamp } = pos;

  const state = deviceState.get(imei) || {
    lastPos: null, inGeofences: new Set(),
    offlineTimer: null, status: 'offline', prevIgnition: false,
    tripStartTime: null, tripStartLat: null, tripStartLon: null,
    speedSamples: [], harshEvents: 0
  };

  // 1. Survitesse ─────────────────────────────────────────────────────
  const maxSpeed = await getMaxSpeed(imei);
  if (speed > maxSpeed) {
    await saveEvent({ imei, eventType: 'overspeed', data: { speed, limit: maxSpeed, lat, lon } });
    emit('overspeed', imei, { speed, limit: maxSpeed });
    logger.warn(`[ALERTE] Survitesse ${imei}: ${speed}km/h (limite ${maxSpeed}km/h)`);
  }

  // 2. Batterie faible (< 10%) ────────────────────────────────────────
  if (battery !== null && battery !== undefined && battery < 10 && battery > 0) {
    const prev = state.lastPos;
    if (!prev || prev.battery >= 10) {
      await saveEvent({ imei, eventType: 'low_battery', data: { battery, lat, lon } });
      emit('low_battery', imei, { battery });
    }
  }

  // 3. Coupure alimentation (battery → 0 brusquement) ─────────────────
  if (state.lastPos && state.lastPos.battery > 20 && battery === 0) {
    await saveEvent({ imei, eventType: 'power_cut', data: { lat, lon } });
    emit('power_cut', imei, { lat, lon });
  }

  // 4. Allumage / extinction moteur ──────────────────────────────────
  if (state.prevIgnition !== undefined && state.prevIgnition !== ignition) {
    const eventType = ignition ? 'engine_on' : 'engine_off';
    await saveEvent({ imei, eventType, data: { lat, lon } });
  }

  // 5. Freinage brusque / accélération (score conducteur) ─────────────
  if (state.lastPos && state.lastPos.speed > 0 && speed > 0) {
    const dt = (new Date(timestamp) - new Date(state.lastPos.timestamp)) / 1000; // secondes
    if (dt > 0 && dt < 30) {
      const accel = (speed - state.lastPos.speed) / dt * (1000 / 3600); // m/s²
      if (accel < -3.5) { // freinage brusque
        state.harshEvents = (state.harshEvents || 0) + 1;
        await saveEvent({ imei, eventType: 'harsh_brake', data: { accel: accel.toFixed(2), speed, lat, lon } });
        emit('harsh_brake', imei, { accel });
      } else if (accel > 3.0) { // accélération brusque
        state.harshEvents = (state.harshEvents || 0) + 1;
        await saveEvent({ imei, eventType: 'harsh_accel', data: { accel: accel.toFixed(2), speed, lat, lon } });
      }
    }
  }

  // 6. Géofences ──────────────────────────────────────────────────────
  await checkGeofences(imei, lat, lon, state);

  // 7. Timer hors-ligne ───────────────────────────────────────────────
  if (state.offlineTimer) clearTimeout(state.offlineTimer);
  state.offlineTimer = setTimeout(async () => {
    await pool.query("UPDATE devices SET status='offline' WHERE imei=$1", [imei]);
    await saveEvent({ imei, eventType: 'offline', data: { lastSeen: new Date() } });
    emit('offline', imei, {});
    if (broadcaster) broadcaster({ type: 'device_offline', imei });
    logger.warn(`[ALERTE] Traceur hors ligne: ${imei}`);
  }, OFFLINE_TIMEOUT_MS);

  // Coaching IA temps réel
  try {
    const { analyzeEvent } = require('./driver-coaching');
    await analyzeEvent(imei, 'harsh_brake', { speed });
  } catch(e) {}

  // Mise à jour de l'état mémoire
  state.lastPos = { ...pos, timestamp };
  state.prevIgnition = ignition;
  deviceState.set(imei, state);
}

// ── Géofences ─────────────────────────────────────────────────────────
async function checkGeofences(imei, lat, lon, state) {
  try {
    const gfs = await pool.query('SELECT * FROM geofences WHERE active=true');
    for (const gf of gfs.rows) {
      const inside = isInsideGeofence(lat, lon, gf);
      const wasInside = state.inGeofences.has(gf.id);
      if (inside && !wasInside) {
        state.inGeofences.add(gf.id);
        if (gf.alert_enter) {
          await saveEvent({ imei, eventType: 'enter_fence', data: { geofence: gf.name, lat, lon } });
          emit('enter_fence', imei, { geofence: gf.name });
          logger.info(`[GEO] ${imei} entre dans "${gf.name}"`);
        }
      } else if (!inside && wasInside) {
        state.inGeofences.delete(gf.id);
        if (gf.alert_exit) {
          await saveEvent({ imei, eventType: 'exit_fence', data: { geofence: gf.name, lat, lon } });
          emit('exit_fence', imei, { geofence: gf.name });
          logger.info(`[GEO] ${imei} sort de "${gf.name}"`);
        }
      }
    }
  } catch (e) {
    logger.error('[AlertEngine] Erreur géofences: ' + e.message);
  }
}

function isInsideGeofence(lat, lon, gf) {
  if (gf.type === 'circle') {
    const d = haversine(lat, lon, gf.lat, gf.lon);
    return d <= (gf.radius || 500);
  }
  if (gf.type === 'polygon' && gf.coordinates) {
    const coords = typeof gf.coordinates === 'string' ? JSON.parse(gf.coordinates) : gf.coordinates;
    return pointInPolygon(lat, lon, coords);
  }
  return false;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function pointInPolygon(lat, lon, coords) {
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = coords[i].lon, yi = coords[i].lat;
    const xj = coords[j].lon, yj = coords[j].lat;
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

async function getMaxSpeed(imei) {
  try {
    const r = await pool.query('SELECT max_speed FROM devices WHERE imei=$1', [imei]);
    return r.rows[0]?.max_speed || OVERSPEED_DEFAULT;
  } catch (e) { return OVERSPEED_DEFAULT; }
}

// Nettoyage état (appelé à la déconnexion)
function clearDeviceState(imei) {
  const s = deviceState.get(imei);
  if (s?.offlineTimer) clearTimeout(s.offlineTimer);
  deviceState.delete(imei);
}

module.exports = { analyzePosition, clearDeviceState, setBroadcaster, haversine };
