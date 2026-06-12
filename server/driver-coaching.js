/**
 * OROS — Coaching conducteur IA temps réel
 * Analyse le comportement en continu et envoie des recommandations
 * SMS / notification app immédiate après chaque événement
 *
 * Inspiré de Samsara AI Coaching & Motive Safety Hub
 */
'use strict';

const { pool }                       = require('./database');
const { sendSMS, sendEmail, templates } = require('./notification');
const logger                          = require('./utils/logger');

// Fenêtre glissante par traceur : derniers N événements
const coachingState = new Map();

// Seuils de coaching
const THRESHOLDS = {
  harsheventsPer100km:  3,   // > 3 événements/100km = coaching
  speedingMinPerTrip:   5,   // > 5 min en excès = coaching
  continuousDrivingH:   4,   // > 4h sans pause = alerte fatigue
  nightDrivingStart:    22,  // > 22h = conduite de nuit
  scoreDropPerWeek:    -10,  // Chute du score > 10pts/semaine
};

// Messages de coaching (en français pour CI)
const COACHING_MESSAGES = {
  harsh_brake:   (count) => `⚠️ Oros Coach: ${count} freinage(s) brusque(s) détecté(s) aujourd'hui. Anticipez davantage pour ménager le véhicule et réduire les risques.`,
  harsh_accel:   (count) => `⚠️ Oros Coach: Accélération brusque détectée (${count}x). Une conduite souple économise jusqu'à 20% de carburant.`,
  overspeed:     (spd,lim)=> `🚨 Oros Coach: Vitesse excessive (${spd}km/h, limite ${lim}km/h). Ralentissez immédiatement.`,
  fatigue:       (h)      => `😴 Oros Coach: ${h}h de conduite continue sans pause. Prenez une pause de 20min — votre sécurité et celle des passagers en dépend.`,
  night_driving: ()       => `🌙 Oros Coach: Conduite de nuit active. Soyez particulièrement vigilant, augmentez les distances de sécurité.`,
  good_driving:  (score)  => `🏆 Oros Coach: Excellent score de conduite aujourd'hui (${score}/100) ! Continuez comme ça.`,
  weekly_top:    (rank)   => `🥇 Oros Coach: Vous êtes #${rank} au classement conducteurs cette semaine ! Belle performance.`,
  score_drop:    (drop)   => `📉 Oros Coach: Votre score a baissé de ${Math.abs(drop)} points cette semaine. Consultez votre tableau de bord pour les détails.`,
};

