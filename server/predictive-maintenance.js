/**
 * OROS — Maintenance prédictive IA
 * Analyse les données OBD + comportement pour prédire les pannes
 * Inspiré de Samsara Predictive Maintenance & Geotab MyGeotab
 */
'use strict';

const { pool }   = require('./database');
const { sendSMS, sendEmail } = require('./notification');
const cron       = require('node-cron');
const logger     = require('./utils/logger');

// ── Seuils d'alerte par type de capteur ───────────────────────────────
const THRESHOLDS = {
  engineTemp:  { warning: 95,   critical: 105,  unit:'°C',  label:'Température moteur' },
  rpm:         { warning: 4500, critical: 5500,  unit:'RPM', label:'Régime moteur' },
  battery:     { warning: 20,   critical: 10,   unit:'%',   label:'Batterie traceur' },
  idleMinutes: { warning: 30,   critical: 60,   unit:'min', label:'Ralenti prolongé' },
};

// Intervalles de maintenance recommandés
const MAINTENANCE_INTERVALS = {
  oil:          { km: 10000, months: 6,  label:'Vidange huile' },
  filter_air:   { km: 20000, months: 12, label:'Filtre à air' },
  filter_fuel:  { km: 30000, months: 18, label:'Filtre carburant' },
  brakes:       { km: 40000, months: 24, label:'Freins' },
  tires:        { km: 50000, months: 36, label:'Pneumatiques' },
  belt:         { km: 80000, months: 48, label:'Courroie distribution' },
  spark_plugs:  { km: 30000, months: 24, label:'Bougies d\'allumage' },
};

// ── Analyse prédictive d'un véhicule ──────────────────────────────────
async function analyzePredictiveMaintenance(vehicleId) {
  try {
    const r = await pool.query(`
      SELECT v.*, d.imei, d.odometer AS current_km,
             (SELECT MAX(p.engine_temp) FROM positions p WHERE p.imei=d.imei AND p.time > NOW()-INTERVAL '7 days') AS max_temp_week,
             (SELECT AVG(p.rpm) FROM positions p WHERE p.imei=d.imei AND p.speed < 5 AND p.ignition=true AND p.time > NOW()-INTERVAL '7 days') AS avg_idle_rpm,
             (SELECT SUM(t.harsh_brakes) FROM trips t WHERE t.device_id=d.id AND t.start_time > NOW()-INTERVAL '30 days') AS harsh_brakes_month,
             (SELECT SUM(t.distance) FROM trips t WHERE t.device_id=d.id) AS total_km_trips
      FROM vehicles v
      JOIN devices d ON d.id = v.device_id AND d.active = true
      WHERE v.id = $1 AND v.active = true
    `, [vehicleId]);

    if (!r.rows[0]) return null;
    const v = r.rows[0];
    const predictions = [];

    // 1. Température moteur excessive
    if (v.max_temp_week > THRESHOLDS.engineTemp.warning) {
      predictions.push({
        type:       'engine_temp',
        severity:   v.max_temp_week > THRESHOLDS.engineTemp.critical ? 'critical' : 'warning',
        label:      'Surchauffe moteur',
        detail:     `Température max: ${Math.round(v.max_temp_week)}°C cette semaine`,
        recommendation: 'Vérifier le liquide de refroidissement et le thermostat',
        urgencyDays:    v.max_temp_week > THRESHOLDS.engineTemp.critical ? 1 : 7,
        confidence: 87,
      });
    }

    // 2. Freinage brusque excessif → usure freins
    const brakesMonth = parseInt(v.harsh_brakes_month) || 0;
    if (brakesMonth > 20) {
      predictions.push({
        type:       'brakes_wear',
        severity:   brakesMonth > 50 ? 'critical' : 'warning',
        label:      'Usure prématurée des freins',
        detail:     `${brakesMonth} freinages brusques ce mois — usure accélérée estimée`,
        recommendation: 'Vérifier l\'épaisseur des plaquettes de frein',
        urgencyDays:    30,
        confidence: 72,
      });
    }

    // 3. Maintenance par kilométrage
    const currentKm = parseFloat(v.current_km || v.total_km_trips / 1000 || 0);
    const lastMaint = await getLastMaintenanceKm(vehicleId);

    for (const [type, interval] of Object.entries(MAINTENANCE_INTERVALS)) {
      const lastKm = lastMaint[type] || 0;
      const nextKm = lastKm + interval.km;
      const remaining = nextKm - currentKm;

      if (remaining <= 0) {
        predictions.push({
          type, severity: 'critical',
          label:           interval.label,
          detail:          `En retard de ${Math.abs(Math.round(remaining))} km`,
          recommendation:  `Effectuer ${interval.label} immédiatement`,
          urgencyDays:     0,
          confidence:      95,
        });
      } else if (remaining <= interval.km * 0.1) {
        predictions.push({
          type, severity: 'warning',
          label:           interval.label,
          detail:          `Dans ${Math.round(remaining)} km`,
          recommendation:  `Planifier ${interval.label} prochainement`,
          urgencyDays:     Math.round(remaining / 100),
          confidence:      88,
        });
      }
    }

    // Score de santé global (0-100)
    const healthScore = Math.max(0, 100
      - predictions.filter(p => p.severity === 'critical').length * 25
      - predictions.filter(p => p.severity === 'warning').length * 10
    );

    return {
      vehicleId,
      plate:       v.plate,
      brand:       v.brand,
      model:       v.model,
      currentKm:   Math.round(currentKm),
      healthScore,
      healthLabel: healthScore >= 80 ? 'Bon état' : healthScore >= 60 ? 'Attention' : 'Intervention requise',
      predictions: predictions.sort((a,b) => a.urgencyDays - b.urgencyDays),
    };
  } catch (e) {
    logger.error('[PredMaint] ' + e.message);
    return null;
  }
}

