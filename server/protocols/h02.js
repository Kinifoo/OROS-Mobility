/**
 * Décodeur H02 (format texte)
 * Compatibles: Seeworld S20, S21, G100, G60
 *
 * Format: *HQ,IMEI,V1,HHMMSS,A,lat,N/S,lon,E/W,speed,0,angle,D,D,D,io#\n
 * Ou:     $HQ,IMEI,V1,HHMMSS,A,lat,N/S,lon,E/W,speed,angle,date,...*CS\r\n
 */

function parseNMEACoord(raw, dir) {
  // DDDMM.MMMM → degrés décimaux
  const dot = raw.indexOf('.');
  if (dot < 0) return 0;
  const deg = parseFloat(raw.substring(0, dot - 2));
  const min = parseFloat(raw.substring(dot - 2));
  const dec = deg + min / 60;
  return (dir === 'S' || dir === 'W') ? -dec : dec;
}

function parseTime(timeStr, dateStr) {
  try {
    const hh = parseInt(timeStr.substring(0, 2));
    const mm = parseInt(timeStr.substring(2, 4));
    const ss = parseInt(timeStr.substring(4, 6));
    if (dateStr && dateStr.length >= 6) {
      const dd  = parseInt(dateStr.substring(0, 2));
      const mo  = parseInt(dateStr.substring(2, 4)) - 1;
      const yy  = 2000 + parseInt(dateStr.substring(4, 6));
      return new Date(Date.UTC(yy, mo, dd, hh, mm, ss));
    }
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm, ss));
  } catch (_) {
    return new Date();
  }
}

function parseAlarm(alarmStr) {
  const alarmMap = {
    '00': null, '01': 'sos', '02': 'power_cut', '03': 'vibration',
    '04': 'enter_fence', '05': 'exit_fence', '06': 'overspeed',
    '09': 'low_battery', '10': 'engine_cut',
  };
  return alarmMap[alarmStr] || alarmStr;
}

function decodeLine(line) {
  // Nettoyer la ligne
  line = line.trim().replace(/\*[0-9A-Fa-f]{2}$/, ''); // Supprimer checksum final

  // Format *HQ (Seeworld principal)
  if (line.startsWith('*HQ,') || line.startsWith('$HQ,')) {
    const parts = line.substring(4).split(',');
    if (parts.length < 9) return null;

    const imei    = parts[0];
    const msgType = parts[1]; // V1=position, V3=alarme, V4=heartbeat
    const timeStr = parts[2];
    const valid   = parts[3]; // A=valide, V=invalide

    if (msgType === 'V4' || msgType === 'LINK') {
      return { type: 'heartbeat', imei };
    }

    if (valid !== 'A') {
      return { type: 'heartbeat', imei }; // Position invalide → heartbeat
    }

    const lat     = parseNMEACoord(parts[4], parts[5]);
    const lon     = parseNMEACoord(parts[6], parts[7]);
    const speed   = parseFloat(parts[8]) * 1.852; // Noeuds → km/h
    const heading = parseFloat(parts[9]) || 0;
    const dateStr = parts[10] || '';

    const base = {
      imei,
      timestamp: parseTime(timeStr, dateStr),
      lat, lon, speed: Math.round(speed), heading,
    };

    if (msgType === 'V3') {
      // Alarme
      const alarmCode = parts[13] || '00';
      const alarm = parseAlarm(alarmCode);
      if (alarm) return { type: 'alarm', alarm, ...base };
      return { type: 'position', ...base };
    }

    // IO: ignition, accumulateur, etc. (parties 11+)
    let ignition = false;
    if (parts.length > 11) {
      const io = parseInt(parts[11], 16);
      ignition = (io & 0x02) !== 0;
    }

    return { type: 'position', ignition, ...base };
  }

  // Format LOGIN simple: imei,login#\r\n
  if (line.endsWith('#') && !line.includes(',', 15)) {
    const imei = line.replace('#', '').trim();
    if (/^\d{15}$/.test(imei)) {
      return { type: 'login', imei };
    }
  }

  return null;
}

function decode(buffer) {
  const messages = [];
  const text     = buffer.toString('ascii');
  const lines    = text.split(/[\r\n]+/);
  const lastLine = lines[lines.length - 1];

  // Conserver la dernière ligne si incomplète
  const remaining = lastLine && !lastLine.endsWith('#') && !lastLine.includes('\n')
    ? Buffer.from(lastLine, 'ascii')
    : Buffer.alloc(0);

  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = decodeLine(line);
    if (msg) messages.push(msg);
  }

  // ACK pour Seeworld
  const heartbeatAck = Buffer.from('*HQ,0,V4#\r\n');

  return { messages, remaining, heartbeatAck };
}

module.exports = { decode };

// ── COMMANDES DISTANTES H02 / SEEWORLD ──────────────────────────────
// Format SMS-like via TCP: *HQ,IMEI,CMD,timestamp#

function buildH02Command(imei, command) {
  const ts  = new Date();
  const pad = n => String(n).padStart(2,'0');
  const timestamp = `${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;

  const cmds = {
    engine_cut:     `*HQ,${imei},DYD,${timestamp}#`,
    engine_restore: `*HQ,${imei},HFYD,${timestamp}#`,
    get_location:   `*HQ,${imei},V1,${timestamp}#`,
    reboot:         `*HQ,${imei},REBT,${timestamp}#`,
    set_interval:   (n=30) => `*HQ,${imei},SETT${String(n).padStart(3,'0')},${timestamp}#`,
  };
  const result = typeof cmds[command] === 'function' ? cmds[command]() : cmds[command];
  return result ? Buffer.from(result + '\r\n', 'ascii') : null;
}

module.exports.buildH02Command = buildH02Command;