// ── Analyser un événement et décider si coaching nécessaire ───────────
async function analyzeEvent(imei, eventType, data = {}) {
  try {
    // Récupérer le conducteur affecté
    const r = await pool.query(`
      SELECT dr.id, dr.name, dr.phone, dr.email, d.max_speed
      FROM devices d
      LEFT JOIN vehicles v ON v.device_id = d.id AND v.active = true
      LEFT JOIN assignments a ON a.vehicle_id = v.id AND a.ended_at IS NULL
      LEFT JOIN drivers dr ON dr.id = a.driver_id
      WHERE d.imei = $1 AND dr.phone IS NOT NULL
    `, [imei]);

    if (!r.rows[0]?.phone) return; // Pas de conducteur ou pas de téléphone
    const driver = r.rows[0];

    const state = coachingState.get(imei) || {
      harshEvents: 0, overspeeds: 0, drivingStartTime: null,
      lastCoachingAt: null, lastScore: null
    };

    // Anti-spam : max 1 message coaching par 30 min
    const canSend = !state.lastCoachingAt ||
      (Date.now() - state.lastCoachingAt) > 30 * 60 * 1000;

    let msg = null;

    switch (eventType) {
      case 'harsh_brake':
        state.harshEvents = (state.harshEvents || 0) + 1;
        if (canSend && state.harshEvents >= 2) {
          msg = COACHING_MESSAGES.harsh_brake(state.harshEvents);
        }
        break;

      case 'harsh_accel':
        state.harshEvents = (state.harshEvents || 0) + 1;
        if (canSend && state.harshEvents >= 3) {
          msg = COACHING_MESSAGES.harsh_accel(state.harshEvents);
        }
        break;

      case 'overspeed':
        state.overspeeds = (state.overspeeds || 0) + 1;
        if (canSend) {
          msg = COACHING_MESSAGES.overspeed(data.speed, driver.max_speed || 100);
        }
        break;

      case 'engine_on':
        state.drivingStartTime = new Date();
        state.harshEvents = 0;
        state.overspeeds = 0;
        break;

      case 'engine_off':
        state.drivingStartTime = null;
        break;
    }

    // Vérification fatigue (conduite continue)
    if (state.drivingStartTime) {
      const drivingHours = (Date.now() - state.drivingStartTime) / 3600000;
      if (canSend && drivingHours >= THRESHOLDS.continuousDrivingH) {
        msg = COACHING_MESSAGES.fatigue(Math.round(drivingHours));
      }
    }

    // Envoi du message de coaching
    if (msg && driver.phone) {
      await sendSMS({ to: driver.phone, message: msg });
      state.lastCoachingAt = Date.now();
      logger.info(`[Coach] → ${driver.name} (${driver.phone}): ${msg.slice(0,60)}...`);

      // Sauvegarder en DB
      await pool.query(`
        INSERT INTO coaching_messages(driver_id, imei, event_type, message)
        VALUES($1,$2,$3,$4)
      `, [driver.id, imei, eventType, msg]).catch(() => {});
    }

    coachingState.set(imei, state);
  } catch (e) {
    logger.error('[Coach] ' + e.message);
  }
}

// ── Rapport hebdomadaire coaching (cron tous les lundis 08h) ──────────
async function sendWeeklyCoachingReport() {
  try {
    const r = await pool.query(`
      SELECT dr.id, dr.name, dr.phone, dr.email,
             ROUND(AVG(t.driving_score)) AS avg_score,
             COUNT(t.id) AS trip_count,
             SUM(t.harsh_brakes) AS total_brakes,
             SUM(t.over_speed_count) AS total_speeds,
             RANK() OVER (ORDER BY AVG(t.driving_score) DESC) AS rank
      FROM drivers dr
      LEFT JOIN assignments a ON a.driver_id = dr.id
      LEFT JOIN vehicles v ON v.id = a.vehicle_id AND v.active = true
      LEFT JOIN trips t ON t.device_id = v.device_id
        AND t.start_time > NOW() - INTERVAL '7 days'
        AND t.end_time IS NOT NULL
      WHERE dr.active = true AND dr.phone IS NOT NULL
      GROUP BY dr.id, dr.name, dr.phone, dr.email
      HAVING COUNT(t.id) > 0
    `);

    for (const row of r.rows) {
      const score = parseInt(row.avg_score) || 0;

      // Top 3 → message de félicitation
      if (row.rank <= 3) {
        await sendSMS({ to: row.phone, message: COACHING_MESSAGES.weekly_top(row.rank) });
      }
      // Score excellent
      else if (score >= 85) {
        await sendSMS({ to: row.phone, message: COACHING_MESSAGES.good_driving(score) });
      }
    }
    logger.info(`[Coach] Rapports hebdo envoyés à ${r.rows.length} conducteurs`);
  } catch (e) {
    logger.error('[Coach] Rapport hebdo: ' + e.message);
  }
}

// Créer la table coaching_messages si elle n'existe pas
async function initCoachingTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS coaching_messages (
      id         SERIAL PRIMARY KEY,
      driver_id  INTEGER REFERENCES drivers(id),
      imei       TEXT,
      event_type TEXT,
      message    TEXT,
      sent_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});
}

initCoachingTable();

module.exports = { analyzeEvent, sendWeeklyCoachingReport };
