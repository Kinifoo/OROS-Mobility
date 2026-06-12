/**
 * OROS MOBILITY — Moteur d'alertes IA v2.0
 * ═══════════════════════════════════════════════════════════
 *
 * Architecture en 4 couches:
 * 1. COLLECTE    — capture chaque événement brut
 * 2. IA          — scoring, corrélation, déduplication, contexte
 * 3. DÉCISION    — priorisation, routing, anti-spam
 * 4. ACTION      — notification multi-canal, dashboard, journal
 *
 * Inspiré de: Samsara AI Alerts, Motive Safety Hub, Geotab MyGeotab
 * ═══════════════════════════════════════════════════════════
 */

'use strict';

const { pool }     = require('./database');
const notification = require('./notification');
const logger       = require('./utils/logger');

let broadcaster = null;
function setBroadcaster(fn) { broadcaster = fn; }

// ══════════════════════════════════════════════════════════════
//  COUCHE 1 — DÉFINITION DES TYPES D'ALERTES
// ══════════════════════════════════════════════════════════════

const ALERT_TYPES = {
  // ── Sécurité critique ────────────────────────────────────
  sos: {
    label:       'Bouton SOS — Urgence',
    icon:        '🆘',
    baseSeverity: 'critical',
    baseScore:    100,
    channels:    ['sms', 'email', 'push', 'dashboard'],
    escalate:    true,
    sound:       'siren',
    color:       '#DC2626',
  },
  power_cut: {
    label:       'Coupure alimentation',
    icon:        '⚡',
    baseSeverity: 'critical',
    baseScore:    85,
    channels:    ['sms', 'push', 'dashboard'],
    escalate:    true,
    color:       '#DC2626',
  },
  engine_immobilized: {
    label:       'Moteur immobilisé',
    icon:        '🚫',
    baseSeverity: 'critical',
    baseScore:    90,
    channels:    ['sms', 'dashboard'],
    color:       '#DC2626',
  },
  theft_suspected: {
    label:       'Tentative de vol suspectée',
    icon:        '🔴',
    baseSeverity: 'critical',
    baseScore:    95,
    channels:    ['sms', 'email', 'push', 'dashboard'],
    escalate:    true,
    color:       '#DC2626',
  },

  // ── Sécurité haute ──────────────────────────────────────
  overspeed: {
    label:       'Excès de vitesse',
    icon:        '🏎️',
    baseSeverity: 'high',
    baseScore:    70,
    channels:    ['push', 'dashboard'],
    color:       '#EA580C',
  },
  harsh_brake: {
    label:       'Freinage brusque',
    icon:        '🛑',
    baseSeverity: 'medium',
    baseScore:    45,
    channels:    ['dashboard'],
    color:       '#D97706',
  },
  harsh_accel: {
    label:       'Accélération brusque',
    icon:        '⬆️',
    baseSeverity: 'medium',
    baseScore:    40,
    channels:    ['dashboard'],
    color:       '#D97706',
  },
  fatigue_driving: {
    label:       'Fatigue — conduite prolongée',
    icon:        '😴',
    baseSeverity: 'high',
    baseScore:    75,
    channels:    ['sms', 'push', 'dashboard'],
    color:       '#EA580C',
  },
  night_driving_alert: {
    label:       'Conduite de nuit risquée',
    icon:        '🌙',
    baseSeverity: 'medium',
    baseScore:    50,
    channels:    ['push', 'dashboard'],
    color:       '#7C3AED',
  },

  // ── Géofences ────────────────────────────────────────────
  exit_fence: {
    label:       'Sortie de zone autorisée',
    icon:        '📍',
    baseSeverity: 'high',
    baseScore:    65,
    channels:    ['sms', 'push', 'dashboard'],
    color:       '#EA580C',
  },
  enter_fence: {
    label:       'Entrée zone restreinte',
    icon:        '⛔',
    baseSeverity: 'medium',
    baseScore:    55,
    channels:    ['push', 'dashboard'],
    color:       '#D97706',
  },
  corridor_deviation: {
    label:       'Déviation de l\'itinéraire',
    icon:        '🗺️',
    baseSeverity: 'medium',
    baseScore:    50,
    channels:    ['push', 'dashboard'],
    color:       '#D97706',
  },

  // ── Véhicule / traceur ───────────────────────────────────
  offline: {
    label:       'Traceur hors ligne',
    icon:        '📶',
    baseSeverity: 'medium',
    baseScore:    55,
    channels:    ['push', 'dashboard'],
    color:       '#6B7280',
  },
  low_battery: {
    label:       'Batterie faible',
    icon:        '🔋',
    baseSeverity: 'low',
    baseScore:    30,
    channels:    ['dashboard'],
    color:       '#D97706',
  },
  engine_on_unexpected: {
    label:       'Démarrage non autorisé',
    icon:        '🔑',
    baseSeverity: 'high',
    baseScore:    80,
    channels:    ['sms', 'push', 'dashboard'],
    escalate:    true,
    color:       '#EA580C',
  },
  long_idle: {
    label:       'Ralenti prolongé',
    icon:        '⏱️',
    baseSeverity: 'low',
    baseScore:    25,
    channels:    ['dashboard'],
    color:       '#6B7280',
  },

  // ── Carburant ────────────────────────────────────────────
  fuel_siphoning: {
    label:       'Siphonnage carburant suspect',
    icon:        '⛽',
    baseSeverity: 'critical',
    baseScore:    90,
    channels:    ['sms', 'push', 'dashboard'],
    escalate:    true,
    color:       '#DC2626',
  },
  fuel_low: {
    label:       'Niveau carburant bas',
    icon:        '⛽',
    baseSeverity: 'low',
    baseScore:    20,
    channels:    ['push', 'dashboard'],
    color:       '#D97706',
  },

  // ── Maintenance ──────────────────────────────────────────
  maintenance_overdue: {
    label:       'Maintenance en retard',
    icon:        '🔧',
    baseSeverity: 'high',
    baseScore:    65,
    channels:    ['push', 'dashboard'],
    color:       '#7C3AED',
  },
  engine_fault: {
    label:       'Code défaut moteur (DTC)',
    icon:        '⚠️',
    baseSeverity: 'high',
    baseScore:    70,
    channels:    ['sms', 'push', 'dashboard'],
    color:       '#EA580C',
  },
  temp_critical: {
    label:       'Température moteur critique',
    icon:        '🌡️',
    baseSeverity: 'critical',
    baseScore:    88,
    channels:    ['sms', 'push', 'dashboard'],
    color:       '#DC2626',
  },

  // ── Financier ────────────────────────────────────────────
  revenue_missing: {
    label:       'Recette non versée',
    icon:        '💰',
    baseSeverity: 'high',
    baseScore:    72,
    channels:    ['sms', 'push', 'dashboard'],
    color:       '#EA580C',
  },
  auto_immobilization_warning: {
    label:       'Avertissement immobilisation',
    icon:        '⚠️',
    baseSeverity: 'high',
    baseScore:    80,
    channels:    ['sms', 'push', 'dashboard'],
    color:       '#EA580C',
  },
};

