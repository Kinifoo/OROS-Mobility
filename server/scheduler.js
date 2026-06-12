/**
 * OROS — Planificateur de tâches
 * - 07h45: notification recette J-1 aux gestionnaires
 * - Rappels toutes les 30min si non validé
 * - 10h00: immobilisation automatique si toujours impayé
 * - Nettoyage quotidien
 */
'use strict';

const cron = require('node-cron');
const { pool } = require('./database');
const { sendEmail, sendSMS, templates } = require('./notification');
const logger = require('./utils/logger');

let broadcaster = null;
function setBroadcaster(fn) { broadcaster = fn; }

// ── 07h45 — Notification recette J-1 ─────────────────────────────────
cron.schedule('45 7 * * *', async () => {
  logger.info('[SCHEDULER] 07h45 — Vérification recettes J-1');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];

  try {
    // Véhicules actifs sans recette validée hier
    const r = await pool.query(`
      SELECT v.id AS vehicle_id, v.plate, v.brand, v.model, v.daily_target,
             d.name AS driver_name, d.phone AS driver_phone,
             u.email AS manager_email, u.phone AS manager_phone,
             u.name AS manager_name
      FROM vehicles v
      LEFT JOIN assignments a ON a.vehicle_id=v.id AND a.ended_at IS NULL
      LEFT JOIN drivers d ON d.id=a.driver_id
      LEFT JOIN users u ON u.role IN ('admin','manager') AND u.active=true
      WHERE v.active=true AND v.status='active'
        AND NOT EXISTS (
          SELECT 1 FROM revenues rv
          WHERE rv.vehicle_id=v.id AND rv.date=$1 AND rv.validated=true
        )
    `, [dateStr]);

    logger.info(`[SCHEDULER] ${r.rows.length} véhicule(s) sans recette pour ${dateStr}`);

    for (const row of r.rows) {
      const label = `${row.brand} ${row.model} (${row.plate})`;

      // Créer un enregistrement d'immobilisation pending
      await pool.query(`
        INSERT INTO auto_immobilization(vehicle_id,date,status)
        VALUES($1,$2,'pending')
        ON CONFLICT(vehicle_id,date) DO NOTHING
      `, [row.vehicle_id, dateStr]);

      // Notifier le gestionnaire
      if (row.manager_email) {
        const tpl = templates.revenueCheck(label, row.driver_name||'N/A', dateStr);
        await sendEmail({ to: row.manager_email, ...tpl });
      }
      if (row.manager_phone) {
        const tpl = templates.revenueCheck(label, row.driver_name||'N/A', dateStr);
        await sendSMS({ to: row.manager_phone, message: tpl.sms });
      }

      // Push WebSocket vers le dashboard
      if (broadcaster) {
        broadcaster({
          type: 'revenue_check',
          vehicleId: row.vehicle_id,
          plate: row.plate,
          date: dateStr,
          driverName: row.driver_name,
        });
      }
    }
  } catch (e) {
    logger.error('[SCHEDULER] Erreur 07h45: ' + e.message);
  }
}, { timezone: 'Africa/Abidjan' });

// ── Toutes les 30min (08h00 → 09h30): rappels conducteur ─────────────
cron.schedule('0,30 8,9 * * *', async () => {
  logger.info('[SCHEDULER] Rappel recette — vérification');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];

  const now = new Date();
  const hoursLeft = 10 - now.getHours() - now.getMinutes()/60;
  const countdown = hoursLeft > 1 ? `${Math.round(hoursLeft)}h` : `${Math.round(hoursLeft*60)}min`;

  try {
    const r = await pool.query(`
      SELECT ai.id, ai.vehicle_id, v.plate, v.brand, v.model,
             d.name AS driver_name, d.phone AS driver_phone
      FROM auto_immobilization ai
      JOIN vehicles v ON v.id=ai.vehicle_id
      LEFT JOIN assignments a ON a.vehicle_id=v.id AND a.ended_at IS NULL
      LEFT JOIN drivers d ON d.id=a.driver_id
      WHERE ai.date=$1 AND ai.status='pending'
    `, [dateStr]);

    for (const row of r.rows) {
      if (row.driver_phone) {
        const label = `${row.brand} ${row.model} (${row.plate})`;
        const tpl = templates.driverWarning(row.driver_name||'Conducteur', label, countdown);
        await sendSMS({ to: row.driver_phone, message: tpl.sms });
        logger.info(`[SCHEDULER] Rappel → ${row.driver_phone} (${label})`);
      }
    }
  } catch (e) {
    logger.error('[SCHEDULER] Erreur rappel: ' + e.message);
  }
}, { timezone: 'Africa/Abidjan' });

