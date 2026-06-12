/**
 * OROS GPS — Client API REST
 * Toutes les communications avec le serveur backend
 */

const API = (() => {
  const BASE = '';  // même origine
  let token = localStorage.getItem('oros_token') || null;

  async function req(method, path, body = null) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body)  opts.body = JSON.stringify(body);

    const res = await fetch(BASE + '/api' + path, opts);

    if (res.status === 401) {
      token = null;
      localStorage.removeItem('oros_token');
      location.reload();
      return;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    return data;
  }

  return {
    setToken(t) { token = t; localStorage.setItem('oros_token', t); },
    clearToken() { token = null; localStorage.removeItem('oros_token'); },
    hasToken() { return !!token; },

    // AUTH
    login: (email, password) => req('POST', '/auth/login', { email, password }),
    me:    () => req('GET', '/auth/me'),

    // DEVICES
    getDevices:   ()           => req('GET',    '/devices'),
    getDevice:    (id)         => req('GET',    `/devices/${id}`),
    createDevice: (data)       => req('POST',   '/devices', data),
    updateDevice: (id, data)   => req('PUT',    `/devices/${id}`, data),
    deleteDevice: (id)         => req('DELETE', `/devices/${id}`),
    sendCommand:  (id, cmd)    => req('POST',   `/devices/${id}/command`, { command: cmd }),

    // POSITIONS
    getPositions: (imei, from, to, limit) => req('GET', `/positions?imei=${imei}&from=${from}&to=${to}&limit=${limit||1000}`),
    getLastPosition: (imei)               => req('GET', `/positions/last?imei=${imei}`),

    // EVENTS / ALERTES
    getEvents:   (ack)    => req('GET',  `/events?acknowledged=${ack ? 1 : 0}`),
    ackEvent:    (id)     => req('POST', `/events/${id}/ack`),
    ackAllEvents:()       => req('POST', '/events/ack-all'),

    // VÉHICULES
    getVehicles:   ()          => req('GET',    '/vehicles'),
    createVehicle: (data)      => req('POST',   '/vehicles', data),
    updateVehicle: (id, data)  => req('PUT',    `/vehicles/${id}`, data),
    deleteVehicle: (id)        => req('DELETE', `/vehicles/${id}`),

    // CONDUCTEURS
    getDrivers:   ()          => req('GET',    '/drivers'),
    createDriver: (data)      => req('POST',   '/drivers', data),
    updateDriver: (id, data)  => req('PUT',    `/drivers/${id}`, data),
    deleteDriver: (id)        => req('DELETE', `/drivers/${id}`),

    // TRAJETS
    getTrips: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return req('GET', `/trips?${q}`);
    },

    // MAINTENANCE
    getMaintenance:   ()          => req('GET',    '/maintenance'),
    createMaintenance:(data)      => req('POST',   '/maintenance', data),
    updateMaintenance:(id, data)  => req('PUT',    `/maintenance/${id}`, data),
    deleteMaintenance:(id)        => req('DELETE', `/maintenance/${id}`),

    // REVENUS
    getRevenues:   (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return req('GET', `/revenues?${q}`);
    },
    createRevenue: (data)     => req('POST',   '/revenues', data),
    deleteRevenue: (id)       => req('DELETE', `/revenues/${id}`),

    // GÉOFENCES
    getGeofences:   ()         => req('GET',    '/geofences'),
    createGeofence: (data)     => req('POST',   '/geofences', data),
    deleteGeofence: (id)       => req('DELETE', `/geofences/${id}`),

    // UTILISATEURS
    getUsers:      ()          => req('GET',    '/users'),
    createUser:    (data)      => req('POST',   '/users', data),
    updateUser:    (id, data)  => req('PUT',    `/users/${id}`, data),
    deleteUser:    (id)        => req('DELETE', `/users/${id}`),

    // STATS
    getStats:       ()         => req('GET', '/stats'),
    getServerStatus:()         => req('GET', '/server/status'),
  };
})();