// ══════════════════════════════════════════════════════════════
//  COUCHE 2 — MOTEUR IA DE SCORING & CORRÉLATION
// ══════════════════════════════════════════════════════════════

// Contexte en mémoire par traceur : historique des alertes récentes
const alertContext = new Map();
// { imei: { recentAlerts: [], riskScore: 0, lastAlertAt: Date, suppressUntil: Date } }

/**
 * Calcule le score de risque IA (0-100) en tenant compte du contexte
 * Plus le score est élevé, plus l'alerte est prioritaire
 */
function computeRiskScore(alertType, imei, data = {}) {
  const def     = ALERT_TYPES[alertType];
  if (!def) return 0;

  let score = def.baseScore;
  const ctx = alertContext.get(imei) || { recentAlerts: [], riskScore: 0 };

  // ── Facteurs aggravants ──────────────────────────────────

  // 1. Récidive récente du même type (+15 par occurrence dans les 30 min)
  const now = Date.now();
  const sameType30min = ctx.recentAlerts.filter(
    a => a.type === alertType && (now - a.ts) < 30 * 60 * 1000
  ).length;
  score += sameType30min * 15;

  // 2. Cluster d'alertes (multiple types en 15 min = situation dégradée)
  const multiType15min = new Set(
    ctx.recentAlerts
      .filter(a => (now - a.ts) < 15 * 60 * 1000)
      .map(a => a.type)
  ).size;
  if (multiType15min >= 3) score += 20; // Plusieurs types → situation sérieuse
  if (multiType15min >= 5) score += 15; // Encore plus

  // 3. Vitesse excessive (amplificateur)
  if (data.speed > 130) score += 25;
  else if (data.speed > 110) score += 10;

  // 4. Heure de la journée (nuit = plus risqué)
  const hour = new Date().getHours();
  if (hour >= 23 || hour < 5) score += 10; // Nuit profonde

  // 5. Score de conduite du conducteur (historique négatif = score plus élevé)
  if (ctx.drivingScore !== undefined && ctx.drivingScore < 50) score += 15;
  else if (ctx.drivingScore < 70) score += 5;

  // 6. Zone à risque (si connue)
  if (data.inRestrictedZone) score += 20;

  // ── Facteurs atténuants ──────────────────────────────────

  // 7. Conducteur expérimenté avec bon historique
  if (ctx.drivingScore >= 90) score -= 10;

  // 8. Heure de travail normale (07h-19h)
  if (hour >= 7 && hour < 19) score -= 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Déduplication intelligente — évite le spam d'alertes identiques
 * Retourne true si l'alerte doit être SUPPRIMÉE (déjà traitée)
 */
function shouldSuppress(alertType, imei) {
  const ctx = alertContext.get(imei);
  if (!ctx) return false;

  const now = Date.now();

  // Fenêtres de déduplication par type
  const dedupeWindows = {
    overspeed:      2 * 60 * 1000,    // 2 min
    harsh_brake:    5 * 60 * 1000,    // 5 min
    harsh_accel:    5 * 60 * 1000,
    offline:       10 * 60 * 1000,    // 10 min
    low_battery:   60 * 60 * 1000,    // 1h
    long_idle:     30 * 60 * 1000,    // 30 min
    enter_fence:    5 * 60 * 1000,
    exit_fence:     5 * 60 * 1000,
    fuel_low:      60 * 60 * 1000,
    // SOS, power_cut, theft → jamais supprimés
  };

  const window = dedupeWindows[alertType];
  if (!window) return false; // Pas de déduplication pour les alertes critiques

  const lastSame = ctx.recentAlerts
    .filter(a => a.type === alertType)
    .sort((a, b) => b.ts - a.ts)[0];

  return lastSame && (now - lastSame.ts) < window;
}

/**
 * Corrélation d'événements — détecte les patterns suspects
 * Ex: power_cut + mouvement = vol potentiel
 */
function detectPattern(imei, newAlertType, data) {
  const ctx = alertContext.get(imei);
  if (!ctx) return null;

  const now    = Date.now();
  const last5m = ctx.recentAlerts.filter(a => (now - a.ts) < 5 * 60 * 1000).map(a => a.type);

  // Pattern 1: Coupure + mouvement → vol
  if (newAlertType === 'overspeed' && last5m.includes('power_cut')) {
    return { type: 'theft_suspected', data: { ...data, trigger: 'power_cut_then_speed' } };
  }

  // Pattern 2: SOS + déviation d'itinéraire → enlèvement potentiel
  if (newAlertType === 'corridor_deviation' && last5m.includes('sos')) {
    return { type: 'theft_suspected', data: { ...data, trigger: 'sos_then_deviation' } };
  }

  // Pattern 3: Démarrage moteur en dehors horaires autorisés (22h-6h)
  const hour = new Date().getHours();
  if (newAlertType === 'engine_on' && (hour >= 22 || hour < 6)) {
    return { type: 'engine_on_unexpected', data: { ...data, hour } };
  }

  // Pattern 4: Batterie faible + hors ligne = traceur débranché
  if (newAlertType === 'offline' && last5m.includes('low_battery')) {
    return { type: 'theft_suspected', data: { ...data, trigger: 'battery_then_offline' } };
  }

  // Pattern 5: Multiple harsh brakes = fatigue / perte de contrôle
  const hbrakes = last5m.filter(t => t === 'harsh_brake').length;
  if (newAlertType === 'harsh_brake' && hbrakes >= 3) {
    return { type: 'fatigue_driving', data: { ...data, harshBrakesLast5min: hbrakes + 1 } };
  }

  return null;
}

// ══════════════════════════════════════════════════════════════
//  COUCHE 3 — DÉCISION & ROUTING
// ══════════════════════════════════════════════════════════════

/**
 * Point d'entrée principal — traite un événement brut
 * et décide quoi faire
 */
async function processAlert(alertType, imei, data = {}) {
  // Mettre à jour le contexte mémoire
  const ctx = alertContext.get(imei) || {
    recentAlerts: [], riskScore: 0, drivingScore: 70,
    lastAlertAt: null, totalAlertsToday: 0,
  };

  // Charger le score conducteur depuis la DB (cache 10min)
  if (!ctx._scoreLoadedAt || (Date.now() - ctx._scoreLoadedAt) > 600000) {
    try {
      const r = await pool.query(`
        SELECT dr.driving_score FROM drivers dr
        JOIN assignments a ON a.driver_id = dr.id
        JOIN vehicles v ON v.id = a.vehicle_id AND v.active = true
        JOIN devices d ON d.id = v.device_id
        WHERE d.imei = $1 AND a.ended_at IS NULL LIMIT 1
      `, [imei]);
      if (r.rows[0]) ctx.drivingScore = r.rows[0].driving_score || 70;
      ctx._scoreLoadedAt = Date.now();
    } catch(e) {}
  }

  // Vérifier si l'alerte doit être supprimée (déduplication)
  if (shouldSuppress(alertType, imei)) {
    logger.debug?.(`[AlertAI] Supprimé (dedupe): ${alertType} ${imei}`);
    return null;
  }

  // Calculer le score de risque IA
  const riskScore = computeRiskScore(alertType, imei, data);

  // Détecter des patterns suspects
  const pattern = detectPattern(imei, alertType, data);

  // Enregistrer dans le contexte
  ctx.recentAlerts.push({ type: alertType, ts: Date.now(), score: riskScore });
  ctx.recentAlerts = ctx.recentAlerts.filter(a => (Date.now()-a.ts) < 60*60*1000); // Garder 1h
  ctx.riskScore    = riskScore;
  ctx.lastAlertAt  = new Date();
  ctx.totalAlertsToday = (ctx.totalAlertsToday || 0) + 1;
  alertContext.set(imei, ctx);

  const def      = ALERT_TYPES[alertType] || { label: alertType, baseSeverity: 'medium', baseScore: 50, channels: ['dashboard'], color: '#6B7280' };
  const severity = riskScore >= 85 ? 'critical' : riskScore >= 65 ? 'high' : riskScore >= 40 ? 'medium' : 'low';

  // Construire l'objet alerte enrichi
  const alert = {
    id:          null, // sera rempli après DB insert
    imei,
    type:        alertType,
    label:       def.label,
    icon:        def.icon || '⚠️',
    severity,
    riskScore,
    color:       def.color || '#6B7280',
    data,
    patternDetected: pattern ? pattern.type : null,
    channels:    def.channels || ['dashboard'],
    escalate:    def.escalate || false,
    timestamp:   new Date().toISOString(),
  };

  // Sauvegarder en DB
  try {
    const r = await pool.query(`
      INSERT INTO ai_alerts(imei, alert_type, severity, risk_score, label, color, data, pattern_detected)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id
    `, [imei, alertType, severity, riskScore, def.label,
        def.color||'#6B7280', JSON.stringify(data), pattern?.type||null]);
    alert.id = r.rows[0]?.id;
  } catch(e) {
    // Table peut ne pas exister encore — init
    await initAIAlertTable();
  }

  // Récupérer le contexte véhicule/conducteur pour les notifications
  const context = await getAlertContext(imei);
  alert.vehicleLabel = context.vehicleLabel;
  alert.driverPhone  = context.driverPhone;
  alert.managerPhone = context.managerPhone;
  alert.managerEmail = context.managerEmail;

  // Broadcaster dashboard en temps réel
  if (broadcaster) {
    broadcaster({
      type:       'ai_alert',
      alert,
      flash:      severity === 'critical',
    });
  }

  // Actions de notification
  await dispatchNotifications(alert, context);

  // Traiter le pattern détecté (génère une alerte séparée de plus haute priorité)
  if (pattern) {
    await processAlert(pattern.type, imei, pattern.data);
  }

  logger.info(`[AlertAI] ${def.icon||'⚠️'} ${def.label} | ${imei} | score:${riskScore} | sévérité:${severity}`);
  return alert;
}

// ══════════════════════════════════════════════════════════════
//  COUCHE 4 — DISPATCH DES NOTIFICATIONS
// ══════════════════════════════════════════════════════════════

async function dispatchNotifications(alert, context) {
  const { severity, riskScore, type, label, icon, data } = alert;
  const { driverPhone, managerPhone, managerEmail, vehicleLabel } = context;

  const msg = buildSMSMessage(icon, label, vehicleLabel, data);

  // SMS — uniquement si score > 60 et canal sms activé
  if (alert.channels.includes('sms') && riskScore >= 60) {
    if (managerPhone) {
      await notification.sendSMS({ to: managerPhone, message: msg }).catch(()=>{});
    }
    // Conducteur — uniquement pour les alertes qui le concernent directement
    if (['fatigue_driving','overspeed','harsh_brake'].includes(type) && driverPhone) {
      await notification.sendSMS({ to: driverPhone, message: buildDriverSMS(type, data) }).catch(()=>{});
    }
  }

  // Email — uniquement pour les alertes critiques
  if (alert.channels.includes('email') && severity === 'critical' && managerEmail) {
    await notification.sendEmail({
      to:      managerEmail,
      subject: `${icon} ${label} — ${vehicleLabel}`,
      html:    buildEmailHTML(alert, context),
    }).catch(()=>{});
  }

  // Escalade — si l'alerte a le flag escalate et n'est pas acquittée après 5min
  if (alert.escalate && alert.id) {
    setTimeout(async () => {
      const r = await pool.query(
        'SELECT acknowledged FROM ai_alerts WHERE id=$1', [alert.id]
      ).catch(() => ({ rows: [{ acknowledged: true }] }));
      if (!r.rows[0]?.acknowledged && managerPhone) {
        await notification.sendSMS({
          to:      managerPhone,
          message: `🔺 ESCALADE OROS: Alerte "${label}" sur ${vehicleLabel} non acquittée depuis 5 minutes. Vérifiez immédiatement.`
        }).catch(()=>{});
        logger.warn(`[AlertAI] Escalade déclenchée: ${alert.id} ${label}`);
      }
    }, 5 * 60 * 1000);
  }
}

function buildSMSMessage(icon, label, vehicleLabel, data) {
  const parts = [`${icon} OROS: ${label}`, vehicleLabel];
  if (data?.speed) parts.push(`${data.speed}km/h`);
  if (data?.geofence) parts.push(`Zone: ${data.geofence}`);
  if (data?.battery) parts.push(`Batterie: ${data.battery}%`);
  return parts.filter(Boolean).join(' — ');
}

function buildDriverSMS(type, data) {
  const msgs = {
    fatigue_driving: `😴 OROS Coach: Vous conduisez depuis ${data.hours||'plusieurs'}h. Faites une pause de 20 minutes.`,
    overspeed:       `🚨 OROS: Vous êtes à ${data.speed}km/h. Ralentissez immédiatement.`,
    harsh_brake:     `⚠️ OROS Coach: Freinage brusque détecté. Anticipez davantage.`,
  };
  return msgs[type] || '';
}

function buildEmailHTML(alert, context) {
  const severityColors = { critical:'#DC2626', high:'#EA580C', medium:'#D97706', low:'#6B7280' };
  const color = severityColors[alert.severity] || '#6B7280';
  const mapsUrl = alert.data?.lat ? `https://maps.google.com/?q=${alert.data.lat},${alert.data.lon}` : null;

  return `
    <div style="font-family:Arial,sans-serif;max-width:520px">
      <div style="background:${color};color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
        <div style="font-size:32px;margin-bottom:8px">${alert.icon}</div>
        <h2 style="margin:0;font-size:18px">${alert.label}</h2>
        <div style="opacity:0.8;font-size:13px;margin-top:4px">Score de risque IA: ${alert.riskScore}/100</div>
      </div>
      <div style="background:#F8FAFD;border:1px solid #E8ECF2;padding:20px 24px;border-radius:0 0 8px 8px">
        <table style="width:100%;font-size:13px;border-collapse:collapse">
          <tr><td style="padding:6px 0;color:#6B7280;width:140px">Véhicule</td><td style="font-weight:600">${context.vehicleLabel}</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280">Conducteur</td><td>${context.driverName||'Non identifié'}</td></tr>
          <tr><td style="padding:6px 0;color:#6B7280">Sévérité</td><td><span style="background:${color}20;color:${color};padding:2px 8px;border-radius:99px;font-weight:600">${alert.severity.toUpperCase()}</span></td></tr>
          <tr><td style="padding:6px 0;color:#6B7280">Heure</td><td>${new Date(alert.timestamp).toLocaleString('fr-FR')}</td></tr>
          ${alert.data?.speed ? `<tr><td style="padding:6px 0;color:#6B7280">Vitesse</td><td style="font-weight:700;color:${color}">${alert.data.speed} km/h</td></tr>` : ''}
          ${alert.patternDetected ? `<tr><td style="padding:6px 0;color:#6B7280">Pattern IA</td><td style="color:#7C3AED;font-weight:600">⚡ ${alert.patternDetected}</td></tr>` : ''}
        </table>
        ${mapsUrl ? `<a href="${mapsUrl}" style="display:inline-block;margin-top:16px;background:#1E6FD9;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">📍 Voir la position</a>` : ''}
        <p style="margin-top:16px;font-size:11px;color:#9CA3AF">Alerte #${alert.id} — Oros Mobility · Connectez-vous pour acquitter</p>
      </div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════
//  UTILITAIRES
// ══════════════════════════════════════════════════════════════

async function getAlertContext(imei) {
  try {
    const r = await pool.query(`
      SELECT d.name AS device_name, v.plate, v.brand, v.model, v.type AS vtype,
             dr.name AS driver_name, dr.phone AS driver_phone,
             u.email AS manager_email, u.phone AS manager_phone
      FROM devices d
      LEFT JOIN vehicles v ON v.device_id=d.id AND v.active=true
      LEFT JOIN assignments a ON a.vehicle_id=v.id AND a.ended_at IS NULL
      LEFT JOIN drivers dr ON dr.id=a.driver_id
      LEFT JOIN users u ON u.role IN ('admin','manager','superadmin') AND u.active=true
      WHERE d.imei=$1 LIMIT 1
    `, [imei]);
    const row = r.rows[0] || {};
    return {
      vehicleLabel:  row.plate ? `${row.brand} ${row.model} (${row.plate})` : (row.device_name || imei),
      driverName:    row.driver_name,
      driverPhone:   row.driver_phone,
      managerPhone:  row.manager_phone,
      managerEmail:  row.manager_email,
    };
  } catch(e) {
    return { vehicleLabel: imei, driverName: null, driverPhone: null, managerPhone: null, managerEmail: null };
  }
}

async function initAIAlertTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_alerts (
      id               SERIAL PRIMARY KEY,
      imei             TEXT NOT NULL,
      alert_type       TEXT NOT NULL,
      severity         TEXT NOT NULL DEFAULT 'medium',
      risk_score       INTEGER DEFAULT 0,
      label            TEXT,
      color            TEXT DEFAULT '#6B7280',
      data             JSONB DEFAULT '{}',
      pattern_detected TEXT,
      acknowledged     BOOLEAN DEFAULT false,
      acknowledged_by  INTEGER REFERENCES users(id),
      acknowledged_at  TIMESTAMPTZ,
      snoozed_until    TIMESTAMPTZ,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ai_alerts_imei    ON ai_alerts(imei, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_alerts_unack   ON ai_alerts(acknowledged) WHERE acknowledged=false;
    CREATE INDEX IF NOT EXISTS idx_ai_alerts_score   ON ai_alerts(risk_score DESC);
  `).catch(()=>{});
}