// ── 09h30 — Avertissement final ───────────────────────────────────────
cron.schedule('30 9 * * *', async () => {
  logger.warn('[SCHEDULER] 09h30 — Avertissement final avant immobilisation');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];

  try {
    const r = await pool.query(`
      SELECT ai.vehicle_id, v.plate, v.brand, v.model,
             d.name AS driver_name, d.phone AS driver_phone
      FROM auto_immobilization ai
      JOIN vehicles v ON v.id=ai.vehicle_id
      LEFT JOIN assignments a ON a.vehicle_id=v.id AND a.ended_at IS NULL
      LEFT JOIN drivers d ON d.id=a.driver_id
      WHERE ai.date=$1 AND ai.status='pending'
    `, [dateStr]);

    for (const row of r.rows) {
      if (row.driver_phone) {
        const label = `${row.brand} ${row.model} (${row.plate})`;
        const tpl = templates.immobilizationWarning(row.driver_name||'Conducteur', label);
        await sendSMS({ to: row.driver_phone, message: tpl.sms });
      }
    }
  } catch (e) {
    logger.error('[SCHEDULER] Erreur avertissement final: ' + e.message);
  }
}, { timezone: 'Africa/Abidjan' });

// ── 10h00 — IMMOBILISATION AUTOMATIQUE ───────────────────────────────
cron.schedule('0 10 * * *', async () => {
  logger.warn('[SCHEDULER] 10h00 — IMMOBILISATION AUTOMATIQUE');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];

  try {
    const r = await pool.query(`
      SELECT ai.id, ai.vehicle_id, v.plate, v.brand, v.model,
             d2.imei, d.name AS driver_name, d.phone AS driver_phone,
             u.email AS manager_email
      FROM auto_immobilization ai
      JOIN vehicles v ON v.id=ai.vehicle_id
      LEFT JOIN devices d2 ON d2.id=v.device_id AND d2.active=true
      LEFT JOIN assignments a ON a.vehicle_id=v.id AND a.ended_at IS NULL
      LEFT JOIN drivers d ON d.id=a.driver_id
      LEFT JOIN users u ON u.role IN ('admin','manager') AND u.active=true
      WHERE ai.date=$1 AND ai.status='pending'
        AND (ai.extended_until IS NULL OR ai.extended_until < NOW())
    `, [dateStr]);

    logger.warn(`[SCHEDULER] ${r.rows.length} véhicule(s) à immobiliser`);

    for (const row of r.rows) {
      const label = `${row.brand} ${row.model} (${row.plate})`;

      // Envoyer ENGINE CUT via WebSocket → TCP Manager
      if (row.imei && broadcaster) {
        broadcaster({ type: 'send_command', imei: row.imei, command: 'engine_cut' });
        await pool.query("UPDATE devices SET status='immobilized' WHERE imei=$1", [row.imei]);
        logger.warn(`[SCHEDULER] ENGINE CUT envoyé → ${row.imei}`);
      }

      // Marquer comme immobilisé
      await pool.query(`
        UPDATE auto_immobilization SET status='immobilized', immobilized_at=NOW()
        WHERE id=$1
      `, [row.id]);

      // Notifier gestionnaire + conducteur
      const tpl = templates.immobilizationDone(label, row.driver_name||'N/A');
      if (row.manager_email) await sendEmail({ to: row.manager_email, ...tpl });
      if (row.driver_phone) await sendSMS({ to: row.driver_phone, message: tpl.sms });

      // Push dashboard
      if (broadcaster) {
        broadcaster({ type: 'auto_immobilized', plate: row.plate, vehicleId: row.vehicle_id });
      }

      // Log l'événement
      await pool.query(
        "INSERT INTO events(device_id,imei,event_type,severity,data) SELECT id,$1,'auto_immobilized','critical',$2 FROM devices WHERE imei=$1",
        [row.imei, JSON.stringify({ plate: row.plate, date: dateStr })]
      );
    }
  } catch (e) {
    logger.error('[SCHEDULER] Erreur immobilisation: ' + e.message);
  }
}, { timezone: 'Africa/Abidjan' });

