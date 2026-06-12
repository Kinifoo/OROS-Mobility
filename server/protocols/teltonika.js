/**
 * Décodeur Teltonika CODEC8 / CODEC8 Extended
 * Compatibles: FMB920, FMB140, FMC130, FMM130, FMT100
 *
 * Protocole:
 * Connexion → le traceur envoie son IMEI (15 bytes ASCII)
 * Réponse   → 0x01 (accepté) ou 0x00 (refusé)
 * Données   → Preamble(4) + DataLength(4) + CodecID(1) + Records + CRC(4)
 */

// IDs des éléments I/O importants
const IO_IGNITION      = 239;
const IO_MOVEMENT      = 240;
const IO_SPEED         = 24;
const IO_BATTERY_LVL   = 66;
const IO_FUEL_LEVEL    = 48;
const IO_ENGINE_TEMP   = 72;
const IO_RPM           = 36;
const IO_ODOMETER      = 199;
const IO_BATTERY_VOLT  = 67;
const IO_GSENSOR_X     = 17;
const IO_GSENSOR_Y     = 18;
const IO_GSENSOR_Z     = 19;

function parseImei(buf) {
  // Teltonika envoie d'abord: 0x00 0x0F [IMEI 15 bytes ASCII]
  if (buf.length < 17) return null;
  if (buf[0] !== 0x00 || buf[1] !== 0x0F) return null;
  return buf.slice(2, 17).toString('ascii');
}

function parseAVLRecord(buf, offset, extended) {
  const timestamp = Number(buf.readBigUInt64BE(offset));
  offset += 8;
  const priority  = buf[offset++];

  // GPS element
  const lon       = buf.readInt32BE(offset) / 10000000; offset += 4;
  const lat       = buf.readInt32BE(offset) / 10000000; offset += 4;
  const altitude  = buf.readInt16BE(offset);             offset += 2;
  const heading   = buf.readUInt16BE(offset);            offset += 2;
  const satellites= buf[offset++];
  const speed     = buf.readUInt16BE(offset);            offset += 2;

  // Event IO ID
  const eventIOId = extended ? buf.readUInt16BE(offset) : buf[offset];
  offset += extended ? 2 : 1;

  // Total IO count
  const totalIO = extended ? buf.readUInt16BE(offset) : buf[offset];
  offset += extended ? 2 : 1;

  const ioData = {};

  // Parse IO par taille (1, 2, 4, 8 bytes)
  for (const byteSize of [1, 2, 4, 8]) {
    const count = extended ? buf.readUInt16BE(offset) : buf[offset];
    offset += extended ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const id  = extended ? buf.readUInt16BE(offset) : buf[offset];
      offset   += extended ? 2 : 1;
      let val;
      if      (byteSize === 1) { val = buf[offset]; offset += 1; }
      else if (byteSize === 2) { val = buf.readUInt16BE(offset); offset += 2; }
      else if (byteSize === 4) { val = buf.readUInt32BE(offset); offset += 4; }
      else if (byteSize === 8) { val = Number(buf.readBigUInt64BE(offset)); offset += 8; }
      ioData[id] = val;
    }
  }

  return {
    offset,
    record: {
      type:       'position',
      timestamp:  new Date(timestamp),
      lat, lon, altitude, heading, satellites, speed,
      ignition:   ioData[IO_IGNITION] === 1,
      rpm:        ioData[IO_RPM] || null,
      fuel:       ioData[IO_FUEL_LEVEL] || null,
      engineTemp: ioData[IO_ENGINE_TEMP] ? ioData[IO_ENGINE_TEMP] / 10 : null,
      odometer:   ioData[IO_ODOMETER] || null,
      battery:    ioData[IO_BATTERY_LVL] || null,
      batteryVolt:ioData[IO_BATTERY_VOLT] ? ioData[IO_BATTERY_VOLT] / 1000 : null,
      movement:   ioData[IO_MOVEMENT] === 1,
      ioData,
    }
  };
}

