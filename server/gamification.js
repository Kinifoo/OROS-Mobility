/**
 * OROS — Gamification & récompenses conducteurs
 * Badges, classements, défis hebdomadaires
 * Inspiré de Azuga Driver Rewards & Samsara Safety Scores
 */
'use strict';

const { pool } = require('./database');
const logger   = require('./utils/logger');

// ── Définition des badges ──────────────────────────────────────────────
const BADGES = [
  { id:'safe_week',     label:'Semaine parfaite',   icon:'🏆', desc:'Score > 90 toute la semaine',  condition: s => s.avgScore >= 90 && s.tripCount >= 5 },
  { id:'no_speed',      label:'Zéro excès',          icon:'⚡', desc:'0 excès de vitesse sur 7 jours', condition: s => s.overSpeeds === 0 && s.tripCount >= 3 },
  { id:'smooth_driver', label:'Conduite en douceur', icon:'🌊', desc:'0 freinage brusque sur 5 trajets',condition: s => s.harshBrakes === 0 && s.tripCount >= 5 },
  { id:'early_bird',    label:'Lève-tôt',            icon:'🌅', desc:'10 départs avant 7h00',          condition: s => s.earlyStarts >= 10 },
  { id:'marathoner',    label:'Marathonien',          icon:'🏃', desc:'500 km parcourus en une semaine', condition: s => s.weeklyKm >= 500 },
  { id:'veteran',       label:'Vétéran',              icon:'🎖️', desc:'100 trajets enregistrés',        condition: s => s.totalTrips >= 100 },
  { id:'first_trip',    label:'Premier trajet',       icon:'🚀', desc:'Premier trajet enregistré',      condition: s => s.totalTrips >= 1 },
  { id:'top_scorer',    label:'Champion',             icon:'👑', desc:'#1 au classement cette semaine',  condition: s => s.weeklyRank === 1 },
  { id:'consistent',    label:'Régularité',           icon:'📈', desc:'Score > 75 pendant 4 semaines',  condition: s => s.consistentWeeks >= 4 },
  { id:'night_owl',     label:'Chouette de nuit',     icon:'🦉', desc:'20 trajets après 22h',           condition: s => s.nightTrips >= 20 },
];

// ── Calculer et attribuer les badges ──────────────────────────────────
async function computeAndAwardBadges(driverId) {
  try {
    // Stats du conducteur
    const weekR = await pool.query(`
      SELECT
        ROUND(AVG(t.driving_score)) AS avg_score,
        COUNT(t.id) AS trip_count,
        SUM(t.distance) AS weekly_km,
        SUM(t.harsh_brakes) AS harsh_brakes,
        SUM(t.over_speed_count) AS over_speeds,
        COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM t.start_time) < 7) AS early_starts,
        COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM t.start_time) >= 22) AS night_trips
      FROM trips t
      JOIN vehicles v ON v.device_id = t.device_id AND v.active = true
      JOIN assignments a ON a.vehicle_id = v.id AND a.driver_id = $1
        AND t.start_time BETWEEN a.started_at AND COALESCE(a.ended_at, NOW())
      WHERE t.start_time > NOW() - INTERVAL '7 days' AND t.end_time IS NOT NULL
    `, [driverId]);

    const totalR = await pool.query(`
      SELECT COUNT(t.id) AS total_trips
      FROM trips t
      JOIN vehicles v ON v.device_id = t.device_id AND v.active = true
      JOIN assignments a ON a.vehicle_id = v.id AND a.driver_id = $1
        AND t.start_time BETWEEN a.started_at AND COALESCE(a.ended_at, NOW())
    `, [driverId]);

    const rankR = await pool.query(`
      WITH weekly AS (
        SELECT a.driver_id, ROUND(AVG(t.driving_score)) AS score
        FROM trips t
        JOIN vehicles v ON v.device_id = t.device_id AND v.active = true
        JOIN assignments a ON a.vehicle_id = v.id
          AND t.start_time BETWEEN a.started_at AND COALESCE(a.ended_at, NOW())
        WHERE t.start_time > NOW() - INTERVAL '7 days' AND t.end_time IS NOT NULL
        GROUP BY a.driver_id
      )
      SELECT RANK() OVER (ORDER BY score DESC) AS rank FROM weekly WHERE driver_id = $1
    `, [driverId]);

    const week  = weekR.rows[0]  || {};
    const total = totalR.rows[0] || {};
    const stats = {
      avgScore:       parseInt(week.avg_score)  || 0,
      tripCount:      parseInt(week.trip_count) || 0,
      weeklyKm:       parseFloat(week.weekly_km)/1000 || 0,
      harshBrakes:    parseInt(week.harsh_brakes)  || 0,
      overSpeeds:     parseInt(week.over_speeds)   || 0,
      earlyStarts:    parseInt(week.early_starts)  || 0,
      nightTrips:     parseInt(week.night_trips)   || 0,
      totalTrips:     parseInt(total.total_trips)  || 0,
      weeklyRank:     parseInt(rankR.rows[0]?.rank) || 99,
      consistentWeeks:0, // TODO: calculer sur l'historique
    };

    // Créer la table badges si besoin
    await pool.query(`
      CREATE TABLE IF NOT EXISTS driver_badges (
        id        SERIAL PRIMARY KEY,
        driver_id INTEGER REFERENCES drivers(id),
        badge_id  TEXT NOT NULL,
        awarded_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(driver_id, badge_id)
      )
    `).catch(() => {});

    const awarded = [];
    for (const badge of BADGES) {
      if (badge.condition(stats)) {
        const r = await pool.query(
          'INSERT INTO driver_badges(driver_id, badge_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id',
          [driverId, badge.id]
        );
        if (r.rows[0]) {
          awarded.push(badge);
          logger.info(`[Gamif] Badge "${badge.label}" → driver #${driverId}`);
        }
      }
    }
    return { stats, awarded, badgesTotal: await getBadgeCount(driverId) };
  } catch (e) {
    logger.error('[Gamif] ' + e.message);
    return null;
  }
}

