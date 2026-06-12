/**
 * Décodeur GT06 / GT02
 * Compatibles: Sinotrack (port 8090), Micodus MV720, Istartek, Concox
 *
 * Format trame: 0x78 0x78 [longueur] [protocole] [données] [numéro_série] [checksum] 0x0D 0x0A
 */

const HEADER_SHORT = Buffer.from([0x78, 0x78]);
const FOOTER       = Buffer.from([0x0D, 0x0A]);

const PROTO_LOGIN    = 0x01;
const PROTO_GPS      = 0x10;
const PROTO_GPS_LBS  = 0x12;
const PROTO_STATUS   = 0x13;
const PROTO_ALARM    = 0x16;
const PROTO_HEARTBEAT= 0x23;
const PROTO_GPS_WIFI = 0x2C;

function checksum(buf, start, end) {
  let sum = 0;
  for (let i = start; i < end; i++) sum ^= buf[i];
  // Certains traceurs GT06 utilisent une somme simple mod 256
  return sum & 0xFF;
}

function parseDateTime(buf, offset) {
  const year  = 2000 + buf[offset];
  const month = buf[offset + 1];
  const day   = buf[offset + 2];
  const hour  = buf[offset + 3];
  const min   = buf[offset + 4];
  const sec   = buf[offset + 5];
  return new Date(Date.UTC(year, month - 1, day, hour, min, sec));
}

function parseCoord(raw, positive) {
  // Format GT06: DDDMM.MMMM → degrés décimaux
  const deg = Math.floor(raw / 1000000);
  const min = (raw % 1000000) / 10000;
  const decimal = deg + min / 60;
  return positive ? decimal : -decimal;
}

function decodeGpsFrame(buf, offset) {
  const dt        = parseDateTime(buf, offset);
  const satsGPS   = (buf[offset + 6] >> 4) & 0x0F;
  const rawLat    = buf.readUInt32BE(offset + 7);
  const rawLon    = buf.readUInt32BE(offset + 11);
  const speed     = buf[offset + 15];
  const courseFlags = buf.readUInt16BE(offset + 16);
  const course    = courseFlags & 0x03FF;
  const latN      = (courseFlags >> 2) & 0x01;  // 1=Nord, 0=Sud
  const lonE      = (courseFlags >> 3) & 0x01;  // 1=Est,  0=Ouest
  const realGPS   = (courseFlags >> 4) & 0x01;
  const ignition  = (courseFlags >> 9) & 0x01;

  return {
    timestamp:  dt,
    lat:        parseCoord(rawLat, latN === 1),
    lon:        parseCoord(rawLon, lonE === 1),
    speed,
    heading:    course,
    satellites: satsGPS,
    ignition:   ignition === 1,
    realGPS:    realGPS === 1,
  };
}

function buildAck(serialNum, protocol) {
  const buf = Buffer.allocUnsafe(10);
  buf[0] = 0x78; buf[1] = 0x78;  // Header
  buf[2] = 0x05;                  // Longueur
  buf[3] = protocol;              // Numéro protocole
  buf.writeUInt16BE(serialNum, 4);// Numéro série
  const crc = checksum(buf, 2, 6);
  buf[6] = crc;
  buf[7] = 0x00; // placeholder (certains impl. utilisent 2 bytes CRC)
  buf[8] = 0x0D; buf[9] = 0x0A;  // Footer
  return buf;
}

