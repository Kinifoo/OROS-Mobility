/**
 * OROS — Score conducteur
 * Calcule un score de conduite complet basé sur:
 * - Fréquence de frenages brusques
 * - Accélérations excessives
 * - Dépassements de vitesse
 * - Durée de conduite continue
 * - Respect des horaires
 */
'use strict';

const { pool } = require('./database');
const logger = require('./utils/logger');

/**
 * Score global pour un conducteur sur une période
 * Retourne un score de 0-100 avec détail par catégorie
 */
async function getDriverScore(driverId, fromDate, toDate) {
  try {
    // Récupérer tous les trajets du conducteur sur la période
    const r = await pool.query(`
      SELECT t.*, d.max_speed AS speed_limit
      FROM trips t
      JOIN devices d ON d.id=t.device_id
      JOIN vehicles v ON v.device_id=d.id AND v.active=true
      JOIN assignments a ON a.vehicle_id=v.id AND a.driver_id=$1
        AND t.start_time BETWEEN a.started_at AND COALESCE(a.ended_at, NOW())
      WHERE t.start_time BETWEEN $2 AND $3
        AND t.end_time IS NOT NULL
        AND t.distance > 0.1
      ORDER BY t.start_time
    `, [driverId, fromDate || 'NOW() - INTERVAL 30 days', toDate || 'NOW()']);

    const trips = r.rows;
    if (!trips.length) return null;

    // Calcul des KPIs agrégés
    const totalKm      = trips.reduce((s, t) => s + (t.distance||0), 0);
    const totalMin     = trips.reduce((s, t) => s + (t.duration_minutes||0), 0);
    const totalBrakes  = trips.reduce((s, t) => s + (t.harsh_brakes||0), 0);
    const totalAccels  = trips.reduce((s, t) => s + (t.harsh_accels||0), 0);
    const totalOvSpeed = trips.reduce((s, t) => s + (t.over_speed_count||0), 0);
    const maxSpeed     = trips.reduce((max, t) => Math.max(max, t.max_speed||0), 0);
    const avgSpeed     = trips.reduce((s, t) => s + (t.avg_speed||0), 0) / trips.length;

    // Fréquence par 100km (normalisation)
    const brakePer100km  = totalKm > 0 ? (totalBrakes  / totalKm * 100) : 0;
    const accelPer100km  = totalKm > 0 ? (totalAccels  / totalKm * 100) : 0;
    const speedPer100km  = totalKm > 0 ? (totalOvSpeed / totalKm * 100) : 0;

    // Scores par catégorie (0-100 chacun)
    const scoreVitesse     = Math.max(0, 100 - Math.min(100, speedPer100km  * 8));
    const scoreFreinage    = Math.max(0, 100 - Math.min(100, brakePer100km  * 10));
    const scoreAcceleration= Math.max(0, 100 - Math.min(100, accelPer100km  * 8));
    const scoreVitesseMoy  = maxSpeed <= 130 ? 100 : Math.max(0, 100 - (maxSpeed - 130) * 2);

    // Score global pondéré
    const scoreGlobal = Math.round(
      scoreVitesse      * 0.35 +
      scoreFreinage     * 0.25 +
      scoreAcceleration * 0.25 +
      scoreVitesseMoy   * 0.15
    );

    const grade = scoreGlobal >= 90 ? 'A' : scoreGlobal >= 75 ? 'B' : scoreGlobal >= 60 ? 'C' : scoreGlobal >= 40 ? 'D' : 'F';

    return {
      driverId,
      period: { from: fromDate, to: toDate },
      scoreGlobal,
      grade,
      details: {
        vitesse:      { score: Math.round(scoreVitesse),      label: 'Respect des vitesses', poids: 35 },
        freinage:     { score: Math.round(scoreFreinage),     label: 'Qualité de freinage',  poids: 25 },
        acceleration: { score: Math.round(scoreAcceleration), label: 'Accélérations',         poids: 25 },
        vitesseMoy:   { score: Math.round(scoreVitesseMoy),   label: 'Vitesse maximale',      poids: 15 },
      },
      stats: {
        tripCount:    trips.length,
        totalKm:      Math.round(totalKm * 10) / 10,
        totalHours:   Math.round(totalMin / 60 * 10) / 10,
        maxSpeed:     Math.round(maxSpeed),
        avgSpeed:     Math.round(avgSpeed),
        harshBrakes:  totalBrakes,
        harshAccels:  totalAccels,
        overSpeeds:   totalOvSpeed,
        brakePer100km: Math.round(brakePer100km * 10) / 10,
        accelPer100km: Math.round(accelPer100km * 10) / 10,
      },
      evolution: await getScoreEvolution(driverId, 7),
      ranking: await getDriverRanking(driverId),
    };
  } catch (e) {
    logger.error('[DriverScore] Erreur: ' + e.message);
    return null;
  }
}

