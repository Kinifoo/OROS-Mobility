/**
 * OROS MOBILITY — Système de plans & gating des fonctionnalités
 * ══════════════════════════════════════════════════════════════
 *
 * 3 offres :
 *   STARTER  — Tracking de base, alertes simples
 *   BUSINESS — Flotte complète, revenus, scoring
 *   PRO      — IA, immobilisation auto, radars vocaux, multi-tenant
 *
 * Gating :
 *   - Par organisation (plan souscrit)
 *   - Par utilisateur (rôle + overrides individuels)
 *   - Middleware Express qui bloque les routes non autorisées
 *   - Frontend : composants verrouillés avec modal d'upgrade
 * ══════════════════════════════════════════════════════════════
 */
'use strict';

// ══════════════════════════════════════════════════════════════
//  DÉFINITION DES PLANS
// ══════════════════════════════════════════════════════════════

const PLANS = {
  starter: {
    id:          'starter',
    name:        'Starter',
    tagline:     'L\'essentiel du tracking GPS',
    color:       '#1E6FD9',
    price_fcfa:  9900,
    price_label: '9 900 FCFA / mois / véhicule',
    max_vehicles: 10,
    max_users:    3,
    features:    new Set([
      // Tracking de base
      'live_map', 'realtime_positions', 'history_replay', 'basic_alerts',
      'device_management', 'offline_alert', 'battery_alert',
      // Géofences basiques
      'geofences_basic',
      // Rapports simples
      'trips_basic', 'export_csv',
      // Profil / auth
      'user_profile', 'dashboard_basic',
    ]),
  },

  business: {
    id:          'business',
    name:        'Business',
    tagline:     'Gestion de flotte complète',
    color:       '#7C3AED',
    price_fcfa:  19900,
    price_label: '19 900 FCFA / mois / véhicule',
    max_vehicles: 50,
    max_users:   10,
    badge:       'Populaire',
    features:    new Set([
      // Tout Starter +
      'live_map', 'realtime_positions', 'history_replay', 'basic_alerts',
      'device_management', 'offline_alert', 'battery_alert',
      'geofences_basic',  'trips_basic', 'export_csv',
      'user_profile', 'dashboard_basic',
      // Gestion flotte
      'vehicles_full', 'drivers_full', 'assignments',
      'maintenance_full', 'documents_expiry',
      // Revenus & Mobile Money
      'revenues', 'mobile_money', 'revenue_reports',
      // Score conducteur
      'driver_score', 'driver_coaching',
      // Alertes avancées
      'geofences_advanced', 'overspeed_alert', 'harsh_events',
      'alert_sms', 'alert_email',
      // Rapports
      'trips_advanced', 'export_pdf', 'analytics_basic',
      // Carburant
      'fuel_management',
      // Immobilisation manuelle
      'manual_immobilization',
      // Maintenance prédictive basique
      'predictive_basic',
    ]),
  },

  pro: {
    id:          'pro',
    name:        'Pro',
    tagline:     'Intelligence artificielle & automatisation',
    color:       '#DC2626',
    price_fcfa:  39900,
    price_label: '39 900 FCFA / mois / véhicule',
    max_vehicles: null, // illimité
    max_users:   null,
    badge:       'Complet',
    features:    new Set([
      // Tout Business +
      'live_map', 'realtime_positions', 'history_replay', 'basic_alerts',
      'device_management', 'offline_alert', 'battery_alert',
      'geofences_basic', 'geofences_advanced', 'trips_basic', 'export_csv',
      'user_profile', 'dashboard_basic',
      'vehicles_full', 'drivers_full', 'assignments',
      'maintenance_full', 'documents_expiry',
      'revenues', 'mobile_money', 'revenue_reports',
      'driver_score', 'driver_coaching',
      'overspeed_alert', 'harsh_events', 'alert_sms', 'alert_email',
      'trips_advanced', 'export_pdf', 'analytics_basic',
      'fuel_management', 'manual_immobilization', 'predictive_basic',
      // PRO exclusif
      'ai_alerts',             // Système d'alertes IA
      'auto_immobilization',   // Immobilisation auto si recette impayée
      'radar_voice_alerts',    // Alertes radars vocales
      'gamification',          // Badges & leaderboard
      'live_share',            // Partage position public
      'sos_workflow',          // Workflow SOS complet
      'heatmap',               // Carte de chaleur
      'route_optimization',    // Optimisation tournées
      'predictive_ai',         // Maintenance prédictive IA complète
      'analytics_advanced',    // Analytics avec graphiques
      'multi_tenant',          // Gestion multi-clients
      'api_access',            // API publique
      'white_label',           // White-label
      'unlimited_history',     // Historique illimité
      'fuel_siphoning',        // Détection siphonnage
    ]),
  },
};