async function getBadgeCount(driverId) {
  const r = await pool.query('SELECT COUNT(*) FROM driver_badges WHERE driver_id=$1', [driverId]).catch(()=>({rows:[{count:0}]}));
  return parseInt(r.rows[0].count);
}

async function getDriverBadges(driverId) {
  const r = await pool.query(
    'SELECT badge_id, awarded_at FROM driver_badges WHERE driver_id=$1 ORDER BY awarded_at DESC',
    [driverId]
  ).catch(()=>({rows:[]}));
  return r.rows.map(row => ({
    ...BADGES.find(b => b.id === row.badge_id),
    awardedAt: row.awarded_at,
  })).filter(b => b.id);
}

// ── Défi hebdomadaire ──────────────────────────────────────────────────
async function getWeeklyChallenge() {
  const challenges = [
    { id:'no_harsh',   label:'Zéro brusquerie',      target:'0 freinage/accélération brusque',  reward:'Bonus 500 FCFA' },
    { id:'max_score',  label:'Score maximum',         target:'Score > 90 sur tous les trajets',  reward:'Classement privilégié' },
    { id:'km_record',  label:'Record kilométrage',    target:'Maximum de km cette semaine',       reward:'Badge Marathonien' },
    { id:'no_speed',   label:'Vitesse maîtrisée',     target:'Zéro excès de vitesse cette semaine', reward:'Réduction assurance' },
  ];
  const weekNum = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
  return challenges[weekNum % challenges.length];
}

// ── Leaderboard complet ────────────────────────────────────────────────
async function getLeaderboard(period = 'week') {
  const interval = period === 'month' ? '30 days' : '7 days';
  try {
    const r = await pool.query(`
      SELECT
        dr.id, dr.name, dr.phone,
        ROUND(AVG(COALESCE(t.driving_score, 70))) AS score,
        COUNT(t.id) AS trip_count,
        SUM(t.distance) AS total_km,
        SUM(t.harsh_brakes) AS brakes,
        SUM(t.over_speed_count) AS speedings,
        RANK() OVER (ORDER BY AVG(COALESCE(t.driving_score,70)) DESC) AS rank,
        (SELECT COUNT(*) FROM driver_badges db WHERE db.driver_id=dr.id) AS badge_count
      FROM drivers dr
      LEFT JOIN assignments a ON a.driver_id = dr.id
      LEFT JOIN vehicles v ON v.id = a.vehicle_id AND v.active = true
      LEFT JOIN trips t ON t.device_id = v.device_id
        AND t.start_time > NOW() - ($1 || ' days')::INTERVAL
        AND t.end_time IS NOT NULL
        AND t.start_time BETWEEN a.started_at AND COALESCE(a.ended_at, NOW())
      WHERE dr.active = true
      GROUP BY dr.id, dr.name, dr.phone
      ORDER BY score DESC NULLS LAST
    `, [period === 'month' ? 30 : 7]);

    return r.rows.map(row => ({
      rank:       parseInt(row.rank),
      driverId:   row.id,
      name:       row.name,
      score:      parseInt(row.score) || 0,
      grade:      gradeFromScore(parseInt(row.score) || 0),
      tripCount:  parseInt(row.trip_count) || 0,
      totalKm:    Math.round(parseFloat(row.total_km || 0) / 10) / 100,
      brakes:     parseInt(row.brakes) || 0,
      speedings:  parseInt(row.speedings) || 0,
      badgeCount: parseInt(row.badge_count) || 0,
    }));
  } catch (e) {
    logger.error('[Gamif] Leaderboard: ' + e.message);
    return [];
  }
}

function gradeFromScore(s) {
  return s>=90?'A':s>=75?'B':s>=60?'C':s>=40?'D':'F';
}

module.exports = { computeAndAwardBadges, getDriverBadges, getWeeklyChallenge, getLeaderboard, BADGES };
