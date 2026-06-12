/**
 * OROS GPS — API REST + WebSocket + Serveur de fichiers statiques
 */
const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const jwt       = require('jsonwebtoken');
const bcrypt    = require('bcryptjs');
const db        = require('./database');
const logger    = require('./utils/logger');
const { setWebSocketBroadcaster } = require('./websocket');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server, path: '/ws' });

const JWT_SECRET  = process.env.JWT_SECRET || 'oros_secret';
const WEB_DIR     = path.join(__dirname, '../web');

// ── MIDDLEWARES ────────────────────────────────
app.use(express.json());
app.use(express.static(WEB_DIR));

// Middleware auth JWT
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Non autorisé' });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch(e) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

function adminOnly(req, res, next) {
  if (!['admin','superadmin'].includes(req.user.role))
    return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  next();
}

// ── WEBSOCKET ──────────────────────────────────
const wsClients = new Set();

wss.on('connection', (ws, req) => {
  wsClients.add(ws);
  logger.info(`WebSocket: client connecté (total: ${wsClients.size})`);
  ws.on('close', () => { wsClients.delete(ws); });
  ws.on('error', () => { wsClients.delete(ws); });
  // Ping keepalive
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

// Heartbeat WebSocket toutes les 30s
setInterval(() => {
  wsClients.forEach(ws => {
    if (!ws.isAlive) { ws.terminate(); wsClients.delete(ws); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

function broadcast(data) {
  const json = JSON.stringify(data);
  wsClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(json);
  });
}
setWebSocketBroadcaster(broadcast);

// ── AUTH ───────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  try {
    const r = await db.pool.query('SELECT * FROM users WHERE email=$1 AND active=true', [email.toLowerCase()]);
    const user = r.rows[0];
    if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Identifiants incorrects' });
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '24h' });
    await db.pool.query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const r = await db.pool.query('SELECT id,email,name,role,created_at FROM users WHERE id=$1', [req.user.id]);
    res.json(r.rows[0] || {});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── STATS ──────────────────────────────────────
app.get('/api/stats', authMiddleware, async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='online')  AS online,
        COUNT(*) FILTER (WHERE status='offline') AS offline,
        COUNT(*) FILTER (WHERE status='idle')    AS idle,
        COUNT(*) FILTER (WHERE status='alarm')   AS alarm,
        COUNT(*)                                  AS total
      FROM devices WHERE active=true
    `);
    const alerts = await db.pool.query('SELECT COUNT(*) FROM events WHERE acknowledged=false');
    res.json({ ...r.rows[0], alerts: parseInt(alerts.rows[0].count) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SERVER STATUS ──────────────────────────────
app.get('/api/server/status', authMiddleware, async (req, res) => {
  res.json({
    status: 'running',
    uptime: process.uptime(),
    ports: {
      GT06: parseInt(process.env.PORT_GT06 || 8090),
      Teltonika: parseInt(process.env.PORT_TELTONIKA || 5027),
      H02: parseInt(process.env.PORT_H02 || 5013),
      Seeworld: parseInt(process.env.PORT_SEEWORLD || 8000),
      TK103: parseInt(process.env.PORT_TK103 || 5002),
    },
    wsClients: wsClients.size
  });
});

// ── DEVICES ────────────────────────────────────
app.get('/api/devices', authMiddleware, async (req, res) => {
  try { res.json(await db.getDevices()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/devices/:id', authMiddleware, async (req, res) => {
  try {
    const r = await db.pool.query('SELECT * FROM devices WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Traceur introuvable' });
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/devices', authMiddleware, async (req, res) => {
  const { name, imei, protocol, model, phone, max_speed, port } = req.body;
  if (!name || !imei) return res.status(400).json({ error: 'Nom et IMEI requis' });
  if (!/^\d{15}$/.test(imei)) return res.status(400).json({ error: 'IMEI invalide (15 chiffres)' });
  try {
    const exists = await db.pool.query('SELECT id FROM devices WHERE imei=$1', [imei]);
    if (exists.rows.length) return res.status(409).json({ error: 'Cet IMEI est déjà enregistré' });
    const r = await db.pool.query(
      'INSERT INTO devices(name,imei,protocol,model,phone,max_speed,port,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [name, imei, protocol || 'GT06', model, phone, max_speed || 100, port || 8090, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/devices/:id', authMiddleware, async (req, res) => {
  const { name, model, phone, max_speed, protocol } = req.body;
  try {
    const r = await db.pool.query(
      'UPDATE devices SET name=$1,model=$2,phone=$3,max_speed=$4,protocol=$5,updated_at=NOW() WHERE id=$6 RETURNING *',
      [name, model, phone, max_speed, protocol, req.params.id]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/devices/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await db.pool.query('UPDATE devices SET active=false WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/devices/:id/command', authMiddleware, async (req, res) => {
  const { command, reason } = req.body;
  const allowed = ['engine_cut', 'engine_restore', 'get_location', 'set_interval', 'reboot', 'get_status'];
  if (!allowed.includes(command)) return res.status(400).json({ error: 'Commande invalide' });
  try {
    const r = await db.pool.query('SELECT id,imei,protocol,model,name,status FROM devices WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Traceur introuvable' });
    const device = r.rows[0];

    // Log dans la DB
    const logR = await db.pool.query(
      'INSERT INTO device_commands(device_id,command,reason,sent_by) VALUES($1,$2,$3,$4) RETURNING id',
      [device.id, command, reason||null, req.user.id]
    );
    const cmdId = logR.rows[0]?.id;

    // Mise à jour statut immédiate dans la DB
    if (command === 'engine_cut') {
      await db.pool.query("UPDATE devices SET status='immobilized' WHERE id=$1", [device.id]);
    } else if (command === 'engine_restore') {
      await db.pool.query("UPDATE devices SET status='online' WHERE id=$1", [device.id]);
    }

    // Envoi TCP direct (si traceur connecté)
    const { sendCommandToDevice } = require('./tcp-manager');
    const tcpResult = sendCommandToDevice(device.imei, command, { model: device.model });

    // Broadcast WebSocket pour mise à jour dashboard instantanée
    broadcast({ type: 'command_sent', imei: device.imei, command, cmdId, sentBy: req.user.name });

    // Événement dans le journal
    await db.pool.query(
      "INSERT INTO events(device_id,imei,event_type,severity,data) VALUES($1,$2,$3,'warning',$4)",
      [device.id, device.imei,
       command === 'engine_cut' ? 'engine_immobilized' : command === 'engine_restore' ? 'engine_restored' : command,
       JSON.stringify({ by: req.user.name, reason: reason||'Manuel', cmdId })]
    ).catch(()=>{});

    res.json({
      success: true,
      message: tcpResult.success
        ? `Commande ${command} envoyée au traceur ${device.name}`
        : `Commande ${command} enregistrée — traceur non connecté en ce moment`,
      tcpConnected: tcpResult.success,
      cmdId,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Historique des commandes d'un traceur
app.get('/api/devices/:id/commands', authMiddleware, async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT dc.*, u.name AS sent_by_name
      FROM device_commands dc
      LEFT JOIN users u ON u.id=dc.sent_by
      WHERE dc.device_id=$1
      ORDER BY dc.created_at DESC LIMIT 50
    `, [req.params.id]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POSITIONS ──────────────────────────────────
app.get('/api/positions', authMiddleware, async (req, res) => {
  const { imei, from, to, limit } = req.query;
  if (!imei) return res.status(400).json({ error: 'IMEI requis' });
  try {
    const positions = await db.getPositions(imei, from || new Date(Date.now()-86400000), to || new Date(), parseInt(limit)||1000);
    res.json({ positions, count: positions.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/positions/last', authMiddleware, async (req, res) => {
  const { imei } = req.query;
  try {
    const r = await db.pool.query('SELECT * FROM positions WHERE imei=$1 ORDER BY time DESC LIMIT 1', [imei]);
    res.json(r.rows[0] || null);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── EVENTS / ALERTES ───────────────────────────
app.get('/api/events', authMiddleware, async (req, res) => {
  try {
    const ack = req.query.acknowledged === '1';
    res.json(await db.getEvents(50, ack));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/events/:id/ack', authMiddleware, async (req, res) => {
  try {
    await db.pool.query('UPDATE events SET acknowledged=true,acknowledged_by=$1,acknowledged_at=NOW() WHERE id=$2', [req.user.id, req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/events/ack-all', authMiddleware, async (req, res) => {
  try {
    await db.pool.query('UPDATE events SET acknowledged=true,acknowledged_by=$1,acknowledged_at=NOW() WHERE acknowledged=false', [req.user.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── VÉHICULES ──────────────────────────────────
app.get('/api/vehicles', authMiddleware, async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT v.*, d.imei AS device_imei, dr.name AS driver_name
      FROM vehicles v
      LEFT JOIN devices d ON d.id = v.device_id AND d.active=true
      LEFT JOIN assignments a ON a.vehicle_id = v.id AND a.ended_at IS NULL
      LEFT JOIN drivers dr ON dr.id = a.driver_id
      WHERE v.active=true ORDER BY v.plate
    `);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vehicles', authMiddleware, async (req, res) => {
  const { brand, model, plate, type, color, year, device_imei, daily_target } = req.body;
  if (!brand || !model || !plate) return res.status(400).json({ error: 'Marque, modèle et plaque requis' });
  try {
    let deviceId = null;
    if (device_imei) {
      const dv = await db.pool.query('SELECT id FROM devices WHERE imei=$1', [device_imei]);
      deviceId = dv.rows[0]?.id || null;
    }
    const r = await db.pool.query(
      'INSERT INTO vehicles(brand,model,plate,type,color,year,device_id,daily_target) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [brand, model, plate.toUpperCase(), type||'car', color, year, deviceId, daily_target]
    );
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/vehicles/:id', authMiddleware, async (req, res) => {
  const { brand, model, plate, type, color, year, status, daily_target } = req.body;
  try {
    const r = await db.pool.query(
      'UPDATE vehicles SET brand=$1,model=$2,plate=$3,type=$4,color=$5,year=$6,status=$7,daily_target=$8,updated_at=NOW() WHERE id=$9 RETURNING *',
      [brand, model, plate, type, color, year, status, daily_target, req.params.id]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/vehicles/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await db.pool.query('UPDATE vehicles SET active=false WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CONDUCTEURS ────────────────────────────────
app.get('/api/drivers', authMiddleware, async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT dr.*, v.plate AS vehicle_plate
      FROM drivers dr
      LEFT JOIN assignments a ON a.driver_id=dr.id AND a.ended_at IS NULL
      LEFT JOIN vehicles v ON v.id=a.vehicle_id
      WHERE dr.active=true ORDER BY dr.name
    `);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/drivers', authMiddleware, async (req, res) => {
  const { name, phone, license, email, status } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'Nom et téléphone requis' });
  try {
    const r = await db.pool.query(
      'INSERT INTO drivers(name,phone,license,email,status) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [name, phone, license, email, status||'active']
    );
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/drivers/:id', authMiddleware, async (req, res) => {
  const { name, phone, license, email, status } = req.body;
  try {
    const r = await db.pool.query(
      'UPDATE drivers SET name=$1,phone=$2,license=$3,email=$4,status=$5,updated_at=NOW() WHERE id=$6 RETURNING *',
      [name, phone, license, email, status, req.params.id]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/drivers/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await db.pool.query('UPDATE drivers SET active=false WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── TRAJETS ────────────────────────────────────
app.get('/api/trips', authMiddleware, async (req, res) => {
  const { imei, from, to, limit } = req.query;
  try {
    let q = `
      SELECT t.*, d.name AS device_name, d.imei, v.plate, dr.name AS driver_name
      FROM trips t
      LEFT JOIN devices d ON d.id = t.device_id
      LEFT JOIN vehicles v ON v.device_id = d.id AND v.active=true
      LEFT JOIN assignments a ON a.vehicle_id = v.id AND a.ended_at IS NULL
      LEFT JOIN drivers dr ON dr.id = a.driver_id
      WHERE 1=1
    `;
    const params = [];
    if (imei) { params.push(imei); q += ` AND d.imei=$${params.length}`; }
    if (from) { params.push(from); q += ` AND t.start_time >= $${params.length}`; }
    if (to)   { params.push(to);   q += ` AND t.end_time   <= $${params.length}`; }
    q += ` ORDER BY t.start_time DESC LIMIT ${parseInt(limit)||100}`;
    const r = await db.pool.query(q, params);
    res.json({ trips: r.rows, count: r.rows.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── MAINTENANCE ────────────────────────────────
app.get('/api/maintenance', authMiddleware, async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT m.*, v.plate AS vehicle_plate FROM maintenance m
      LEFT JOIN vehicles v ON v.id=m.vehicle_id
      WHERE m.active=true ORDER BY m.due_date ASC NULLS LAST
    `);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/maintenance', authMiddleware, async (req, res) => {
  const { type, vehicle_id, due_date, due_km, cost, garage, description } = req.body;
  try {
    const r = await db.pool.query(
      'INSERT INTO maintenance(type,vehicle_id,due_date,due_km,cost,garage,description,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [type||'oil', vehicle_id, due_date, due_km, cost, garage, description, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/maintenance/:id', authMiddleware, async (req, res) => {
  const { type, due_date, due_km, cost, garage, description, status } = req.body;
  try {
    const r = await db.pool.query(
      'UPDATE maintenance SET type=$1,due_date=$2,due_km=$3,cost=$4,garage=$5,description=$6,status=$7,updated_at=NOW() WHERE id=$8 RETURNING *',
      [type, due_date, due_km, cost, garage, description, status, req.params.id]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/maintenance/:id', authMiddleware, async (req, res) => {
  try {
    await db.pool.query('UPDATE maintenance SET active=false WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── REVENUS ────────────────────────────────────
app.get('/api/revenues', authMiddleware, async (req, res) => {
  const { vehicle_id, from, to } = req.query;
  try {
    let q = `
      SELECT r.*, v.plate AS vehicle_plate, dr.name AS driver_name
      FROM revenues r
      LEFT JOIN vehicles v ON v.id=r.vehicle_id
      LEFT JOIN drivers dr ON dr.id=r.driver_id
      WHERE r.active=true
    `;
    const params = [];
    if (vehicle_id) { params.push(vehicle_id); q += ` AND r.vehicle_id=$${params.length}`; }
    if (from) { params.push(from); q += ` AND r.date >= $${params.length}`; }
    if (to)   { params.push(to);   q += ` AND r.date <= $${params.length}`; }
    q += ' ORDER BY r.date DESC, r.created_at DESC';
    const r = await db.pool.query(q, params);
    res.json({ revenues: r.rows, count: r.rows.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/revenues', authMiddleware, async (req, res) => {
  const { amount, date, vehicle_id, driver_id, payment_method, reference, notes } = req.body;
  if (!amount) return res.status(400).json({ error: 'Montant requis' });
  try {
    const r = await db.pool.query(
      'INSERT INTO revenues(amount,date,vehicle_id,driver_id,payment_method,reference,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [amount, date||new Date().toISOString().split('T')[0], vehicle_id, driver_id, payment_method||'cash', reference, notes, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/revenues/:id', authMiddleware, async (req, res) => {
  try {
    await db.pool.query('UPDATE revenues SET active=false WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GÉOFENCES ──────────────────────────────────
app.get('/api/geofences', authMiddleware, async (req, res) => {
  try {
    const r = await db.pool.query('SELECT * FROM geofences WHERE active=true ORDER BY name');
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/geofences', authMiddleware, async (req, res) => {
  const { name, type, lat, lon, radius, coordinates, alert_enter, alert_exit } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  try {
    const r = await db.pool.query(
      'INSERT INTO geofences(name,type,lat,lon,radius,coordinates,alert_enter,alert_exit,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [name, type||'circle', lat, lon, radius||500, JSON.stringify(coordinates||[]), alert_enter!==false, alert_exit!==false, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/geofences/:id', authMiddleware, async (req, res) => {
  try {
    await db.pool.query('UPDATE geofences SET active=false WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── UTILISATEURS ───────────────────────────────
app.get('/api/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const r = await db.pool.query('SELECT id,name,email,role,active,created_at,last_login FROM users WHERE active=true ORDER BY name');
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', authMiddleware, adminOnly, async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  try {
    const exists = await db.pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email déjà utilisé' });
    const hash = await bcrypt.hash(password, 12);
    const r = await db.pool.query(
      'INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role',
      [name, email.toLowerCase(), hash, role||'viewer']
    );
    res.status(201).json(r.rows[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:id', authMiddleware, async (req, res) => {
  const { name, password } = req.body;
  try {
    const updates = ['name=$1', 'updated_at=NOW()'];
    const params = [name];
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      updates.push(`password_hash=$${params.length + 1}`);
      params.push(hash);
    }
    params.push(req.params.id);
    await db.pool.query(`UPDATE users SET ${updates.join(',')} WHERE id=$${params.length}`, params);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/:id', authMiddleware, adminOnly, async (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Impossible de vous supprimer vous-même' });
  try {
    await db.pool.query('UPDATE users SET active=false WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── FALLBACK SPA ───────────────────────────────
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(WEB_DIR, 'index.html'));
  } else {
    res.status(404).json({ error: 'Route API introuvable' });
  }
});

// ── DÉMARRAGE ──────────────────────────────────
function startAPIServer(port = 3000) {
  server.listen(port, '0.0.0.0', () => {
    logger.info(`API REST     → http://0.0.0.0:${port}/api`);
    logger.info(`Dashboard    → http://0.0.0.0:${port}`);
    logger.info(`WebSocket    → ws://0.0.0.0:${port}/ws`);
  });
}

module.exports = { startAPIServer };

// ── SCORE CONDUCTEUR ───────────────────────────────────────────────
const { getDriverScore, getAllDriversRanking } = require('./driver-score');

app.get('/api/driver-scores', authMiddleware, async (req, res) => {
  try {
    const { from, to } = req.query;
    const ranking = await getAllDriversRanking(from, to);
    res.json({ ranking, count: ranking.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/driver-scores/:id', authMiddleware, async (req, res) => {
  try {
    const { from, to } = req.query;
    const score = await getDriverScore(parseInt(req.params.id), from, to);
    if (!score) return res.status(404).json({ error: 'Pas de données de conduite disponibles' });
    res.json(score);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── IMMOBILISATION AUTO ────────────────────────────────────────────
const { grantExtension, validateRevenue } = require('./scheduler');

app.get('/api/auto-immobilization', authMiddleware, async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT ai.*, v.plate, v.brand, v.model,
             d.name AS driver_name, d.phone AS driver_phone,
             u.name AS granted_by_name
      FROM auto_immobilization ai
      JOIN vehicles v ON v.id=ai.vehicle_id
      LEFT JOIN assignments a ON a.vehicle_id=v.id AND a.ended_at IS NULL
      LEFT JOIN drivers d ON d.id=a.driver_id
      LEFT JOIN users u ON u.id=ai.extended_by
      ORDER BY ai.date DESC, ai.created_at DESC
      LIMIT 100
    `);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auto-immobilization/:id/validate', authMiddleware, async (req, res) => {
  try {
    const r = await db.pool.query('SELECT * FROM auto_immobilization WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Introuvable' });
    const result = await validateRevenue(r.rows[0].vehicle_id, r.rows[0].date, req.user.id);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auto-immobilization/:id/extend', authMiddleware, async (req, res) => {
  const { until } = req.body;
  if (!until) return res.status(400).json({ error: 'Heure de prorogation requise' });
  try {
    const r = await db.pool.query('SELECT * FROM auto_immobilization WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Introuvable' });
    const result = await grantExtension(r.rows[0].vehicle_id, r.rows[0].date, until, req.user.id);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── STATS AMÉLIORÉES ───────────────────────────────────────────────
app.get('/api/stats/dashboard', authMiddleware, async (req, res) => {
  try {
    const [devR, tripR, revR, alertR] = await Promise.all([
      db.pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER(WHERE status='online') AS online, COUNT(*) FILTER(WHERE status='offline') AS offline, COUNT(*) FILTER(WHERE status='idle') AS idle, COUNT(*) FILTER(WHERE status='alarm') AS alarm, COUNT(*) FILTER(WHERE status='immobilized') AS immobilized FROM devices WHERE active=true`),
      db.pool.query(`SELECT COALESCE(SUM(distance),0) AS total_km, COUNT(*) AS trip_count FROM trips WHERE start_time > NOW() - INTERVAL '24 hours' AND end_time IS NOT NULL`),
      db.pool.query(`SELECT COALESCE(SUM(amount),0) AS total FROM revenues WHERE date=CURRENT_DATE`),
      db.pool.query(`SELECT COUNT(*) AS count FROM events WHERE acknowledged=false`),
    ]);
    const dev = devR.rows[0];
    res.json({
      online:      parseInt(dev.online),
      offline:     parseInt(dev.offline),
      idle:        parseInt(dev.idle),
      alarm:       parseInt(dev.alarm),
      immobilized: parseInt(dev.immobilized),
      total:       parseInt(dev.total),
      todayKm:     Math.round(parseFloat(tripR.rows[0].total_km) * 10) / 10,
      todayTrips:  parseInt(tripR.rows[0].trip_count),
      todayRevenue:parseFloat(revR.rows[0].total),
      alerts:      parseInt(alertR.rows[0].count),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Modifier startAPIServer pour retourner le broadcaster
const _origStart = module.exports?.startAPIServer;
// Re-export avec broadcaster
module.exports = { startAPIServer: (port = 3000) => {
  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      logger.info(`API REST     → http://0.0.0.0:${port}/api`);
      logger.info(`Dashboard    → http://0.0.0.0:${port}`);
      logger.info(`WebSocket    → ws://0.0.0.0:${port}/ws`);
      resolve({ broadcaster: broadcast });
    });
  });
}};

// ── OPTIMISATION ITINÉRAIRES ────────────────────────────────────────
const router = require('./route-optimizer');

app.post('/api/route', authMiddleware, async (req, res) => {
  const { fromLat, fromLon, toLat, toLon, alternatives } = req.body;
  if (!fromLat||!fromLon||!toLat||!toLon)
    return res.status(400).json({ error: 'Coordonnées requises' });
  try {
    const routes = await router.getRoute(fromLat, fromLon, toLat, toLon, { alternatives });
    res.json({ routes, count: routes.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/route/optimize', authMiddleware, async (req, res) => {
  const { depot, stops } = req.body;
  if (!depot || !stops?.length)
    return res.status(400).json({ error: 'Dépôt et arrêts requis' });
  try {
    const result = await router.optimizeTour(depot, stops);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/route/snap', authMiddleware, async (req, res) => {
  const { lat, lon } = req.query;
  try {
    const snapped = await router.snapToRoad(parseFloat(lat), parseFloat(lon));
    res.json(snapped);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── EXPORTS PDF / CSV ────────────────────────────────────────────────
const exporter = require('./export');

app.get('/api/export/trips/pdf', authMiddleware, async (req, res) => {
  try {
    const html = await exporter.generateTripsReport(req.query);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="oros-trajets-${Date.now()}.html"`);
    res.send(html);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/export/trips/csv', authMiddleware, async (req, res) => {
  try {
    const csv = await exporter.exportTripsCSV(req.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="oros-trajets-${Date.now()}.csv"`);
    res.send(csv);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/export/revenues/pdf', authMiddleware, async (req, res) => {
  try {
    const html = await exporter.generateRevenueReport(req.query);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="oros-revenus-${Date.now()}.html"`);
    res.send(html);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/export/revenues/csv', authMiddleware, async (req, res) => {
  try {
    const csv = await exporter.exportRevenuesCSV(req.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="oros-revenus-${Date.now()}.csv"`);
    res.send(csv);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/export/scores/pdf', authMiddleware, async (req, res) => {
  try {
    const html = await exporter.generateDriverScoreReport(req.query);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="oros-scores-${Date.now()}.html"`);
    res.send(html);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Journal global des commandes récentes
app.get('/api/commands/recent', authMiddleware, async (req, res) => {
  try {
    const r = await db.pool.query(`
      SELECT dc.*, d.name AS device_name, d.imei, v.plate, u.name AS sent_by_name
      FROM device_commands dc
      LEFT JOIN devices d ON d.id=dc.device_id
      LEFT JOIN vehicles v ON v.device_id=d.id AND v.active=true
      LEFT JOIN users u ON u.id=dc.sent_by
      ORDER BY dc.created_at DESC LIMIT 30
    `);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  NOUVELLES FONCTIONNALITÉS INNOVANTES
// ════════════════════════════════════════════════════════════

// ── PARTAGE DE POSITION PUBLIC ─────────────────────────────
const liveShare = require('./live-share');

app.post('/api/devices/:id/share', authMiddleware, async (req, res) => {
  const { expiresInMinutes=120, label='', showDriver=false, showSpeed=true } = req.body;
  try {
    const result = await liveShare.createShareLink(parseInt(req.params.id), { expiresInMinutes, label, showDriver, showSpeed, createdBy: req.user.id });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/devices/:id/shares', authMiddleware, async (req, res) => {
  try { res.json(await liveShare.getActiveShareLinks(parseInt(req.params.id))); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/share/:token', authMiddleware, async (req, res) => {
  try { await liveShare.revokeShareLink(req.params.token); res.json({ success:true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// Page publique de suivi (sans auth)
app.get('/share/:token', async (req, res) => {
  try {
    const data = await liveShare.getShareData(req.params.token);
    if (!data) return res.status(404).send('<h2>Lien expiré ou invalide</h2>');
    // Servir une mini-page HTML de suivi
    res.send(buildSharePage(data, req.params.token));
  } catch(e) { res.status(500).send('Erreur'); }
});

function buildSharePage(data, token) {
  const emoji = {car:'🚗',taxi:'🚕',moto:'🏍️',truck:'🚛',van:'🚐'}[data.vtype]||'🚗';
  return `<!DOCTYPE html><html lang="fr"><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Suivi ${data.label}</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif}
    #map{height:calc(100vh - 80px)}
    .bar{height:80px;background:#0F1923;color:#fff;display:flex;align-items:center;padding:0 16px;gap:12px}
    .emoji{font-size:28px}.title{font-size:15px;font-weight:700}
    .sub{font-size:12px;color:#8899AA}.speed{font-size:22px;font-weight:800;color:#22D3EE;margin-left:auto}
    .status{font-size:11px;color:#4ADE80}
    </style></head><body>
    <div class="bar">
      <span class="emoji">${emoji}</span>
      <div><div class="title">${data.label}</div>
        ${data.driver?`<div class="sub">Conducteur: ${data.driver}</div>`:''}
        <div class="status" id="status">● En direct</div>
      </div>
      ${data.speed!==null?`<div class="speed"><span id="speed">${data.speed||0}</span><br><span style="font-size:11px;color:#8899AA">km/h</span></div>`:''}
    </div>
    <div id="map"></div>
    <script>
    const map = L.map('map').setView([${data.lat||5.354},${data.lon||-4.007}], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OSM'}).addTo(map);
    const marker = L.marker([${data.lat||5.354},${data.lon||-4.007}]).addTo(map).bindPopup('${data.label}').openPopup();
    // Rafraîchir toutes les 10 secondes
    setInterval(async()=>{
      const r = await fetch('/api/share-data/${token}').then(r=>r.json()).catch(()=>null);
      if(!r) return;
      marker.setLatLng([r.lat,r.lon]);
      map.panTo([r.lat,r.lon]);
      if(r.speed!==null) document.getElementById('speed').textContent=r.speed||0;
      document.getElementById('status').textContent='● Mis à jour '+new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    }, 10000);
    </script></body></html>`;
}

app.get('/api/share-data/:token', async (req, res) => {
  try {
    const data = await liveShare.getShareData(req.params.token);
    if (!data) return res.status(404).json({ error:'Expiré' });
    res.json({ lat:data.lat, lon:data.lon, speed:data.speed, status:data.status });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── SOS INCIDENTS ──────────────────────────────────────────
const sosWorkflow = require('./sos-workflow');
sosWorkflow.setBroadcaster(broadcast);

app.get('/api/sos/incidents', authMiddleware, async (req, res) => {
  try { res.json(await sosWorkflow.getActiveIncidents()); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/sos/:id/acknowledge', authMiddleware, async (req, res) => {
  try { await sosWorkflow.acknowledgeIncident(parseInt(req.params.id), req.user.id); res.json({success:true}); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/sos/:id/resolve', authMiddleware, async (req, res) => {
  try {
    await sosWorkflow.resolveIncident(parseInt(req.params.id), req.user.id, req.body.notes);
    res.json({success:true});
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── CARBURANT ──────────────────────────────────────────────
const fuelMgr = require('./fuel-manager');

app.get('/api/fuel/report', authMiddleware, async (req, res) => {
  const { vehicle_id, from, to } = req.query;
  try { res.json(await fuelMgr.getFuelReport(parseInt(vehicle_id), from, to)); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/fuel/entries', authMiddleware, async (req, res) => {
  try {
    const entry = await fuelMgr.addFuelEntry({ ...req.body, userId: req.user.id });
    res.status(201).json(entry);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('/api/fuel/entries', authMiddleware, async (req, res) => {
  const { vehicle_id } = req.query;
  try {
    const r = await db.pool.query(`
      SELECT fe.*, v.plate, v.brand, v.model FROM fuel_entries fe
      LEFT JOIN vehicles v ON v.id=fe.vehicle_id
      WHERE ($1::int IS NULL OR fe.vehicle_id=$1) ORDER BY fe.date DESC LIMIT 200
    `, [vehicle_id||null]);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── DOCUMENTS ──────────────────────────────────────────────
const documents = require('./documents');

app.get('/api/documents', authMiddleware, async (req, res) => {
  try { res.json(await documents.getDocuments(req.query)); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/documents', authMiddleware, async (req, res) => {
  try {
    const doc = await documents.createDocument({ ...req.body, uploadedBy: req.user.id });
    res.status(201).json(doc);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.delete('/api/documents/:id', authMiddleware, async (req, res) => {
  try {
    await db.pool.query('UPDATE vehicle_documents SET active=false WHERE id=$1', [req.params.id]);
    res.json({success:true});
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── MAINTENANCE PRÉDICTIVE ─────────────────────────────────
const predMaint = require('./predictive-maintenance');

app.get('/api/predictive-maintenance', authMiddleware, async (req, res) => {
  try {
    const vehicles = await db.pool.query('SELECT id FROM vehicles WHERE active=true AND device_id IS NOT NULL');
    const results  = await Promise.all(vehicles.rows.map(v => predMaint.analyzePredictiveMaintenance(v.id)));
    res.json(results.filter(Boolean).sort((a,b) => a.healthScore - b.healthScore));
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('/api/predictive-maintenance/:vehicleId', authMiddleware, async (req, res) => {
  try { res.json(await predMaint.analyzePredictiveMaintenance(parseInt(req.params.vehicleId))); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

// ── GAMIFICATION ────────────────────────────────────────────
const gamification = require('./gamification');

app.get('/api/leaderboard', authMiddleware, async (req, res) => {
  try { res.json(await gamification.getLeaderboard(req.query.period||'week')); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('/api/drivers/:id/badges', authMiddleware, async (req, res) => {
  try { res.json(await gamification.getDriverBadges(parseInt(req.params.id))); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('/api/weekly-challenge', authMiddleware, async (req, res) => {
  try { res.json(await gamification.getWeeklyChallenge()); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

// ── HEATMAP ─────────────────────────────────────────────────
const heatmap = require('./heatmap');

app.get('/api/heatmap', authMiddleware, async (req, res) => {
  try { res.json(await heatmap.getHeatmapData(req.query)); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('/api/heatmap/zones', authMiddleware, async (req, res) => {
  try { res.json(await heatmap.getTopZones(parseInt(req.query.limit)||10, req.query.from, req.query.to)); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

// ════════════════════════════════════════════════════════════
//  SYSTÈME D'ALERTES IA v2.0
// ════════════════════════════════════════════════════════════
const aiAlerts = require('./ai-alert-engine');
aiAlerts.setBroadcaster(broadcast);

// Récupérer les alertes avec filtres avancés
app.get('/api/ai-alerts', authMiddleware, async (req, res) => {
  try {
    const { acknowledged='false', severity, imei, from, limit='100', min_score='0' } = req.query;
    res.json(await aiAlerts.getAlerts({
      acknowledged: acknowledged === 'true',
      severity, imei, from,
      limit:    parseInt(limit),
      minScore: parseInt(min_score),
    }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Statistiques globales
app.get('/api/ai-alerts/stats', authMiddleware, async (req, res) => {
  try { res.json(await aiAlerts.getAlertStats()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// Tendances sur N jours
app.get('/api/ai-alerts/trends', authMiddleware, async (req, res) => {
  try { res.json(await aiAlerts.getAlertTrends(parseInt(req.query.days)||7)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// Top véhicules à risque
app.get('/api/ai-alerts/risk-vehicles', authMiddleware, async (req, res) => {
  try { res.json(await aiAlerts.getHighRiskVehicles(parseInt(req.query.limit)||10)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// Types d'alertes disponibles
app.get('/api/ai-alerts/types', authMiddleware, async (req, res) => {
  res.json(Object.entries(aiAlerts.ALERT_TYPES).map(([key, def]) => ({
    key, ...def
  })));
});

// Acquitter une alerte
app.post('/api/ai-alerts/:id/acknowledge', authMiddleware, async (req, res) => {
  try {
    await aiAlerts.acknowledgeAlert(parseInt(req.params.id), req.user.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Acquitter toutes les alertes
app.post('/api/ai-alerts/acknowledge-all', authMiddleware, async (req, res) => {
  try {
    await aiAlerts.acknowledgeAll(req.user.id, req.body.severity);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Snooze (silence temporaire)
app.post('/api/ai-alerts/:id/snooze', authMiddleware, async (req, res) => {
  const { minutes = 30 } = req.body;
  try {
    await aiAlerts.snoozeAlert(parseInt(req.params.id), parseInt(minutes));
    res.json({ success: true, until: new Date(Date.now() + minutes * 60000) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Déclencher une alerte manuellement (test / debug)
app.post('/api/ai-alerts/trigger', authMiddleware, adminOnly, async (req, res) => {
  const { imei, alertType, data } = req.body;
  if (!imei || !alertType) return res.status(400).json({ error: 'imei et alertType requis' });
  try {
    const result = await aiAlerts.processAlert(alertType, imei, data || {});
    res.json({ success: true, alert: result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  ALERTES RADARS VOCALES
// ════════════════════════════════════════════════════════════
const radarMod = require('./radar-alerts');

app.get('/api/radars', authMiddleware, async (req, res) => {
  try { res.json(await radarMod.getRadars(req.query)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/radars', authMiddleware, async (req, res) => {
  try { res.status(201).json(await radarMod.addRadar(req.body, req.user.id)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/radars/:id', authMiddleware, adminOnly, async (req, res) => {
  try { res.json(await radarMod.updateRadar(parseInt(req.params.id), req.body)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/radars/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    await db.pool.query('UPDATE radars SET active=false WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/radars/import-osm', authMiddleware, adminOnly, async (req, res) => {
  try {
    const count = await radarMod.importFromOSM(req.body.bbox);
    res.json({ success: true, imported: count });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
//  PLANS & GESTION DES ACCÈS
// ════════════════════════════════════════════════════════════
const plans = require('./plans');
const { requireFeature } = plans;

// ── Profil d'accès de l'utilisateur connecté ──────────────
app.get('/api/my-access', authMiddleware, async (req, res) => {
  try {
    const profile = await plans.getUserAccessProfile(req.user.id);
    res.json(profile);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Plans disponibles + feature groups ───────────────────
app.get('/api/plans', async (req, res) => {
  res.json({
    plans: Object.values(plans.PLANS).map(p => ({
      ...p,
      features: [...p.features], // Convertir Set → Array
    })),
    featureGroups: plans.FEATURE_GROUPS,
  });
});

// ── Organisations (superadmin) ────────────────────────────
app.get('/api/organizations', authMiddleware, async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });
  try { res.json(await plans.getOrganizations()); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/organizations', authMiddleware, async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });
  try { res.status(201).json(await plans.createOrganization(req.body)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Changer le plan d'une organisation ───────────────────
app.put('/api/organizations/:id/plan', authMiddleware, async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });
  const { plan, expiresAt, overrides } = req.body;
  if (!plans.PLANS[plan]) return res.status(400).json({ error: 'Plan invalide' });
  try {
    await plans.updateOrgPlan(parseInt(req.params.id), plan, expiresAt, overrides);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Overrides individuels d'un utilisateur ───────────────
app.put('/api/users/:id/overrides', authMiddleware, async (req, res) => {
  if (!['admin','superadmin'].includes(req.user.role)) return res.status(403).json({ error: 'Accès refusé' });
  try {
    await plans.updateUserOverrides(parseInt(req.params.id), req.body.overrides || {});
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Ajouter requireFeature sur les routes PRO ─────────────
// (Ces routes existaient déjà — on ajoute le gating)
// NB: On ne peut pas modifier les routes existantes directement,
// on documente ici les features requises par route :
const ROUTE_FEATURES = {
  '/api/ai-alerts':            'ai_alerts',
  '/api/auto-immobilization':  'auto_immobilization',
  '/api/radars':               'radar_voice_alerts',
  '/api/heatmap':              'heatmap',
  '/api/route/optimize':       'route_optimization',
  '/api/predictive-maintenance':'predictive_ai',
  '/api/leaderboard':          'gamification',
  '/api/driver-scores':        'driver_score',
  '/api/fuel/entries':         'fuel_management',
  '/api/documents':            'documents_expiry',
  '/api/live-share':           'live_share',
};