// ── Features groupées pour affichage ──────────────────────────────────
const FEATURE_GROUPS = [
  {
    group: 'Tracking GPS',
    icon:  '🗺️',
    features: [
      { id:'live_map',           label:'Carte en temps réel',          starter:true,  business:true,  pro:true  },
      { id:'realtime_positions', label:'Positions live WebSocket',      starter:true,  business:true,  pro:true  },
      { id:'history_replay',     label:'Historique & replay',           starter:true,  business:true,  pro:true  },
      { id:'geofences_basic',    label:'Géofences (3 zones max)',        starter:true,  business:false, pro:false },
      { id:'geofences_advanced', label:'Géofences illimitées + heures', starter:false, business:true,  pro:true  },
      { id:'heatmap',            label:'Heatmap zones fréquentées',     starter:false, business:false, pro:true  },
      { id:'unlimited_history',  label:'Historique illimité (365j)',    starter:false, business:false, pro:true  },
    ],
  },
  {
    group: 'Gestion de flotte',
    icon:  '🚗',
    features: [
      { id:'vehicles_full',   label:'Véhicules & conducteurs',         starter:false, business:true, pro:true  },
      { id:'assignments',     label:'Affectations conducteur/véhicule',starter:false, business:true, pro:true  },
      { id:'maintenance_full',label:'Maintenance & rappels',            starter:false, business:true, pro:true  },
      { id:'documents_expiry',label:'Documents & alertes expiration',  starter:false, business:true, pro:true  },
      { id:'fuel_management', label:'Gestion carburant',               starter:false, business:true, pro:true  },
      { id:'fuel_siphoning',  label:'Détection siphonnage',            starter:false, business:false,pro:true  },
    ],
  },
  {
    group: 'Alertes & Sécurité',
    icon:  '🚨',
    features: [
      { id:'basic_alerts',          label:'Alertes de base',                starter:true,  business:true, pro:true  },
      { id:'overspeed_alert',       label:'Survitesse configurable',        starter:false, business:true, pro:true  },
      { id:'harsh_events',          label:'Freinage/accélération brusque',  starter:false, business:true, pro:true  },
      { id:'alert_sms',             label:'Notifications SMS',              starter:false, business:true, pro:true  },
      { id:'ai_alerts',             label:'Alertes IA (scoring, patterns)', starter:false, business:false,pro:true  },
      { id:'sos_workflow',          label:'Workflow SOS d\'urgence',        starter:false, business:false,pro:true  },
      { id:'radar_voice_alerts',    label:'Radars avec alertes vocales',    starter:false, business:false,pro:true  },
    ],
  },
  {
    group: 'Performance conducteur',
    icon:  '🏆',
    features: [
      { id:'driver_score',    label:'Score de conduite',                starter:false, business:true,  pro:true },
      { id:'driver_coaching', label:'Coaching IA SMS temps réel',       starter:false, business:true,  pro:true },
      { id:'gamification',    label:'Badges & classement gamifié',      starter:false, business:false, pro:true },
    ],
  },
  {
    group: 'Finance & Revenus',
    icon:  '💰',
    features: [
      { id:'revenues',             label:'Saisie des recettes',              starter:false, business:true,  pro:true  },
      { id:'mobile_money',         label:'Mobile Money (Orange/Wave/MTN)',   starter:false, business:true,  pro:true  },
      { id:'manual_immobilization',label:'Immobilisation manuelle',          starter:false, business:true,  pro:true  },
      { id:'auto_immobilization',  label:'Immobilisation auto (recettes)',   starter:false, business:false, pro:true  },
    ],
  },
  {
    group: 'Analytics & Rapports',
    icon:  '📊',
    features: [
      { id:'export_csv',          label:'Export CSV/Excel',               starter:true,  business:true, pro:true },
      { id:'export_pdf',          label:'Rapports PDF',                   starter:false, business:true, pro:true },
      { id:'analytics_basic',     label:'Graphiques et tendances',        starter:false, business:true, pro:true },
      { id:'analytics_advanced',  label:'Analytics IA avancées',          starter:false, business:false,pro:true },
      { id:'route_optimization',  label:'Optimisation d\'itinéraires',    starter:false, business:false,pro:true },
      { id:'predictive_ai',       label:'Maintenance prédictive IA',      starter:false, business:false,pro:true },
    ],
  },
  {
    group: 'Plateforme & API',
    icon:  '⚙️',
    features: [
      { id:'live_share',   label:'Partage de position public',   starter:false, business:false, pro:true },
      { id:'api_access',   label:'API REST documentée',          starter:false, business:false, pro:true },
      { id:'multi_tenant', label:'Multi-clients (revendeur)',     starter:false, business:false, pro:true },
      { id:'white_label',  label:'White-label (votre marque)',    starter:false, business:false, pro:true },
    ],
  },
];