// ── NOUVELLES ROUTES ───────────────────────────────────────────────
// Score conducteur
const getDriverScores = (from, to) => { const q = new URLSearchParams(); if(from)q.set('from',from); if(to)q.set('to',to); return req('GET', `/driver-scores?${q}`); };
const getDriverScore  = (id, from, to) => { const q = new URLSearchParams(); if(from)q.set('from',from); if(to)q.set('to',to); return req('GET', `/driver-scores/${id}?${q}`); };

// Immobilisation automatique
const getAutoImmo       = ()     => req('GET',  '/auto-immobilization');
const validateAutoImmo  = (id)   => req('POST', `/auto-immobilization/${id}/validate`);
const extendAutoImmo    = (id,until) => req('POST', `/auto-immobilization/${id}/extend`, { until });

// Stats dashboard améliorées
const getDashboardStats = () => req('GET', '/stats/dashboard');

// Assigner ces méthodes à l'objet API global
Object.assign(API, { getDriverScores, getDriverScore, getAutoImmo, validateAutoImmo, extendAutoImmo, getDashboardStats });

// ── ITINÉRAIRES & EXPORTS ──────────────────────────────────────────
Object.assign(API, {
  getRoute:      (body) => req('POST', '/route', body),
  optimizeTour:  (body) => req('POST', '/route/optimize', body),
  exportUrl:     (type, format, params) => {
    const q = new URLSearchParams(params).toString();
    return `/api/export/${type}/${format}?${q}`;
  },
});

// ── COMMANDES AVEC MOTIF + JOURNAL ────────────────────────────────
const _origSendCommand = API.sendCommand;
API.sendCommand = (id, command, reason) => req('POST', `/devices/${id}/command`, { command, reason });
API.getCommandLog = (deviceId) => {
  const path = deviceId ? `/devices/${deviceId}/commands` : '/commands/recent';
  return req('GET', path);
};

// ── ALERTES IA ────────────────────────────────────────────────────────
Object.assign(API, {
  getAIAlerts:      (p={}) => { const q=new URLSearchParams({acknowledged:p.acknowledged||false,limit:p.limit||100,min_score:p.minScore||0,...(p.severity?{severity:p.severity}:{}),...(p.imei?{imei:p.imei}:{})}); return req('GET',`/ai-alerts?${q}`); },
  getAIAlertStats:  ()     => req('GET','/ai-alerts/stats'),
  getAIAlertTrends: (days) => req('GET',`/ai-alerts/trends?days=${days||7}`),
  getHighRiskVehicles: (n) => req('GET',`/ai-alerts/risk-vehicles?limit=${n||5}`),
  ackAIAlert:       (id)   => req('POST',`/ai-alerts/${id}/acknowledge`),
  ackAllAIAlerts:   (sev)  => req('POST','/ai-alerts/acknowledge-all', sev?{severity:sev}:{}),
  snoozeAIAlert:    (id,m) => req('POST',`/ai-alerts/${id}/snooze`,{minutes:m}),
});

// ── RADARS ────────────────────────────────────────────────────────────
Object.assign(API, {
  getRadars:      (p={}) => { const q=new URLSearchParams(p); return req('GET',`/radars?${q}`); },
  addRadar:       (data) => req('POST','/radars',data),
  updateRadar:    (id,d) => req('PUT',`/radars/${id}`,d),
  deleteRadar:    (id)   => req('DELETE',`/radars/${id}`),
  importOSMRadars:()     => req('POST','/radars/import-osm',{}),
});

// ── PLANS & ACCÈS ─────────────────────────────────────────────────────
Object.assign(API, {
  getPlans:          ()         => req('GET', '/plans'),
  getMyAccess:       ()         => req('GET', '/my-access'),
  getUserAccess:     (id)       => req('GET', `/users/${id}/access`).catch(()=>null),
  getOrganizations:  ()         => req('GET', '/organizations'),
  createOrganization:(data)     => req('POST','/organizations', data),
  updateOrgPlan:     (id,p,e)   => req('PUT', `/organizations/${id}/plan`, { plan:p, expiresAt:e }),
  updateUserOverrides:(id,ovr)  => req('PUT', `/users/${id}/overrides`, { overrides:ovr }),
});