/**
 * Évolution du score sur les N derniers jours
 */
async function getScoreEvolution(driverId, days = 7) {
  try {
    const r = await pool.query(`
      SELECT DATE(t.start_time) AS day,
             ROUND(AVG(COALESCE(t.driving_score, 70))) AS score,
             SUM(t.distance) AS km
      FROM trips t
      JOIN vehicles v ON v.device_id=t.device_id AND v.active=true
      JOIN assignments a ON a.vehicle_id=v.id AND a.driver_id=$1
        AND t.start_time BETWEEN a.started_at AND COALESCE(a.ended_at, NOW())
      WHERE t.start_time > NOW() - ($2 || ' days')::INTERVAL
        AND t.end_time IS NOT NULL
      GROUP BY DATE(t.start_time)
      ORDER BY day
    `, [driverId, days]);
    return r.rows;
  } catch (e) { return []; }
}

/**
 * Classement du conducteur parmi tous les conducteurs
 */
async function getDriverRanking(driverId) {
  try {
    const r = await pool.query(`
      WITH scores AS (
        SELECT a.driver_id,
               ROUND(AVG(COALESCE(t.driving_score, 70))) AS score
        FROM trips t
        JOIN vehicles v ON v.device_id=t.device_id AND v.active=true
        JOIN assignments a ON a.vehicle_id=v.id
          AND t.start_time BETWEEN a.started_at AND COALESCE(a.ended_at, NOW())
        WHERE t.start_time > NOW() - INTERVAL '30 days' AND t.end_time IS NOT NULL
        GROUP BY a.driver_id
      )
      SELECT driver_id, score,
             RANK() OVER (ORDER BY score DESC) AS rank,
             COUNT(*) OVER () AS total
      FROM scores
    `);
    const me = r.rows.find(row => row.driver_id === driverId);
    return me ? { rank: parseInt(me.rank), total: parseInt(me.total), score: parseInt(me.score) } : null;
  } catch (e) { return null; }
}

/**
 * Classement global de tous les conducteurs
 */
async function getAllDriversRanking(from, to) {
  try {
    const r = await pool.query(`
      SELECT dr.id, dr.name, dr.phone,
             ROUND(AVG(COALESCE(t.driving_score, 70))) AS score,
             COUNT(t.id) AS trip_count,
             SUM(t.distance) AS total_km,
             SUM(t.harsh_brakes) AS total_brakes,
             SUM(t.over_speed_count) AS total_overspeeds,
             MAX(t.max_speed) AS peak_speed
      FROM drivers dr
      LEFT JOIN assignments a ON a.driver_id=dr.id
      LEFT JOIN vehicles v ON v.id=a.vehicle_id AND v.active=true
      LEFT JOIN trips t ON t.device_id=v.device_id
        AND t.start_time BETWEEN $1 AND $2
        AND t.end_time IS NOT NULL
      WHERE dr.active=true
      GROUP BY dr.id, dr.name, dr.phone
      ORDER BY score DESC NULLS LAST
    `, [from || 'NOW() - INTERVAL 30 days', to || 'NOW()']);

    return r.rows.map((row, idx) => ({
      rank:         idx + 1,
      driverId:     row.id,
      name:         row.name,
      score:        parseInt(row.score) || 0,
      grade:        gradeFromScore(parseInt(row.score)||0),
      tripCount:    parseInt(row.trip_count) || 0,
      totalKm:      Math.round((row.total_km||0) * 10) / 10,
      harshBrakes:  parseInt(row.total_brakes)    || 0,
      overSpeeds:   parseInt(row.total_overspeeds)|| 0,
      peakSpeed:    Math.round(row.peak_speed||0),
    }));
  } catch (e) {
    logger.error('[DriverScore] Ranking error: ' + e.message);
    return [];
  }
}

function gradeFromScore(score) {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

module.exports = { getDriverScore, getAllDriversRanking, getScoreEvolution };