// ══════════════════════════════════════════════════════════════
//  BASE DE DONNÉES — organisations & souscriptions
// ══════════════════════════════════════════════════════════════

const { pool } = require('./database');
const logger   = require('./utils/logger');

async function initPlansSchema() {
  await pool.query(`
    -- Table organisations (une par flotte cliente)
    CREATE TABLE IF NOT EXISTS organizations (
      id              SERIAL PRIMARY KEY,
      name            TEXT NOT NULL,
      plan            TEXT NOT NULL DEFAULT 'starter',
      plan_expires_at DATE,
      max_vehicles    INTEGER,
      max_users       INTEGER,
      feature_overrides JSONB DEFAULT '{}',
      active          BOOLEAN DEFAULT true,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );

    -- Lier les users à une organisation
    ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS feature_overrides JSONB DEFAULT '{}';

    -- Index
    CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
    CREATE INDEX IF NOT EXISTS idx_org_plan  ON organizations(plan);

    -- Organisation par défaut (pour les installations mono-tenant)
    INSERT INTO organizations(id, name, plan, active)
    VALUES(1, 'GEOTRACK CI', 'pro', true)
    ON CONFLICT(id) DO NOTHING;

    -- Lier les users existants à l'org par défaut
    UPDATE users SET org_id=1 WHERE org_id IS NULL;
  `).catch(e => {
    if (!e.message?.includes('already exists')) logger.error('initPlansSchema: ' + e.message);
  });
}

// ══════════════════════════════════════════════════════════════
//  VÉRIFICATION D'ACCÈS
// ══════════════════════════════════════════════════════════════

/**
 * Vérifie si un utilisateur a accès à une fonctionnalité
 * Ordre de priorité :
 *   1. Override individuel (user.feature_overrides)
 *   2. Plan de l'organisation
 *   3. Override organisation (org.feature_overrides)
 */
async function canAccess(userId, featureId) {
  try {
    const r = await pool.query(`
      SELECT u.role, u.feature_overrides AS user_overrides,
             o.plan, o.feature_overrides AS org_overrides,
             o.plan_expires_at, o.active AS org_active
      FROM users u
      LEFT JOIN organizations o ON o.id = u.org_id
      WHERE u.id = $1
    `, [userId]);

    if (!r.rows[0]) return false;
    const { role, user_overrides, plan, org_overrides, plan_expires_at, org_active } = r.rows[0];

    // SuperAdmin voit tout
    if (role === 'superadmin') return true;

    // Organisation inactive
    if (org_active === false) return false;

    // Plan expiré
    if (plan_expires_at && new Date(plan_expires_at) < new Date()) return false;

    // 1. Override individuel (priorité maximale)
    const userOvr = user_overrides || {};
    if (featureId in userOvr) return userOvr[featureId] === true;

    // 2. Override organisation
    const orgOvr = org_overrides || {};
    if (featureId in orgOvr) return orgOvr[featureId] === true;

    // 3. Plan de base
    const planDef = PLANS[plan] || PLANS.starter;
    return planDef.features.has(featureId);
  } catch (e) {
    logger.error('[Plans] canAccess: ' + e.message);
    return false;
  }
}

/**
 * Récupère le profil d'accès complet d'un utilisateur
 * (toutes ses features autorisées + infos plan)
 */