// ── API : récupérer les alertes avec filtres ──────────────────────────
async function getAlerts(filters = {}) {
  const {
    acknowledged = false,
    severity,
    imei,
    from,
    limit = 100,
    minScore = 0,
  } = filters;

  try {
    let q = `
      SELECT a.*, d.name AS device_name, v.plate, v.brand, v.model,
             dr.name AS driver_name, u.name AS ack_by_name
      FROM ai_alerts a
      LEFT JOIN devices d ON d.imei=a.imei
      LEFT JOIN vehicles v ON v.device_id=d.id AND v.active=true
      LEFT JOIN assignments asgn ON asgn.vehicle_id=v.id AND asgn.ended_at IS NULL
      LEFT JOIN drivers dr ON dr.id=asgn.driver_id
      LEFT JOIN users u ON u.id=a.acknowledged_by
      WHERE a.acknowledged=$1 AND a.risk_score >= $2
        AND (a.snoozed_until IS NULL OR a.snoozed_until < NOW())
    `;
    const params = [acknowledged, minScore];
    if (severity) { params.push(severity); q += ` AND a.severity=$${params.length}`; }
    if (imei)     { params.push(imei);     q += ` AND a.imei=$${params.length}`; }
    if (from)     { params.push(from);     q += ` AND a.created_at >= $${params.length}`; }
    q += ` ORDER BY a.risk_score DESC, a.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const r = await pool.query(q, params);
    return r.rows;
  } catch(e) {
    await initAIAlertTable();
    return [];
  }
}

// Acquitter une alerte
async function acknowledgeAlert(alertId, userId) {
  await pool.query(
    'UPDATE ai_alerts SET acknowledged=true, acknowledged_by=$1, acknowledged_at=NOW() WHERE id=$2',
    [userId, alertId]
  );
}

// Acquitter toutes les alertes
async function acknowledgeAll(userId, severity) {
  const params = [userId];
  let q = 'UPDATE ai_alerts SET acknowledged=true, acknowledged_by=$1, acknowledged_at=NOW() WHERE acknowledged=false';
  if (severity) { params.push(severity); q += ` AND severity=$${params.length}`; }
  await pool.query(q, params);
}

// Snooze une alerte (silencieux pendant N minutes)
async function snoozeAlert(alertId, minutes = 30) {
  await pool.query(
    'UPDATE ai_alerts SET snoozed_until=$1 WHERE id=$2',
    [new Date(Date.now() + minutes * 60000), alertId]
  );
}

// Statistiques pour le dashboard
async function getAlertStats() {
  try {
    const r = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE NOT acknowledged AND severity='critical') AS critical,
        COUNT(*) FILTER (WHERE NOT acknowledged AND severity='high')     AS high,
        COUNT(*) FILTER (WHERE NOT acknowledged AND severity='medium')   AS medium,
        COUNT(*) FILTER (WHERE NOT acknowledged AND severity='low')      AS low,
        COUNT(*) FILTER (WHERE NOT acknowledged)                          AS total,
        ROUND(AVG(risk_score)) FILTER (WHERE NOT acknowledged)           AS avg_score,
        COUNT(*) FILTER (WHERE created_at > NOW()-INTERVAL '1 hour' AND NOT acknowledged) AS last_hour,
        COUNT(*) FILTER (WHERE alert_type='sos' AND created_at > NOW()-INTERVAL '24 hours') AS sos_24h
      FROM ai_alerts
    `);
    return r.rows[0] || {};
  } catch(e) { return {}; }
}

