/**
 * OROS MOBILITY SERVER v2.0 — Point d'entrée
 * Toutes les fonctionnalités innovantes activées
 */
'use strict';

require('dotenv').config();

const { initDatabase, extendSchema } = require('./database');
const { startTCPServers, listenForCommands } = require('./tcp-manager');
const { startAPIServer }   = require('./api');
const { setWebSocketBroadcaster } = require('./websocket');
const alertEngine  = require('./alert-engine');
const scheduler    = require('./scheduler');
const sosWorkflow  = require('./sos-workflow');
const logger       = require('./utils/logger');

async function main() {
  console.log('');
  logger.info('╔══════════════════════════════════════════════════╗');
  logger.info('║      OROS MOBILITY v2.0  —  Démarrage           ║');
  logger.info('╚══════════════════════════════════════════════════╝');

  // 1. Base de données
  await initDatabase();
  await extendSchema();
  logger.info('✓ PostgreSQL / TimescaleDB');

  // 2. API + WebSocket
  const apiPort = parseInt(process.env.PORT || 3000);
  const { broadcaster } = await startAPIServer(apiPort);

  // 3. Brancher tous les modules sur le broadcaster
  const smartBroadcaster = listenForCommands(broadcaster);
  setWebSocketBroadcaster(smartBroadcaster);
  alertEngine.setBroadcaster(smartBroadcaster);
  scheduler.setBroadcaster(smartBroadcaster);
  sosWorkflow.setBroadcaster(smartBroadcaster);
  logger.info('✓ WebSocket & modules IA');

  // 4. Serveurs TCP GPS
  await startTCPServers();
  logger.info(`✓ TCP GPS: GT06:${process.env.PORT_GT06||8090} Teltonika:${process.env.PORT_TELTONIKA||5027} H02:${process.env.PORT_H02||5013} TK103:${process.env.PORT_TK103||5002}`);

  // 5. Résumé des fonctionnalités actives
  logger.info('');
  logger.info('🗺️  Suivi GPS multi-protocoles     ✓');
  logger.info('🚨  Moteur d\'alertes temps réel   ✓');
  logger.info('🛣️  Détecteur de trajets auto      ✓');
  logger.info('🏆  Score conducteur (IA)          ✓');
  logger.info('🎮  Gamification & badges          ✓');
  logger.info('🤖  Coaching conducteur IA         ✓');
  logger.info('🔧  Maintenance prédictive         ✓');
  logger.info('⛽  Gestion carburant              ✓');
  logger.info('📄  Documents & expirations        ✓');
  logger.info('🆘  Workflow SOS                   ✓');
  logger.info('🔗  Partage de position public     ✓');
  logger.info('🌡️  Heatmap zones fréquentées     ✓');
  logger.info('🗺️  Optimisation d\'itinéraires    ✓');
  logger.info('💰  Recettes + Mobile Money        ✓');
  logger.info('🚫  Immobilisation auto (PRO)      ✓');
  logger.info('📊  Exports PDF/Excel              ✓');
  logger.info('');
  logger.info(`🌐  Dashboard → http://0.0.0.0:${apiPort}`);
  logger.info(`📡  API REST  → http://0.0.0.0:${apiPort}/api`);
  logger.info('');
}

main().catch(err => { console.error('ERREUR FATALE:', err); process.exit(1); });
