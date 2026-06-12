/**
 * OROS — TCP Manager
 * Serveur GPS multi-protocoles + exécution des commandes distantes
 */
'use strict';

const net          = require('net');
const logger       = require('./utils/logger');
const { getWebSocketBroadcaster } = require('./websocket');
const { savePosition, saveEvent, pool } = require('./database');
const alertEngine  = require('./alert-engine');
const radarAlerts  = require('./radar-alerts');
const tripDetector = require('./trip-detector');

const gt06Decoder      = require('./protocols/gt06');
const teltonikaDecoder = require('./protocols/teltonika');
const h02Decoder       = require('./protocols/h02');
const tk103Decoder     = require('./protocols/tk103');

// ── Registre des connexions actives ──────────────────────────────────
// imei → { socket, protocol, model, connectedAt, serialNum }
const connections = new Map();

// Compteur série pour les commandes GT06
let globalSerial = Math.floor(Math.random() * 0xFFFF);
function nextSerial() { globalSerial = (globalSerial + 1) & 0xFFFF; return globalSerial; }

// ── Fabrique de serveur TCP ───────────────────────────────────────────
function createTCPServer(protocolName, port, decoder) {
  const server = net.createServer((socket) => {
    const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
    let deviceImei = null;
    let buffer = Buffer.alloc(0);
    let lastSerial = 0;

    socket.setTimeout(600000);
    socket.on('timeout', () => socket.destroy());

    logger.tcp(`[${protocolName}] + ${clientId}`);

    socket.on('data', async (data) => {
      buffer = Buffer.concat([buffer, data]);
      try {
        const result = decoder.decode(buffer, socket);
        if (!result) return;
        buffer = result.remaining || Buffer.alloc(0);

        for (const msg of (result.messages || [])) {

          // LOGIN ────────────────────────────────────────────────────
          if (msg.type === 'login') {
            deviceImei = msg.imei;
            lastSerial = msg.serialNum || 0;
            connections.set(deviceImei, {
              socket, protocol: protocolName,
              connectedAt: new Date(), serialNum: lastSerial,
            });
            logger.tcp(`[${protocolName}] ID: ${deviceImei}`);
            if (result.ack) socket.write(result.ack);
            broadcast({ type: 'device_online', imei: deviceImei, protocol: protocolName });
            // Mettre le traceur en ligne dans la DB
            await pool.query("UPDATE devices SET status='online',last_seen=NOW() WHERE imei=$1", [deviceImei]).catch(()=>{});
          }

          // POSITION ─────────────────────────────────────────────────
          if (msg.type === 'position' && deviceImei) {
            lastSerial = msg.serialNum || lastSerial;
            const pos = {
              imei: deviceImei, protocol: protocolName,
              lat: msg.lat, lon: msg.lon, speed: msg.speed || 0,
              heading: msg.heading || 0, altitude: msg.altitude || 0,
              satellites: msg.satellites || 0, ignition: msg.ignition || false,
              accuracy: msg.accuracy || 0, timestamp: msg.timestamp || new Date(),
              rpm: msg.rpm||null, fuel: msg.fuel||null,
              engineTemp: msg.engineTemp||null, odometer: msg.odometer||null,
              battery: msg.battery||null, raw: msg.raw||null,
            };
            await savePosition(pos);
            broadcast({ type: 'position', ...pos });
            try { await alertEngine.analyzePosition(pos); } catch(e){ logger.error('[AlertEngine] '+e.message); }
            try { await tripDetector.processPosition(pos); } catch(e){ logger.error('[TripDetector] '+e.message); }

            // 5. Alertes radars vocales
            try {
              const radarAlert = await radarAlerts.checkRadarProximity(pos);
              if (radarAlert) {
                broadcast(radarAlert); // Envoi direct au dashboard/app conducteur
                logger.info(\`[Radar] Alerte vocale → \${pos.imei} : \${radarAlert.radarLabel} \${radarAlert.distance}m\`);
              }
            } catch(e){ logger.error('[Radar] '+e.message); }
            if (result.posAck) socket.write(result.posAck);
          }

          // ALARME ───────────────────────────────────────────────────
          if (msg.type === 'alarm' && deviceImei) {
            await saveEvent({ imei: deviceImei, eventType: msg.alarm, data: msg.data || {} });
            broadcast({ type: 'alert', eventType: msg.alarm, imei: deviceImei });
            logger.warn(`[ALARME] ${deviceImei} → ${msg.alarm}`);
            // SOS : workflow d'urgence
            if (msg.alarm === 'sos') await handleSOS(deviceImei, msg);
            if (result.posAck) socket.write(result.posAck);
          }

          // HEARTBEAT ────────────────────────────────────────────────
          if (msg.type === 'heartbeat') {
            if (result.heartbeatAck) socket.write(result.heartbeatAck);
          }

          // ACK COMMANDE (retour du traceur après ENGINE CUT/RESTORE) ─
          if (msg.type === 'command_ack' && deviceImei) {
            logger.info(`[CMD ACK] ${deviceImei}: ${msg.response}`);
            await pool.query(
              "UPDATE device_commands SET executed=true,response=$1,executed_at=NOW() WHERE device_id=(SELECT id FROM devices WHERE imei=$2) AND executed=false ORDER BY created_at DESC LIMIT 1",
              [msg.response || 'OK', deviceImei]
            ).catch(()=>{});
            broadcast({ type: 'command_ack', imei: deviceImei, response: msg.response });
          }
        }
      } catch (err) {
        logger.error(`[${protocolName}] Décodage ${clientId}: ${err.message}`);
        buffer = Buffer.alloc(0);
      }
    });

    socket.on('close', () => {
      if (deviceImei) {
        connections.delete(deviceImei);
        alertEngine.clearDeviceState(deviceImei);
        pool.query("UPDATE devices SET status='offline' WHERE imei=$1", [deviceImei]).catch(()=>{});
        broadcast({ type: 'device_offline', imei: deviceImei });
        logger.tcp(`[${protocolName}] - ${deviceImei}`);
      }
    });

    socket.on('error', (err) => {
      if (err.code !== 'ECONNRESET') logger.error(`[${protocolName}] Socket: ${err.message}`);
    });
  });

  server.listen(port, '0.0.0.0', () => logger.info(`TCP [${protocolName.padEnd(10)}] → :${port}`));
  server.on('error', (err) => logger.error(`Port ${port} (${protocolName}): ${err.message}`));
  return server;
}

// ── SOS Handler ───────────────────────────────────────────────────────
async function handleSOS(imei, msg) {
  try {
    const r = await pool.query(`
      SELECT d.name, v.plate, dr.name AS driver_name, dr.phone AS driver_phone,
             u.email AS manager_email, u.phone AS manager_phone
      FROM devices d
      LEFT JOIN vehicles v ON v.device_id=d.id AND v.active=true
      LEFT JOIN assignments a ON a.vehicle_id=v.id AND a.ended_at IS NULL
      LEFT JOIN drivers dr ON dr.id=a.driver_id
      LEFT JOIN users u ON u.role IN ('admin','manager') AND u.active=true
      WHERE d.imei=$1 LIMIT 1
    `, [imei]);
    if (!r.rows[0]) return;
    const row = r.rows[0];
    const { sendSMS, sendEmail } = require('./notification');
    const label = row.plate ? `${row.plate} (${row.driver_name||'?'})` : imei;
    const sosMsg = `🆘 SOS URGENT — ${label} a déclenché l'alarme panique. Coordonnées: ${msg.lat?.toFixed(5)},${msg.lon?.toFixed(5)}`;
    if (row.manager_phone) await sendSMS({ to: row.manager_phone, message: sosMsg });
    if (row.manager_email) await sendEmail({ to: row.manager_email, subject: `🆘 SOS — ${label}`, html: `<h2>Alerte SOS</h2><p>${sosMsg}</p>` });
    broadcast({ type: 'sos_alert', imei, label, lat: msg.lat, lon: msg.lon });
    logger.warn(`[SOS] Notifications envoyées pour ${imei}`);
  } catch(e) { logger.error('[SOS] ' + e.message); }
}

// ── Envoi de commande distante ────────────────────────────────────────
function sendCommandToDevice(imei, command, options = {}) {
  const conn = connections.get(imei);
  if (!conn) {
    logger.warn(`[CMD] ${imei} non connecté — commande ${command} mise en attente`);
    return { success: false, error: 'Traceur non connecté en ce moment', queued: true };
  }

  const serial = nextSerial();
  let cmdBuffer = null;

  try {
    switch (conn.protocol) {
      case 'GT06':
        if (options.model?.toLowerCase().includes('micodus')) {
          cmdBuffer = gt06Decoder.COMMANDS_MICODUS[command]?.(serial);
        } else {
          cmdBuffer = gt06Decoder.COMMANDS[command]?.(serial);
        }
        break;
      case 'Teltonika':
        cmdBuffer = teltonikaDecoder.TELTONIKA_COMMANDS[command]?.();
        break;
      case 'H02':
      case 'Seeworld':
        cmdBuffer = h02Decoder.buildH02Command(imei, command);
        break;
      case 'TK103':
        // TK103 utilise des commandes SMS-like simples
        const tk103Cmds = {
          engine_cut:     `DYD#`,
          engine_restore: `HFYD#`,
          get_location:   `POSITION#`,
          reboot:         `REBT#`,
        };
        const cmdStr = tk103Cmds[command];
        if (cmdStr) cmdBuffer = Buffer.from(cmdStr + '\r\n', 'ascii');
        break;
    }

    if (!cmdBuffer) {
      return { success: false, error: `Commande ${command} non supportée pour ${conn.protocol}` };
    }

    conn.socket.write(cmdBuffer);
    logger.info(`[CMD] → ${imei} [${conn.protocol}] ${command} (serial:${serial})`);
    return { success: true, protocol: conn.protocol, serial };

  } catch (err) {
    logger.error(`[CMD] Erreur envoi ${imei}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

function getConnectedDevices() {
  return [...connections.entries()].map(([imei, c]) => ({
    imei, protocol: c.protocol, connectedAt: c.connectedAt
  }));
}

function broadcast(data) {
  try { const fn = getWebSocketBroadcaster(); if (fn) fn(data); } catch(_) {}
}

// Écouter les commandes depuis le WebSocket (scheduler, API)
function listenForCommands(wsBroadcaster) {
  // Intercepter les messages send_command broadcastés
  const origBroadcast = wsBroadcaster;
  return function(data) {
    if (data?.type === 'send_command' && data.imei) {
      setImmediate(() => {
        const result = sendCommandToDevice(data.imei, data.command, data.options || {});
        if (!result.success && !result.queued) {
          logger.warn(`[CMD] Échec ${data.imei} ${data.command}: ${result.error}`);
        }
      });
    }
    origBroadcast(data);
  };
}

async function startTCPServers() {
  createTCPServer('GT06',      parseInt(process.env.PORT_GT06      || 8090), gt06Decoder);
  createTCPServer('Teltonika', parseInt(process.env.PORT_TELTONIKA || 5027), teltonikaDecoder);
  createTCPServer('H02',       parseInt(process.env.PORT_H02       || 5013), h02Decoder);
  createTCPServer('Seeworld',  parseInt(process.env.PORT_SEEWORLD  || 8000), h02Decoder);
  createTCPServer('TK103',     parseInt(process.env.PORT_TK103     || 5002), tk103Decoder);
}

module.exports = { startTCPServers, sendCommandToDevice, getConnectedDevices, listenForCommands };