async function getUserAccessProfile(userId) {
  try {
    const r = await pool.query(`
      SELECT u.id, u.name, u.email, u.role,
             u.feature_overrides AS user_overrides,
             o.id AS org_id, o.name AS org_name, o.plan,
             o.feature_overrides AS org_overrides,
             o.plan_expires_at, o.max_vehicles, o.max_users
      FROM users u
      LEFT JOIN organizations o ON o.id = u.org_id
      WHERE u.id = $1
    `, [userId]);

    if (!r.rows[0]) return null;
    const row = r.rows[0];
    const planDef = PLANS[row.plan] || PLANS.starter;

    // Calculer les features effectives
    const effectiveFeatures = new Set([...planDef.features]);
    const orgOvr  = row.org_overrides  || {};
    const userOvr = row.user_overrides || {};

    // Appliquer les overrides
    for (const [feat, allowed] of Object.entries(orgOvr)) {
      if (allowed) effectiveFeatures.add(feat);
      else effectiveFeatures.delete(feat);
    }
    for (const [feat, allowed] of Object.entries(userOvr)) {
      if (allowed) effectiveFeatures.add(feat);
      else effectiveFeatures.delete(feat);
    }

    return {
      userId:        row.id,
      name:          row.name,
      email:         row.email,
      role:          row.role,
      orgId:         row.org_id,
      orgName:       row.org_name,
      plan:          row.plan,
      planName:      planDef.name,
      planColor:     planDef.color,
      planExpiresAt: row.plan_expires_at,
      maxVehicles:   row.max_vehicles || planDef.max_vehicles,
      maxUsers:      row.max_users    || planDef.max_users,
      features:      [...effectiveFeatures],
      userOverrides: userOvr,
      orgOverrides:  orgOvr,
    };
  } catch (e) {
    logger.error('[Plans] getUserAccessProfile: ' + e.message);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
//  MIDDLEWARE EXPRESS
// ══════════════════════════════════════════════════════════════

/**
 * Middleware : vérifie qu'un user a accès à une feature
 * Usage: app.get('/api/ai-alerts', authMiddleware, requireFeature('ai_alerts'), handler)
 */
function requireFeature(featureId) {
  return async (req, res, next) => {
    if (req.user?.role === 'superadmin') return next();
    const ok = await canAccess(req.user?.id, featureId);
    if (!ok) {
      return res.status(403).json({
        error:     'feature_not_available',
        feature:   featureId,
        message:   `Cette fonctionnalité n'est pas incluse dans votre plan.`,
        upgradeUrl:'/plans',
      });
    }
    next();
  };
}

// ══════════════════════════════════════════════════════════════
//  GESTION DES PLANS & OVERRIDES (admin)
// ══════════════════════════════════════════════════════════════

async function getOrganizations() {
  const r = await pool.query(`
    SELECT o.*, COUNT(u.id) AS user_count,
           COUNT(v.id) AS vehicle_count
    FROM organizations o
    LEFT JOIN users u ON u.org_id=o.id AND u.active=true
    LEFT JOIN devices d ON true -- join simplifié
    LEFT JOIN vehicles v ON v.active=true
    WHERE o.active=true
    GROUP BY o.id ORDER BY o.name
  `).catch(() => ({ rows: [] }));
  return r.rows;
}

async function updateOrgPlan(orgId, plan, expiresAt, overrides) {
  await pool.query(`
    UPDATE organizations SET
      plan=$1, plan_expires_at=$2,
      feature_overrides=COALESCE($3::jsonb, feature_overrides),
      updated_at=NOW()
    WHERE id=$4
  `, [plan, expiresAt || null, overrides ? JSON.stringify(overrides) : null, orgId]);
  logger.info(`[Plans] Org #${orgId} → plan ${plan}`);
}

async function updateUserOverrides(userId, overrides) {
  await pool.query(
    'UPDATE users SET feature_overrides=$1 WHERE id=$2',
    [JSON.stringify(overrides), userId]
  );
  logger.info(`[Plans] User #${userId} overrides mis à jour`);
}

async function createOrganization(data) {
  const { name, plan='starter', maxVehicles, maxUsers } = data;
  const planDef = PLANS[plan] || PLANS.starter;
  const r = await pool.query(`
    INSERT INTO organizations(name, plan, max_vehicles, max_users)
    VALUES($1,$2,$3,$4) RETURNING *
  `, [name, plan, maxVehicles || planDef.max_vehicles, maxUsers || planDef.max_users]);
  return r.rows[0];
}

initPlansSchema();

module.exports = {
  PLANS,
  FEATURE_GROUPS,
  canAccess,
  getUserAccessProfile,
  requireFeature,
  getOrganizations,
  updateOrgPlan,
  updateUserOverrides,
  createOrganization,
};
