/**
 * OROS — Gestion documentaire & alertes d'expiration
 * Assurance, visite technique, permis, contrôle technique
 */
'use strict';

const { pool }   = require('./database');
const { sendSMS, sendEmail } = require('./notification');
const logger     = require('./utils/logger');
const cron       = require('node-cron');
const path       = require('path');
const fs         = require('fs');

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/opt/oros-gps/uploads';

async function initDocumentsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vehicle_documents (
      id            SERIAL PRIMARY KEY,
      vehicle_id    INTEGER REFERENCES vehicles(id),
      driver_id     INTEGER REFERENCES drivers(id),
      type          TEXT NOT NULL,
      label         TEXT,
      file_path     TEXT,
      file_name     TEXT,
      expires_at    DATE,
      issued_at     DATE,
      issuer        TEXT,
      notes         TEXT,
      alert_30days  BOOLEAN DEFAULT true,
      alert_7days   BOOLEAN DEFAULT true,
      alert_expired BOOLEAN DEFAULT true,
      active        BOOLEAN DEFAULT true,
      uploaded_by   INTEGER REFERENCES users(id),
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_docs_expires ON vehicle_documents(expires_at) WHERE active=true;
    CREATE INDEX IF NOT EXISTS idx_docs_vehicle ON vehicle_documents(vehicle_id);
  `).catch(() => {});
}

// ── Ajouter un document ────────────────────────────────────────────────
async function createDocument(data) {
  const { vehicleId, driverId, type, label, fileName, filePath, expiresAt, issuedAt, issuer, notes, uploadedBy } = data;
  const r = await pool.query(`
    INSERT INTO vehicle_documents(vehicle_id, driver_id, type, label, file_name, file_path, expires_at, issued_at, issuer, notes, uploaded_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
  `, [vehicleId, driverId, type, label, fileName, filePath, expiresAt, issuedAt, issuer, notes, uploadedBy]);
  return r.rows[0];
}

// ── Lister les documents avec statut d'expiration ─────────────────────
async function getDocuments(filters = {}) {
  let q = `
    SELECT d.*, v.plate, v.brand, v.model, dr.name AS driver_name,
           CASE
             WHEN d.expires_at < CURRENT_DATE THEN 'expired'
             WHEN d.expires_at < CURRENT_DATE + 7  THEN 'critical'
             WHEN d.expires_at < CURRENT_DATE + 30 THEN 'warning'
             ELSE 'ok'
           END AS expiry_status,
           d.expires_at - CURRENT_DATE AS days_remaining
    FROM vehicle_documents d
    LEFT JOIN vehicles v ON v.id = d.vehicle_id
    LEFT JOIN drivers dr ON dr.id = d.driver_id
    WHERE d.active = true
  `;
  const params = [];
  if (filters.vehicleId)  { params.push(filters.vehicleId);  q += ` AND d.vehicle_id=$${params.length}`; }
  if (filters.driverId)   { params.push(filters.driverId);   q += ` AND d.driver_id=$${params.length}`; }
  if (filters.expiring)   { q += ` AND d.expires_at < CURRENT_DATE + 30`; }
  if (filters.type)       { params.push(filters.type); q += ` AND d.type=$${params.length}`; }
  q += ' ORDER BY d.expires_at ASC NULLS LAST';
  const r = await pool.query(q, params);
  return r.rows;
}

// ── Cron : vérification quotidienne des expirations ───────────────────
cron.schedule('0 8 * * *', async () => {
  logger.info('[Docs] Vérification expirations...');
  try {
    const docs = await pool.query(`
      SELECT d.*, v.plate, v.brand, v.model,
             v.daily_target,
             d.expires_at - CURRENT_DATE AS days_left,
             u.email AS manager_email, u.phone AS manager_phone, u.name AS manager_name
      FROM vehicle_documents d
      LEFT JOIN vehicles v ON v.id = d.vehicle_id
      LEFT JOIN users u ON u.role IN ('admin','manager') AND u.active = true
      WHERE d.active = true
        AND d.expires_at IS NOT NULL
        AND d.expires_at <= CURRENT_DATE + 30
    `);

    const typeLabels = {
      insurance:  'Assurance',   technical: 'Visite technique',
      license:    'Permis de conduire', registration: 'Carte grise',
      other:      'Document',
    };

    for (const doc of docs.rows) {
      const daysLeft = parseInt(doc.days_left);
      const label    = `${typeLabels[doc.type]||doc.type} — ${doc.plate||'?'}`;
      let msg = null;

      if (daysLeft < 0 && doc.alert_expired) {
        msg = `🔴 OROS DOCS: ${label} a expiré il y a ${Math.abs(daysLeft)} jour(s) ! Renouvelez immédiatement.`;
      } else if (daysLeft <= 7 && doc.alert_7days) {
        msg = `🟠 OROS DOCS: ${label} expire dans ${daysLeft} jour(s). Renouvelez urgence.`;
      } else if (daysLeft <= 30 && doc.alert_30days) {
        msg = `🟡 OROS DOCS: ${label} expire dans ${daysLeft} jour(s). Pensez à le renouveler.`;
      }

      if (msg) {
        if (doc.manager_phone) await sendSMS({ to: doc.manager_phone, message: msg });
        if (doc.manager_email) await sendEmail({ to: doc.manager_email, subject: `Expiration document — ${label}`, html: `<h2>Document à renouveler</h2><p>${msg}</p>` });
        logger.info(`[Docs] Alerte expiration: ${label} (${daysLeft}j)`);
      }
    }
  } catch (e) {
    logger.error('[Docs] ' + e.message);
  }
}, { timezone: 'Africa/Abidjan' });

const DOC_TYPES = [
  { value:'insurance',    label:'Assurance',           icon:'🛡️',  required:true },
  { value:'technical',    label:'Visite technique',    icon:'🔧',  required:true },
  { value:'registration', label:'Carte grise',         icon:'📄',  required:true },
  { value:'license',      label:'Permis de conduire',  icon:'🪪',  required:false },
  { value:'sticker',      label:'Vignette / Taxe',     icon:'🏷️',  required:false },
  { value:'contract',     label:'Contrat conducteur',  icon:'📝',  required:false },
  { value:'other',        label:'Autre document',      icon:'📁',  required:false },
];

initDocumentsTable();
module.exports = { createDocument, getDocuments, DOC_TYPES };