// ── Minuit — Nettoyage et maintenance ─────────────────────────────────
cron.schedule('0 0 * * *', async () => {
  logger.info('[SCHEDULER] Minuit — Maintenance quotidienne');
  try {
    // Réinitialiser les immobilisations auto expirées (véhicules réactivés)
    await pool.query(`
      UPDATE devices SET status='offline'
      WHERE status='immobilized'
        AND NOT EXISTS (
          SELECT 1 FROM auto_immobilization ai
          JOIN vehicles v ON v.id=ai.vehicle_id
          WHERE v.device_id=devices.id
            AND ai.status='immobilized'
            AND ai.date >= CURRENT_DATE - 1
        )
    `);

    // Marquer les traceurs sans activité depuis 10min comme offline
    await pool.query(`
      UPDATE devices SET status='offline'
      WHERE status='online' AND last_seen < NOW() - INTERVAL '10 minutes'
    `);

    logger.info('[SCHEDULER] Maintenance OK');
  } catch (e) {
    logger.error('[SCHEDULER] Erreur maintenance: ' + e.message);
  }
}, { timezone: 'Africa/Abidjan' });

// ── Prorogation accordée par gestionnaire ─────────────────────────────
async function grantExtension(vehicleId, date, until, grantedBy) {
  try {
    await pool.query(`
      UPDATE auto_immobilization
      SET extended_until=$1, extended_by=$2, status='extended'
      WHERE vehicle_id=$3 AND date=$4
    `, [until, grantedBy, vehicleId, date]);

    // Réactiver le moteur si déjà immobilisé
    const r = await pool.query(`
      SELECT d.imei, dr.name AS driver_name, dr.phone AS driver_phone,
             v.plate, v.brand, v.model
      FROM vehicles v
      JOIN devices d ON d.id=v.device_id
      LEFT JOIN assignments a ON a.vehicle_id=v.id AND a.ended_at IS NULL
      LEFT JOIN drivers dr ON dr.id=a.driver_id
      WHERE v.id=$1
    `, [vehicleId]);

    if (r.rows[0]) {
      const row = r.rows[0];
      if (broadcaster) broadcaster({ type: 'send_command', imei: row.imei, command: 'engine_restore' });
      await pool.query("UPDATE devices SET status='online' WHERE imei=$1", [row.imei]);

      const untilStr = new Date(until).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
      const tpl = templates.extensionGranted(row.driver_name||'Conducteur', `${row.brand} ${row.model} (${row.plate})`, untilStr);
      if (row.driver_phone) await sendSMS({ to: row.driver_phone, message: tpl.sms });

      logger.info(`[SCHEDULER] Prorogation accordée — véhicule ${vehicleId} jusqu'à ${until}`);
    }
    return { success: true };
  } catch (e) {
    logger.error('[SCHEDULER] Erreur prorogation: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ── Validation recette par gestionnaire ───────────────────────────────
async function validateRevenue(vehicleId, date, validatedBy) {
  try {
    await pool.query(`
      UPDATE auto_immobilization SET status='validated', validated_at=NOW(), validated_by=$1
      WHERE vehicle_id=$2 AND date=$3
    `, [validatedBy, vehicleId, date]);

    // Réactiver si immobilisé
    const r = await pool.query('SELECT d.imei FROM vehicles v JOIN devices d ON d.id=v.device_id WHERE v.id=$1', [vehicleId]);
    if (r.rows[0]?.imei) {
      if (broadcaster) broadcaster({ type: 'send_command', imei: r.rows[0].imei, command: 'engine_restore' });
      await pool.query("UPDATE devices SET status='online' WHERE imei=$1", [r.rows[0].imei]);
    }
    logger.info(`[SCHEDULER] Recette validée — véhicule ${vehicleId}`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { setBroadcaster, grantExtension, validateRevenue };

// ── Lundi 08h30 — Rapport coaching hebdomadaire ─────────────────────
const cron = require('node-cron');
cron.schedule('30 8 * * 1', async () => {
  const { sendWeeklyCoachingReport } = require('./driver-coaching');
  const { computeAndAwardBadges }    = require('./gamification');
  const { pool: p } = require('./database');

  logger.info('[SCHEDULER] Lundi 08h30 — Coaching + Badges hebdo');
  try {
    await sendWeeklyCoachingReport();
    const drivers = await p.query('SELECT id FROM drivers WHERE active=true');
    for (const d of drivers.rows) await computeAndAwardBadges(d.id);
    logger.info('[SCHEDULER] Coaching + Badges OK');
  } catch(e) { logger.error('[SCHEDULER] Coaching: '+e.message); }
}, { timezone: 'Africa/Abidjan' });