async function getLastMaintenanceKm(vehicleId) {
  const r = await pool.query(`
    SELECT type, due_km FROM maintenance
    WHERE vehicle_id = $1 AND status = 'done' AND due_km IS NOT NULL
    ORDER BY created_at DESC
  `, [vehicleId]).catch(() => ({ rows: [] }));
  const result = {};
  r.rows.forEach(row => { if (!result[row.type]) result[row.type] = row.due_km; });
  return result;
}

// Analyse quotidienne de toute la flotte
cron.schedule('0 9 * * *', async () => {
  logger.info('[PredMaint] Analyse quotidienne...');
  try {
    const vehicles = await pool.query('SELECT id FROM vehicles WHERE active=true AND device_id IS NOT NULL');
    let alerts = 0;
    for (const v of vehicles.rows) {
      const analysis = await analyzePredictiveMaintenance(v.id);
      if (!analysis) continue;
      const criticals = analysis.predictions.filter(p => p.severity === 'critical' && p.urgencyDays === 0);
      if (criticals.length > 0) {
        // Notifier le gestionnaire
        const mgrR = await pool.query("SELECT email, phone FROM users WHERE role IN ('admin','manager') AND active=true LIMIT 1");
        if (mgrR.rows[0]) {
          const msg = `🔧 OROS Maintenance: ${analysis.plate} — ${criticals.map(p=>p.label).join(', ')} nécessite une intervention immédiate.`;
          if (mgrR.rows[0].phone) await sendSMS({ to: mgrR.rows[0].phone, message: msg });
        }
        alerts++;
      }
    }
    logger.info(`[PredMaint] Analyse OK — ${alerts} alerte(s) critique(s)`);
  } catch (e) {
    logger.error('[PredMaint] Cron: ' + e.message);
  }
}, { timezone: 'Africa/Abidjan' });

module.exports = { analyzePredictiveMaintenance };
