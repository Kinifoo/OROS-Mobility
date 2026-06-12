/**
 * Décodeur TK103 / Coban (format texte)
 * Compatibles: TK103A, TK103B, TK104, TK110
 *
 * Login:    ##,imei:IMEI,A;\r\n  → réponse: LOAD
 * Position: imei:IMEI,TRAC,date,valid,lat,N,lon,E,speed,course,date,acc,0,0,...\r\n
 * Heartbeat:##,imei:IMEI,A;  ou  imei:IMEI,PARAM,...
 */

function parseNMEACoord(raw, dir) {
  if (!raw || raw.length < 4) return 0;
  const dot = raw.indexOf('.');
  if (dot < 0) return 0;
  const deg = parseFloat(raw.substring(0, dot - 2));
  const min = parseFloat(raw.substring(dot - 2));
  const dec = deg + min / 60;
  return (dir === 'S' || dir === 'W') ? -dec : dec;
}

function parseDateTime(dateStr, timeStr) {
  try {
    // dateStr: DDMMYY, timeStr: HHMMSS.SSS
    const dd = parseInt(dateStr.substring(0, 2));
    const mm = parseInt(dateStr.substring(2, 4)) - 1;
    const yy = 2000 + parseInt(dateStr.substring(4, 6));
    const hh = parseInt(timeStr.substring(0, 2));
    const mi = parseInt(timeStr.substring(2, 4));
    const ss = parseFloat(timeStr.substring(4));
    return new Date(Date.UTC(yy, mm, dd, hh, mi, Math.floor(ss)));
  } catch (_) {
    return new Date();
  }
}

function decodeLine(line) {
  line = line.trim();
  if (!line) return null;

  // LOGIN: ##,imei:IMEI,A;
  if (line.startsWith('##,imei:')) {
    const match = line.match(/##,imei:(\d+),A/);
    if (match) return { type: 'login', imei: match[1] };
  }

  // POSITION: imei:IMEI,TRACKING,time,valid,lat,N/S,lon,E/W,speed,...
  if (line.startsWith('imei:')) {
    const parts = line.split(',');
    if (parts.length < 8) return null;

    const imeiPart = parts[0]; // imei:XXXXXXX
    const imei = imeiPart.replace('imei:', '').trim();
    const msgType = parts[1]; // TRAC, ALARM, etc.

    if (msgType === 'PARAM') return { type: 'heartbeat', imei };

    const timeStr  = parts[2] || '';
    const valid    = parts[3]; // A=valide
    const lat      = parseNMEACoord(parts[4], parts[5]);
    const lon      = parseNMEACoord(parts[6], parts[7]);
    const speed    = parseFloat(parts[8] || 0) * 1.852;
    const heading  = parseFloat(parts[9] || 0);
    const dateStr  = parts[10] || '';
    const acc      = parts[11] || '0'; // Ignition parfois ici

    const timestamp = parseDateTime(dateStr, timeStr);
    const ignition  = acc === '1' || acc.toLowerCase() === 'acc on';

    const base = { imei, timestamp, lat, lon, speed: Math.round(speed), heading, ignition };

    if (valid !== 'A') return { type: 'heartbeat', imei };

    if (msgType === 'ALARM' || msgType === 'help me') {
      return { type: 'alarm', alarm: 'sos', ...base };
    }

    return { type: 'position', ...base };
  }

  return null;
}

function decode(buffer) {
  const messages = [];
  const text     = buffer.toString('ascii');
  const lines    = text.split(/[\r\n]+/);
  const lastLine = lines[lines.length - 1];

  const remaining = lastLine && !lastLine.includes(';') && !lastLine.includes('\n')
    ? Buffer.from(lastLine, 'ascii')
    : Buffer.alloc(0);

  const processedLines = lastLine && !lastLine.includes(';') ? lines.slice(0, -1) : lines;

  for (const line of processedLines) {
    const msg = decodeLine(line);
    if (msg) messages.push(msg);
  }

  // ACK TK103
  const ack           = Buffer.from('LOAD\r\n');
  const heartbeatAck  = Buffer.from('ON\r\n');

  return { messages, remaining, ack, heartbeatAck };
}

module.exports = { decode };