// Tendances pour les graphiques
async function getAlertTrends(days = 7) {
  try {
    const r = await pool.query(`
      SELECT
        DATE(created_at) AS day,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE severity='critical') AS critical,
        COUNT(*) FILTER (WHERE severity='high')     AS high,
        ROUND(AVG(risk_score))                      AS avg_score,
        COUNT(DISTINCT imei)                         AS vehicles_affected
      FROM ai_alerts
      WHERE created_at > NOW() - ($1 || ' days')::INTERVAL
      GROUP BY DATE(created_at)
      ORDER BY day
    `, [days]);
    return r.rows;
  } catch(e) { return []; }
}

// Top véhicules à risque
async function getHighRiskVehicles(limit = 10) {
  try {
    const r = await pool.query(`
      SELECT a.imei, v.plate, v.brand, v.model,
             COUNT(*) AS alert_count,
             ROUND(AVG(a.risk_score)) AS avg_risk,
             MAX(a.risk_score) AS max_risk,
             COUNT(*) FILTER (WHERE a.severity='critical') AS critical_count
      FROM ai_alerts a
      LEFT JOIN devices d ON d.imei=a.imei
      LEFT JOIN vehicles v ON v.device_id=d.id AND v.active=true
      WHERE a.created_at > NOW() - INTERVAL '7 days'
      GROUP BY a.imei, v.plate, v.brand, v.model
      ORDER BY avg_risk DESC, alert_count DESC
      LIMIT $1
    `, [limit]);
    return r.rows;
  } catch(e) { return []; }
}

initAIAlertTable();

module.exports = {
  processAlert,
  getAlerts,
  getAlertStats,
  getAlertTrends,
  getHighRiskVehicles,
  acknowledgeAlert,
  acknowledgeAll,
  snoozeAlert,
  setBroadcaster,
  ALERT_TYPES,
  alertContext,
};
