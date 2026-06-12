/**
 * OROS — Workflow SOS complet
 * Bouton panique → escalade → suivi en temps réel
 */
'use strict';

const { pool } = require('./database');
const { sendSMS, sendEmail } = require('./notification');
const logger   = require('./utils/logger');

let broadcaster = null;
function setBroadcaster(fn) { broadcaster = fn; }

async function initSosTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sos_incidents (
      id            SERIAL PRIMARY KEY,
      device_id     INTEGER REFERENCES devices(id),
      imei          TEXT NOT NULL,
      lat           DOUBLE PRECISION,
      lon           DOUBLE PRECISION,
      status        TEXT DEFAULT 'active',
      acknowledged  BOOLEAN DEFAULT false,
      acknowledged_by INTEGER REFERENCES users(id),
      resolved_at   TIMESTAMPTZ,
      resolved_by   INTEGER REFERENCES users(id),
      notes         TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
}

// ── Déclencher le workflow SOS ─────────────────────────────────────────
async function triggerSOS(imei, lat, lon) {
  logger.warn(`🆘 SOS DÉCLENCHÉ: ${imei} @ ${lat},${lon}`);

  try {
    const r = await pool.query(`
      SELECT d.id AS device_id, d.name AS device_name,
             v.plate, v.brand, v.model,
             dr.name AS driver_name, dr.phone AS driver_phone,
             u.name AS manager_name, u.email AS manager_email, u.phone AS manager_phone
      FROM devices d
      LEFT JOIN vehicles v ON v.device_id=d.id AND v.active=true
      LEFT JOIN assignments a ON a.vehicle_id=v.id AND a.ended_at IS NULL
      LEFT JOIN drivers dr ON dr.id=a.driver_id
      LEFT JOIN users u ON u.role IN ('admin','manager','superadmin') AND u.active=true
      WHERE d.imei=$1 LIMIT 1
    `, [imei]);

    const info = r.rows[0] || {};
    const label = info.plate ? `${info.plate} (${info.driver_name||'?'})` : imei;
    const mapsUrl = `https://maps.google.com/?q=${lat},${lon}`;

    // Enregistrer l'incident
    const incident = await pool.query(`
      INSERT INTO sos_incidents(device_id, imei, lat, lon)
      VALUES($1,$2,$3,$4) RETURNING id
    `, [info.device_id, imei, lat, lon]);
    const incidentId = incident.rows[0]?.id;

    // SMS gestionnaire — URGENT
    const smsManager = `🆘 SOS URGENT! ${label} a appuyé sur le bouton panique. Position: ${mapsUrl} — Contactez immédiatement.`;
    if (info.manager_phone) await sendSMS({ to: info.manager_phone, message: smsManager });

    // Email gestionnaire avec carte
    if (info.manager_email) {
      await sendEmail({
        to: info.manager_email,
        subject: `🆘 SOS URGENT — ${label}`,
        html: `
          <div style="background:#DC2626;color:#fff;padding:20px;text-align:center;border-radius:8px 8px 0 0">
            <h1 style="margin:0">🆘 ALERTE SOS</h1>
          </div>
          <div style="padding:20px;font-family:Arial">
            <p><strong>Véhicule:</strong> ${label}</p>
            <p><strong>Conducteur:</strong> ${info.driver_name||'Non identifié'}</p>
            <p><strong>Téléphone:</strong> ${info.driver_phone||'—'}</p>
            <p><strong>Position:</strong> ${lat?.toFixed(5)}, ${lon?.toFixed(5)}</p>
            <p><a href="${mapsUrl}" style="background:#1E6FD9;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin:10px 0">📍 Voir sur Google Maps</a></p>
            <p><strong>Incident #${incidentId} — ${new Date().toLocaleString('fr-FR')}</strong></p>
            <hr>
            <p style="color:#666;font-size:12px">Connectez-vous à Oros Mobility pour suivre le véhicule en temps réel et clôturer l'incident.</p>
          </div>
        `
      });
    }

    // Broadcast dashboard — affiche modal SOS rouge
    if (broadcaster) {
      broadcaster({
        type: 'sos_alert',
        incidentId,
        imei,
        label,
        lat, lon,
        mapsUrl,
        driverName:   info.driver_name,
        driverPhone:  info.driver_phone,
        timestamp:    new Date().toISOString(),
      });
    }

    return { incidentId, label, lat, lon };
  } catch (e) {
    logger.error('[SOS] ' + e.message);
    return null;
  }
}

async function getActiveIncidents() {
  const r = await pool.query(`
    SELECT s.*, d.name AS device_name, v.plate, dr.name AS driver_name, u.name AS ack_by
    FROM sos_incidents s
    LEFT JOIN devices d ON d.id=s.device_id
    LEFT JOIN vehicles v ON v.device_id=d.id AND v.active=true
    LEFT JOIN assignments a ON a.vehicle_id=v.id AND a.ended_at IS NULL
    LEFT JOIN drivers dr ON dr.id=a.driver_id
    LEFT JOIN users u ON u.id=s.acknowledged_by
    WHERE s.resolved_at IS NULL
    ORDER BY s.created_at DESC
  `).catch(()=>({rows:[]}));
  return r.rows;
}

async function acknowledgeIncident(incidentId, userId) {
  await pool.query('UPDATE sos_incidents SET acknowledged=true, acknowledged_by=$1 WHERE id=$2', [userId, incidentId]);
}

async function resolveIncident(incidentId, userId, notes) {
  await pool.query('UPDATE sos_incidents SET resolved_at=NOW(), resolved_by=$1, notes=$2, status=$3 WHERE id=$4',
    [userId, notes, 'resolved', incidentId]);
  logger.info(`[SOS] Incident #${incidentId} clôturé par user #${userId}`);
}

initSosTable();
module.exports = { triggerSOS, getActiveIncidents, acknowledgeIncident, resolveIncident, setBroadcaster };