function decode(buffer) {
  const messages = [];
  let remaining = buffer;
  let ack = null;

  // Phase 1: Identification IMEI
  if (remaining.length >= 17 && remaining[0] === 0x00 && remaining[1] === 0x0F) {
    const imei = parseImei(remaining);
    if (imei) {
      ack = Buffer.from([0x01]); // Accepter la connexion
      messages.push({ type: 'login', imei });
      remaining = remaining.slice(17);
    }
  }

  // Phase 2: Données AVL
  while (remaining.length >= 12) {
    // Preamble 4 bytes: 0x00 0x00 0x00 0x00
    if (remaining.readUInt32BE(0) !== 0) {
      // Pas un paquet Teltonika valide
      remaining = Buffer.alloc(0);
      break;
    }

    const dataLength = remaining.readUInt32BE(4);
    const totalLength = dataLength + 12; // preamble(4) + length(4) + data + CRC(4)

    if (remaining.length < totalLength) break;

    const codecId   = remaining[8];
    const extended  = codecId === 0x8E;
    const recordCount = remaining[9];
    let offset = 10;

    let posAck = null;

    try {
      for (let i = 0; i < recordCount; i++) {
        const { record, offset: newOffset } = parseAVLRecord(remaining, offset, extended);
        offset = newOffset;
        messages.push(record);
      }

      // CRC (ignoré ici pour la robustesse — valider en prod)
      // const crc = remaining.readUInt32BE(totalLength - 4);

      // ACK: nombre de records reçus
      const ackBuf = Buffer.allocUnsafe(4);
      ackBuf.writeUInt32BE(recordCount, 0);
      posAck = ackBuf;

    } catch (err) {
      // Trame corrompue
    }

    remaining = remaining.slice(totalLength);
    if (posAck) return { messages, remaining, posAck, ack };
  }

  return { messages, remaining, ack };
}

module.exports = { decode };

// ── COMMANDES DISTANTES TELTONIKA ────────────────────────────────────
// Protocole CODEC12 / CODEC13 pour les commandes texte

function buildTeltonikaCommand(commandStr) {
  // CODEC12 : commande texte ASCII vers traceur
  const cmd     = Buffer.from(commandStr, 'ascii');
  const cmdLen  = cmd.length;
  const preamble = Buffer.from([0x00, 0x00, 0x00, 0x00]); // 4 zéros
  const dataSize = Buffer.allocUnsafe(4); dataSize.writeUInt32BE(cmdLen + 10);
  const codecId  = Buffer.from([0x0C]); // CODEC12
  const qty1     = Buffer.from([0x01]);
  const cmdType  = Buffer.from([0x05]); // type commande
  const cmdLenBuf= Buffer.allocUnsafe(4); cmdLenBuf.writeUInt32BE(cmdLen);
  const qty2     = Buffer.from([0x01]);

  const data = Buffer.concat([codecId, qty1, cmdType, cmdLenBuf, cmd, qty2]);

  // CRC-16 IBM sur les données
  let crc = 0;
  for (const b of data) { crc ^= b; for (let i=0;i<8;i++) crc = (crc&1) ? (crc>>>1)^0xA001 : crc>>>1; }
  const crcBuf = Buffer.allocUnsafe(4); crcBuf.writeUInt32BE(crc & 0xFFFF);

  return Buffer.concat([preamble, dataSize, data, crcBuf]);
}

const TELTONIKA_COMMANDS = {
  engine_cut:     () => buildTeltonikaCommand('setdigout 1 1'),
  engine_restore: () => buildTeltonikaCommand('setdigout 0 0'),
  get_location:   () => buildTeltonikaCommand('getgps'),
  reboot:         () => buildTeltonikaCommand('reboot'),
  get_status:     () => buildTeltonikaCommand('getstatus'),
  set_interval:   (n=30) => buildTeltonikaCommand(`setparam 2001:${n}`),
};

module.exports.buildTeltonikaCommand = buildTeltonikaCommand;
module.exports.TELTONIKA_COMMANDS    = TELTONIKA_COMMANDS;
