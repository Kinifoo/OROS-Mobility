/**
 * OROS — Partage de position public (lien sans login)
 * Le client VTC peut suivre son véhicule en direct via un lien URL
 * Sans compte, sans mot de passe
 */
'use strict';

const crypto = require('crypto');
const { pool } = require('./database');
const logger  = require('./utils/logger');

// ── Générer un lien de partage ─────────────────────────────────────────
async function createShareLink(deviceId, options = {}) {
  const {
    expiresInMinutes = 120, // 2h par défaut
    label = '',             // ex: "Taxi AB 1234 CI"
    showDriver = false,
    showSpeed  = true,
    createdBy  = null,
  } = options;

  const token     = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS share_links (
      id          SERIAL PRIMARY KEY,
      token       TEXT UNIQUE NOT NULL,
      device_id   INTEGER REFERENCES devices(id),
      label       TEXT,
      show_driver BOOLEAN DEFAULT false,
      show_speed  BOOLEAN DEFAULT true,
      expires_at  TIMESTAMPTZ NOT NULL,
      view_count  INTEGER DEFAULT 0,
      created_by  INTEGER REFERENCES users(id),
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  await pool.query(`
    INSERT INTO share_links(token, device_id, label, show_driver, show_speed, expires_at, created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7)
  `, [token, deviceId, label, showDriver, showSpeed, expiresAt, createdBy]);

  logger.info(`[LiveShare] Lien créé: ${token} expire ${expiresAt.toLocaleString('fr-FR')}`);
  return { token, expiresAt, url: `/share/${token}` };
}

// ── Récupérer les données pour un lien public ────────────────────────
async function getShareData(token) {
  const r = await pool.query(`
    SELECT sl.*, d.lat, d.lon, d.speed, d.heading, d.status,
           d.last_seen, d.name AS device_name, d.imei,
           v.plate, v.brand, v.model, v.type AS vtype,
           dr.name AS driver_name
    FROM share_links sl
    JOIN devices d ON d.id = sl.device_id
    LEFT JOIN vehicles v ON v.device_id = d.id AND v.active = true
    LEFT JOIN assignments a ON a.vehicle_id = v.id AND a.ended_at IS NULL
    LEFT JOIN drivers dr ON dr.id = a.driver_id
    WHERE sl.token = $1 AND sl.expires_at > NOW()
  `, [token]);

  if (!r.rows[0]) return null;
  const row = r.rows[0];

  // Incrémenter compteur de vues
  await pool.query('UPDATE share_links SET view_count = view_count + 1 WHERE token = $1', [token]);

  return {
    label:      row.label || `${row.brand} ${row.model} — ${row.plate}` || row.device_name,
    plate:      row.plate,
    vtype:      row.vtype,
    lat:        row.lat,
    lon:        row.lon,
    speed:      row.show_speed ? row.speed : null,
    heading:    row.heading,
    status:     row.status,
    lastSeen:   row.last_seen,
    driver:     row.show_driver ? row.driver_name : null,
    expiresAt:  row.expires_at,
    viewCount:  row.view_count,
  };
}

async function revokeShareLink(token) {
  await pool.query('UPDATE share_links SET expires_at = NOW() WHERE token = $1', [token]);
}

async function getActiveShareLinks(deviceId) {
  const r = await pool.query(
    'SELECT * FROM share_links WHERE device_id = $1 AND expires_at > NOW() ORDER BY created_at DESC',
    [deviceId]
  );
  return r.rows;
}

module.exports = { createShareLink, getShareData, revokeShareLink, getActiveShareLinks };
