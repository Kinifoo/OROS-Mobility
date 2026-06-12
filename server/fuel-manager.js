/**
 * OROS — Gestion carburant avancée
 * Saisie des pleins, détection siphonnage, rapport coût/km
 * Inspiré de Wialon Fuel Control & Motive Fuel Management
 */
'use strict';

const { pool } = require('./database');
const { sendSMS } = require('./notification');
const logger   = require('./utils/logger');

async function initFuelTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fuel_entries (
      id          SERIAL PRIMARY KEY,
      vehicle_id  INTEGER REFERENCES vehicles(id),
      date        DATE DEFAULT CURRENT_DATE,
      liters      NUMERIC NOT NULL,
      cost_fcfa   NUMERIC,
      odometer    NUMERIC,
      station     TEXT,
      fuel_type   TEXT DEFAULT 'gasoline',
      notes       TEXT,
      created_by  INTEGER REFERENCES users(id),
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS fuel_alerts (
      id          SERIAL PRIMARY KEY,
      vehicle_id  INTEGER REFERENCES vehicles(id),
      alert_type  TEXT,
      detected_at TIMESTAMPTZ DEFAULT NOW(),
      liters_drop NUMERIC,
      data        JSONB
    );
  `).catch(() => {});
}

// ── Saisir un plein ────────────────────────────────────────────────────
async function addFuelEntry(data) {
  const { vehicleId, liters, costFcfa, odometer, station, fuelType, notes, userId } = data;
  const r = await pool.query(`
    INSERT INTO fuel_entries(vehicle_id, liters, cost_fcfa, odometer, station, fuel_type, notes, created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
  `, [vehicleId, liters, costFcfa, odometer, station, fuelType||'gasoline', notes, userId]);
  return r.rows[0];
}

// ── Rapport consommation ───────────────────────────────────────────────
async function getFuelReport(vehicleId, from, to) {
  const entries = await pool.query(`
    SELECT fe.*, v.plate, v.brand, v.model
    FROM fuel_entries fe
    JOIN vehicles v ON v.id = fe.vehicle_id
    WHERE fe.vehicle_id = $1
      AND ($2::date IS NULL OR fe.date >= $2)
      AND ($3::date IS NULL OR fe.date <= $3)
    ORDER BY fe.date DESC
  `, [vehicleId, from||null, to||null]);

  // Distance parcourue sur la période
  const tripR = await pool.query(`
    SELECT COALESCE(SUM(t.distance), 0) AS total_km,
           COALESCE(SUM(t.duration_minutes), 0) AS total_min
    FROM trips t
    JOIN devices d ON d.id = t.device_id
    JOIN vehicles v ON v.device_id = d.id AND v.id = $1
    WHERE ($2::date IS NULL OR t.start_time::date >= $2)
      AND ($3::date IS NULL OR t.end_time::date <= $3)
      AND t.end_time IS NOT NULL
  `, [vehicleId, from||null, to||null]);

  const rows      = entries.rows;
  const totalL    = rows.reduce((s, r) => s + parseFloat(r.liters||0), 0);
  const totalCost = rows.reduce((s, r) => s + parseFloat(r.cost_fcfa||0), 0);
  const totalKm   = parseFloat(tripR.rows[0]?.total_km||0) / 1000;
  const l100km    = totalKm > 0 ? (totalL / totalKm * 100) : null;
  const costPerKm = totalKm > 0 ? (totalCost / totalKm)    : null;

  // Théorique selon type véhicule (moyen CI)
  const theoretical = { car: 8, taxi: 9, moto: 4, truck: 18, van: 11 };
  const vType = rows[0]?.vtype || 'car';
  const theoreticalL100 = theoretical[vType] || 9;
  const deviation = l100km ? ((l100km - theoreticalL100) / theoreticalL100 * 100) : null;

  return {
    entries: rows,
    summary: {
      totalLiters:      Math.round(totalL * 10) / 10,
      totalCostFcfa:    Math.round(totalCost),
      totalKm:          Math.round(totalKm * 10) / 10,
      l100km:           l100km ? Math.round(l100km * 10) / 10 : null,
      costPerKm:        costPerKm ? Math.round(costPerKm) : null,
      theoreticalL100,
      deviationPct:     deviation ? Math.round(deviation) : null,
      refillCount:      rows.length,
      avgLitersPerFill: rows.length ? Math.round(totalL/rows.length*10)/10 : null,
    }
  };
}

// ── Détection siphonnage (chute brutale du niveau) ─────────────────────
async function checkFuelSiphoning(imei, currentFuelLevel, timestamp) {
  if (currentFuelLevel === null || currentFuelLevel === undefined) return;
  try {
    const last = await pool.query(`
      SELECT fuel FROM positions WHERE imei=$1 AND fuel IS NOT NULL
      ORDER BY time DESC LIMIT 1
    `, [imei]);

    if (!last.rows[0]?.fuel) return;
    const prevFuel = parseFloat(last.rows[0].fuel);
    const drop     = prevFuel - currentFuelLevel;

    // Chute > 15L en < 5min = suspicion siphonnage
    if (drop > 15) {
      const r = await pool.query(`
        SELECT v.id AS vehicle_id, v.plate, dr.name AS driver_name, dr.phone,
               u.phone AS manager_phone
        FROM devices d
        LEFT JOIN vehicles v ON v.device_id = d.id AND v.active = true
        LEFT JOIN assignments a ON a.vehicle_id = v.id AND a.ended_at IS NULL
        LEFT JOIN drivers dr ON dr.id = a.driver_id
        LEFT JOIN users u ON u.role IN ('admin','manager') AND u.active = true
        WHERE d.imei = $1 LIMIT 1
      `, [imei]);

      if (r.rows[0]) {
        const row   = r.rows[0];
        const alert = `🚨 OROS CARBURANT: Chute suspecte de ${Math.round(drop)}L détectée sur ${row.plate} (${row.driver_name||'?'}). Possible siphonnage.`;
        if (row.manager_phone) await sendSMS({ to: row.manager_phone, message: alert });
        await pool.query(
          'INSERT INTO fuel_alerts(vehicle_id, alert_type, liters_drop, data) VALUES($1,$2,$3,$4)',
          [row.vehicle_id, 'siphoning', drop, JSON.stringify({ imei, prevFuel, currentFuelLevel, timestamp })]
        );
        logger.warn(`[Fuel] Siphonnage suspecté: ${imei} −${Math.round(drop)}L`);
      }
    }
  } catch (e) { logger.error('[Fuel] ' + e.message); }
}

initFuelTable();
module.exports = { addFuelEntry, getFuelReport, checkFuelSiphoning };