function decode(buffer, socket) {
  const messages = [];
  let remaining = buffer;
  let posAck = null;
  let ack = null;
  let heartbeatAck = null;

  while (remaining.length >= 5) {
    // Cherche le header 0x78 0x78
    const headerIdx = remaining.indexOf(HEADER_SHORT);
    if (headerIdx === -1) {
      remaining = Buffer.alloc(0);
      break;
    }
    if (headerIdx > 0) remaining = remaining.slice(headerIdx);
    if (remaining.length < 5) break;

    const frameLen  = remaining[2];
    const totalLen  = frameLen + 5; // header(2) + length(1) + data(frameLen) + footer(2)

    if (remaining.length < totalLen) break; // Trame incomplète

    const frame      = remaining.slice(0, totalLen);
    const protocol   = frame[3];
    const dataEnd    = 3 + frameLen - 2; // position du numéro série (2 bytes avant footer)
    const serialNum  = frame.readUInt16BE(dataEnd);
    remaining        = remaining.slice(totalLen);

    try {
      // — LOGIN (0x01)
      if (protocol === PROTO_LOGIN) {
        const imeiRaw = frame.slice(4, 12);
        let imei = '';
        for (const b of imeiRaw) imei += b.toString(16).padStart(2, '0');
        // Supprimer le '0' initial et garder 15 chiffres
        imei = imei.replace(/^0/, '').substring(0, 15);
        ack = buildAck(serialNum, PROTO_LOGIN);
        messages.push({ type: 'login', imei });
      }

      // — POSITION GPS (0x10 / 0x12 / 0x2C)
      else if ([PROTO_GPS, PROTO_GPS_LBS, PROTO_GPS_WIFI].includes(protocol)) {
        const gps = decodeGpsFrame(frame, 4);
        posAck = buildAck(serialNum, protocol);
        messages.push({ type: 'position', ...gps, raw: frame.toString('hex') });
      }

      // — ALARME (0x16)
      else if (protocol === PROTO_ALARM) {
        const gps = decodeGpsFrame(frame, 4);
        const alarmType = frame[4 + 18]; // après les données GPS
        const alarmNames = {
          0x01: 'sos', 0x02: 'power_cut', 0x03: 'vibration',
          0x04: 'enter_fence', 0x05: 'exit_fence', 0x06: 'overspeed',
          0x09: 'low_battery', 0x0E: 'door_open',
        };
        posAck = buildAck(serialNum, protocol);
        messages.push({
          type: 'alarm',
          alarm: alarmNames[alarmType] || `unknown_0x${alarmType?.toString(16)}`,
          ...gps,
        });
      }

      // — HEARTBEAT (0x23)
      else if (protocol === PROTO_HEARTBEAT) {
        heartbeatAck = buildAck(serialNum, PROTO_HEARTBEAT);
        messages.push({ type: 'heartbeat' });
      }

    } catch (err) {
      // Trame invalide, on passe à la suivante
    }
  }

  return { messages, remaining, ack, posAck, heartbeatAck };
}

module.exports = { decode };

// ── COMMANDES DISTANTES GT06 ─────────────────────────────────────────
// Format: 0x78 0x78 [len] 0x80 [content_len] [server_flag:2] [content] [serial:2] [crc] 0x0D 0x0A

function buildCommand(serialNum, commandStr) {
  // Protocole 0x80 = Server Data Transmission (commandes SMS-like)
  const content     = Buffer.from(commandStr, 'ascii');
  const serverFlag  = Buffer.from([0x00, 0x01]); // flag serveur
  const contentLen  = Buffer.from([content.length]);
  const inner       = Buffer.concat([serverFlag, contentLen, content]);
  const serial      = Buffer.allocUnsafe(2);
  serial.writeUInt16BE(serialNum & 0xFFFF);

  const frameData   = Buffer.concat([Buffer.from([0x80]), inner, serial]);
  const frameLen    = Buffer.from([frameData.length + 2]); // +2 pour CRC

  // CRC XOR sur [longueur + données]
  let crc = 0;
  for (const b of Buffer.concat([frameLen, frameData])) crc ^= b;

  return Buffer.concat([
    Buffer.from([0x78, 0x78]),
    frameLen,
    frameData,
    Buffer.from([crc, 0x00, 0x0D, 0x0A]),
  ]);
}

// Commandes standard Sinotrack / Micodus / GT06
const COMMANDS = {
  engine_cut:     (serial) => buildCommand(serial, 'DYD#'),    // Coupure moteur
  engine_restore: (serial) => buildCommand(serial, 'HFYD#'),   // Réactivation moteur
  get_location:   (serial) => buildCommand(serial, 'DWXX#'),   // Demande position
  set_interval:   (serial, n=30) => buildCommand(serial, `SETT${n.toString().padStart(3,'0')}#`), // Intervalle
  reboot:         (serial) => buildCommand(serial, 'REBT#'),   // Redémarrage traceur
  get_status:     (serial) => buildCommand(serial, 'STATUS#'), // Statut complet
};

// Alias Micodus MV720 (légèrement différent)
const COMMANDS_MICODUS = {
  engine_cut:     (serial) => buildCommand(serial, 'Relay,1#'),
  engine_restore: (serial) => buildCommand(serial, 'Relay,0#'),
};

module.exports.buildCommand = buildCommand;
module.exports.COMMANDS     = COMMANDS;
module.exports.COMMANDS_MICODUS = COMMANDS_MICODUS;
