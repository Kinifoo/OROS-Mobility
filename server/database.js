/**
 * OROS GPS — Base de données PostgreSQL + TimescaleDB
 */
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');
const logger   = require('./utils/logger');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'oros_gps',
  user:     process.env.DB_USER     || 'oros',
  password: process.env.DB_PASSWORD || 'oros_secret_2024',
  max: 20, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000,
});

async function initDatabase() {
  const client = await pool.connect();
  try {
    logger.info('Initialisation de la base de données...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id             SERIAL PRIMARY KEY,
        name           TEXT,
        email          TEXT UNIQUE NOT NULL,
        password_hash  TEXT NOT NULL,
        role           TEXT NOT NULL DEFAULT 'viewer',
        active         BOOLEAN DEFAULT true,
        last_login     TIMESTAMPTZ,
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        updated_at     TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS devices (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        imei        TEXT UNIQUE NOT NULL,
        protocol    TEXT DEFAULT 'GT06',
        model       TEXT,
        phone       TEXT,
        port        INTEGER DEFAULT 8090,
        status      TEXT DEFAULT 'offline',
        max_speed   INTEGER DEFAULT 100,
        last_seen   TIMESTAMPTZ,
        lat         DOUBLE PRECISION,
        lon         DOUBLE PRECISION,
        speed       REAL DEFAULT 0,
        heading     REAL DEFAULT 0,
        satellites  INTEGER DEFAULT 0,
        ignition    BOOLEAN DEFAULT false,
        battery     REAL,
        active      BOOLEAN DEFAULT true,
        created_by  INTEGER REFERENCES users(id),
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS vehicles (
        id           SERIAL PRIMARY KEY,
        brand        TEXT NOT NULL,
        model        TEXT NOT NULL,
        plate        TEXT UNIQUE NOT NULL,
        type         TEXT DEFAULT 'car',
        color        TEXT,
        year         INTEGER,
        device_id    INTEGER REFERENCES devices(id),
        daily_target NUMERIC DEFAULT 15000,
        status       TEXT DEFAULT 'active',
        active       BOOLEAN DEFAULT true,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS drivers (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        phone      TEXT NOT NULL,
        email      TEXT,
        license    TEXT,
        status     TEXT DEFAULT 'active',
        active     BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS assignments (
        id         SERIAL PRIMARY KEY,
        vehicle_id INTEGER REFERENCES vehicles(id),
        driver_id  INTEGER REFERENCES drivers(id),
        started_at TIMESTAMPTZ DEFAULT NOW(),
        ended_at   TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS geofences (
        id           SERIAL PRIMARY KEY,
        name         TEXT NOT NULL,
        type         TEXT DEFAULT 'circle',
        lat          DOUBLE PRECISION,
        lon          DOUBLE PRECISION,
        radius       REAL DEFAULT 500,
        coordinates  JSONB DEFAULT '[]',
        alert_enter  BOOLEAN DEFAULT true,
        alert_exit   BOOLEAN DEFAULT true,
        active       BOOLEAN DEFAULT true,
        created_by   INTEGER REFERENCES users(id),
        created_at   TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS events (
        id              SERIAL PRIMARY KEY,
        device_id       INTEGER REFERENCES devices(id),
        imei            TEXT,
        event_type      TEXT NOT NULL,
        severity        TEXT DEFAULT 'warning',
        data            JSONB,
        acknowledged    BOOLEAN DEFAULT false,
        acknowledged_by INTEGER REFERENCES users(id),
        acknowledged_at TIMESTAMPTZ,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS trips (
        id               SERIAL PRIMARY KEY,
        device_id        INTEGER REFERENCES devices(id),
        start_time       TIMESTAMPTZ,
        end_time         TIMESTAMPTZ,
        distance         REAL DEFAULT 0,
        duration_minutes INTEGER DEFAULT 0,
        avg_speed        REAL DEFAULT 0,
        max_speed        REAL DEFAULT 0,
        idle_minutes     INTEGER DEFAULT 0,
        start_lat        DOUBLE PRECISION,
        start_lon        DOUBLE PRECISION,
        end_lat          DOUBLE PRECISION,
        end_lon          DOUBLE PRECISION,
        created_at       TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS maintenance (
        id          SERIAL PRIMARY KEY,
        vehicle_id  INTEGER REFERENCES vehicles(id),
        type        TEXT NOT NULL DEFAULT 'oil',
        due_date    DATE,
        due_km      INTEGER,
        status      TEXT DEFAULT 'pending',
        cost        NUMERIC,
        garage      TEXT,
        description TEXT,
        active      BOOLEAN DEFAULT true,
        created_by  INTEGER REFERENCES users(id),
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS revenues (
        id              SERIAL PRIMARY KEY,
        vehicle_id      INTEGER REFERENCES vehicles(id),
        driver_id       INTEGER REFERENCES drivers(id),
        amount          NUMERIC NOT NULL,
        date            DATE DEFAULT CURRENT_DATE,
        payment_method  TEXT DEFAULT 'cash',
        reference       TEXT,
        notes           TEXT,
        validated       BOOLEAN DEFAULT false,
        active          BOOLEAN DEFAULT true,
        created_by      INTEGER REFERENCES users(id),
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS device_commands (
        id          SERIAL PRIMARY KEY,
        device_id   INTEGER REFERENCES devices(id),
        command     TEXT NOT NULL,
        reason      TEXT,
        response    TEXT,
        sent_by     INTEGER REFERENCES users(id),
        executed    BOOLEAN DEFAULT false,
        executed_at TIMESTAMPTZ,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Table des positions (TimescaleDB hypertable ou table simple)
    await client.query(`
      CREATE TABLE IF NOT EXISTS positions (
        time        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        imei        TEXT NOT NULL,
        lat         DOUBLE PRECISION NOT NULL,
        lon         DOUBLE PRECISION NOT NULL,
        speed       REAL DEFAULT 0,
        heading     REAL DEFAULT 0,
        altitude    REAL DEFAULT 0,
        satellites  INTEGER DEFAULT 0,
        ignition    BOOLEAN DEFAULT false,
        accuracy    REAL DEFAULT 0,
        rpm         INTEGER,
        fuel        REAL,
        engine_temp REAL,
        odometer    REAL,
        battery     REAL,
        protocol    TEXT,
        raw         JSONB
      );
    `);

    // Convertir en hypertable TimescaleDB si disponible
    try {
      await client.query(`SELECT create_hypertable('positions','time', if_not_exists => TRUE)`);
      logger.info('TimescaleDB: hypertable positions configurée');
      // Rétention 365 jours
      await client.query(`SELECT add_retention_policy('positions', INTERVAL '365 days', if_not_exists => TRUE)`);
    } catch(e) {
      if (!e.message?.includes('already exists')) {
        logger.info('TimescaleDB non disponible, table normale utilisée');
      }
    }

    // Index
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_positions_imei_time ON positions(imei, time DESC);
      CREATE INDEX IF NOT EXISTS idx_events_device       ON events(device_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_trips_device        ON trips(device_id, start_time DESC);
    `);

    // Créer admin par défaut
    const adminEmail = process.env.ADMIN_EMAIL    || 'admin@oros-gps.com';
    const adminPass  = process.env.ADMIN_PASSWORD || 'Admin2024!';
    const exists     = await client.query('SELECT id FROM users WHERE email=$1', [adminEmail]);
    if (!exists.rows.length) {
      const hash = await bcrypt.hash(adminPass, 12);
      await client.query(
        "INSERT INTO users(name,email,password_hash,role) VALUES('Administrateur',$1,$2,'superadmin')",
        [adminEmail, hash]
      );
      logger.info(`Admin créé: ${adminEmail} / ${adminPass}`);
    }

    logger.info('Base de données initialisée avec succès');
  } finally {
    client.release();
  }
}

// ── FONCTIONS PRINCIPALES ──────────────────────
async function savePosition(pos) {
  await pool.query(`
    INSERT INTO positions(time,imei,lat,lon,speed,heading,altitude,satellites,ignition,accuracy,rpm,fuel,engine_temp,odometer,battery,protocol,raw)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
  `, [
    pos.timestamp || new Date(),
    pos.imei, pos.lat, pos.lon,
    pos.speed || 0, pos.heading || 0, pos.altitude || 0,
    pos.satellites || 0, pos.ignition || false, pos.accuracy || 0,
    pos.rpm, pos.fuel, pos.engineTemp, pos.odometer, pos.battery,
    pos.protocol, pos.raw ? JSON.stringify(pos.raw) : null
  ]);

  // Mettre à jour le statut du traceur
  const newStatus = (pos.speed > 3) ? 'online' : 'idle';
  await pool.query(`
    UPDATE devices SET
      lat=$1, lon=$2, speed=$3, heading=$4, satellites=$5,
      ignition=$6, battery=$7, status=$8, last_seen=NOW()
    WHERE imei=$9
  `, [pos.lat, pos.lon, pos.speed||0, pos.heading||0, pos.satellites||0,
      pos.ignition||false, pos.battery, newStatus, pos.imei]);
}

async function saveEvent(event) {
  const dev      = await pool.query('SELECT id FROM devices WHERE imei=$1', [event.imei]);
  const deviceId = dev.rows[0]?.id || null;
  const severity = ['sos','power_cut','overspeed','exit_fence'].includes(event.eventType) ? 'critical' : 'warning';
  await pool.query(
    'INSERT INTO events(device_id,imei,event_type,severity,data) VALUES($1,$2,$3,$4,$5)',
    [deviceId, event.imei, event.eventType, severity, JSON.stringify(event.data || {})]
  );
  if (event.eventType === 'alarm') {
    await pool.query("UPDATE devices SET status='alarm' WHERE imei=$1", [event.imei]);
  }
}

async function getPositions(imei, from, to, limit = 1000) {
  const res = await pool.query(`
    SELECT time, lat, lon, speed, heading, ignition, rpm, fuel, engine_temp, altitude, satellites
    FROM positions
    WHERE imei=$1 AND time BETWEEN $2 AND $3
    ORDER BY time DESC LIMIT $4
  `, [imei, from, to, limit]);
  return res.rows;
}

async function getDevices() {
  const res = await pool.query(`
    SELECT d.*, v.plate, v.brand, v.model AS vmodel, v.color, v.type AS vtype, v.daily_target,
           dr.name AS driver_name, dr.phone AS driver_phone
    FROM devices d
    LEFT JOIN vehicles v ON v.device_id = d.id AND v.active = true
    LEFT JOIN assignments a ON a.vehicle_id = v.id AND a.ended_at IS NULL
    LEFT JOIN drivers dr ON dr.id = a.driver_id
    WHERE d.active = true
    ORDER BY d.name
  `);
  return res.rows;
}

async function getEvents(limit = 50, acknowledged = false) {
  const res = await pool.query(`
    SELECT e.*, d.name AS device_name, d.imei
    FROM events e
    LEFT JOIN devices d ON d.id = e.device_id
    WHERE e.acknowledged = $1
    ORDER BY e.created_at DESC LIMIT $2
  `, [acknowledged, limit]);
  return res.rows;
}

module.exports = { initDatabase, savePosition, saveEvent, getPositions, getDevices, getEvents, pool };

// ── Extension schéma (appelée après initDatabase) ──────────────────
async function extendSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Score de conduite dans trips
      ALTER TABLE trips ADD COLUMN IF NOT EXISTS harsh_brakes    INTEGER DEFAULT 0;
      ALTER TABLE trips ADD COLUMN IF NOT EXISTS harsh_accels    INTEGER DEFAULT 0;
      ALTER TABLE trips ADD COLUMN IF NOT EXISTS over_speed_count INTEGER DEFAULT 0;
      ALTER TABLE trips ADD COLUMN IF NOT EXISTS driving_score    INTEGER;

      -- Score dans drivers
      ALTER TABLE drivers ADD COLUMN IF NOT EXISTS driving_score INTEGER DEFAULT 0;
      ALTER TABLE drivers ADD COLUMN IF NOT EXISTS total_trips   INTEGER DEFAULT 0;
      ALTER TABLE drivers ADD COLUMN IF NOT EXISTS total_km      NUMERIC DEFAULT 0;

      -- Phone dans users (pour les alertes SMS)
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

      -- Table immobilisation automatique
      CREATE TABLE IF NOT EXISTS auto_immobilization (
        id            SERIAL PRIMARY KEY,
        vehicle_id    INTEGER REFERENCES vehicles(id),
        date          DATE NOT NULL,
        status        TEXT DEFAULT 'pending',
        immobilized_at TIMESTAMPTZ,
        extended_until TIMESTAMPTZ,
        extended_by   INTEGER REFERENCES users(id),
        validated_at  TIMESTAMPTZ,
        validated_by  INTEGER REFERENCES users(id),
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(vehicle_id, date)
      );

      -- Table notification_rules (futures règles paramétrables)
      CREATE TABLE IF NOT EXISTS notification_rules (
        id          SERIAL PRIMARY KEY,
        rule_type   TEXT NOT NULL,
        vehicle_id  INTEGER REFERENCES vehicles(id),
        driver_id   INTEGER REFERENCES drivers(id),
        enabled     BOOLEAN DEFAULT true,
        params      JSONB DEFAULT '{}',
        created_by  INTEGER REFERENCES users(id),
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_auto_immo_vehicle_date ON auto_immobilization(vehicle_id, date);
      CREATE INDEX IF NOT EXISTS idx_trips_score ON trips(driving_score) WHERE driving_score IS NOT NULL;
    `);
    logger.info('Schéma étendu avec succès (trips, drivers, auto_immobilization)');
  } catch (e) {
    // Les colonnes existent déjà → normal
    if (!e.message.includes('already exists')) {
      logger.error('extendSchema: ' + e.message);
    }
  } finally {
    client.release();
  }
}

module.exports.extendSchema = extendSchema;
