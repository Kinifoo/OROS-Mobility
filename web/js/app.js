/**
 * OROS MOBILITY — Application principale
 */
const Toast = {
  icons: { success:'ti-circle-check', error:'ti-alert-circle', warning:'ti-alert-triangle', info:'ti-info-circle' },
  show(msg, type='info', duration=3500) {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<i class="ti ${this.icons[type]}"></i><span>${msg}</span>`;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity='0'; t.style.transform='translateX(16px)'; t.style.transition='0.3s'; setTimeout(()=>t.remove(),300); }, duration);
  }
};

const WS = (() => {
  let socket=null, delay=2000;
  function connect() {
    try {
      socket = new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);
      socket.onopen = () => {
        delay = 2000;
        const d=document.getElementById('rt-dot'); if(d) d.style.background='var(--green)';
        document.getElementById('rt-label').textContent = 'Mode Temps Réel';
      };
      socket.onmessage = e => {
        try {
          const msg = JSON.parse(e.data);
          dispatch(msg);
          // Hooks externes (voice alerts, etc.)
          if (window.WS_HOOKS) window.WS_HOOKS.forEach(fn => { try { fn(msg); } catch(_){} });
        } catch(err) {}
      };
      socket.onclose  = () => {
        const d=document.getElementById('rt-dot'); if(d) d.style.background='var(--red)';
        document.getElementById('rt-label').textContent = 'Reconnexion...';
        setTimeout(connect, delay = Math.min(delay*2, 30000));
      };
      socket.onerror = () => socket.close();
      socket.isAlive = true;
      socket.onping  = () => { socket.isAlive = true; };
    } catch(e){}
  }
  function dispatch(msg) {
    switch(msg.type) {
      case 'position':
        Pages.dashboard.onPosition(msg);
        Pages.logs.addLog(msg);
        break;
      case 'device_online':
        Pages.dashboard.load();
        Toast.show(`Traceur en ligne : ${msg.imei}`, 'success', 2500);
        break;
      case 'alert':
        Toast.show(`⚠️ ${msg.eventType} — ${msg.imei}`, 'error', 5000);
        const badge=document.getElementById('badge-alerts');
        const dot=document.getElementById('notif-dot');
        if(badge){ badge.style.display=''; badge.textContent=parseInt(badge.textContent||0)+1; }
        if(dot) dot.style.display='';
        break;
    }
  }
  return { connect };
})();

const UI = {
  toggleSidebar() {
    document.getElementById('sidebar')?.classList.toggle('open');
    document.getElementById('sidebar-overlay')?.classList.toggle('visible');
  }
};

const App = {
  currentPage: null,
  devices: [],

  pageMap: {
    dashboard:          { title:'Tableau de bord',      page: ()=>Pages.dashboard },
    trackers:           { title:'Traceurs',             page: ()=>Pages.trackers },
    live:               { title:'Suivi temps réel',     page: ()=>Pages.live },
    history:            { title:'Historique',           page: ()=>Pages.history },
    alerts:             { title:'Alertes',              page: ()=>Pages.alerts },
    geofences:          { title:'Géofences',            page: ()=>Pages.geofences },
    vehicles:           { title:'Véhicules',            page: ()=>Pages.vehicles },
    drivers:            { title:'Conducteurs',          page: ()=>Pages.drivers },
    trips:              { title:'Rapports de trajets',  page: ()=>Pages.trips },
    revenues:           { title:'Recettes',             page: ()=>Pages.revenues },
    'auto-immobilization':{ title:'Immob. automatique', page: ()=>Pages.autoImmo },
    maintenance:        { title:'Maintenance',          page: ()=>Pages.maintenance },
    'add-device':       { title:'Ajouter traceur',      page: ()=>Pages.addDevice },
    users:              { title:'Utilisateurs',         page: ()=>Pages.users },
    settings:           { title:'Paramètres',           page: ()=>Pages.settings },
    logs:               { title:'Journaux système',     page: ()=>Pages.logs },
  },

  async login() {
    const email = document.getElementById('login-email')?.value.trim();
    const pass  = document.getElementById('login-password')?.value;
    const errEl = document.getElementById('login-error');
    const btn   = document.getElementById('login-btn');
    if (!email || !pass) { if(errEl){errEl.textContent='Email et mot de passe requis.';errEl.style.display='block';} return; }
    if(btn) btn.innerHTML='<i class="ti ti-loader"></i> Connexion...';
    try {
      const res = await API.login(email, pass);
      API.setToken(res.token);
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      await this.init();
    } catch(e) {
      if(errEl){errEl.textContent=e.message||'Identifiants incorrects.';errEl.style.display='block';}
    } finally {
      if(btn) btn.innerHTML='<i class="ti ti-login"></i> Se connecter';
    }
  },

  logout() {
    API.clearToken();
    document.getElementById('app').style.display='none';
    document.getElementById('login-screen').style.display='flex';
  },

  async init() {
    try {
      const me = await API.me();
      const n  = me.name || me.email;
      document.getElementById('user-name').textContent    = n;
      document.getElementById('user-role').textContent    = me.role;
      document.getElementById('user-avatar').textContent  = n.charAt(0).toUpperCase();
      document.getElementById('topbar-name').textContent  = n;
      document.getElementById('topbar-email').textContent = me.email;
      document.getElementById('topbar-avatar').textContent= n.charAt(0).toUpperCase();
    } catch(e){}
    WS.connect();
    // Charger le profil d'accès (plan + features)
    await FeatureGate.load();
    await this.navigate('dashboard');
    setInterval(()=>{ if(this.currentPage!=='alerts') Pages.alerts.load(); }, 30000);
  },

  async navigate(page) {
    const entry = this.pageMap[page];
    if (!entry) return;
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    document.getElementById(`page-${page}`)?.classList.add('active');
    document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
    this.currentPage = page;
    MapManager.invalidate();
    if(window.innerWidth<=768){ document.getElementById('sidebar')?.classList.remove('open'); document.getElementById('sidebar-overlay')?.classList.remove('visible'); }
    try { await entry.page().init(); } catch(e){ console.error('Page init error', page, e); }
  },

  async refresh() {
    if(this.currentPage) await this.navigate(this.currentPage);
    Toast.show('Actualisé','info',1500);
  },

  globalSearch(val) {
    // Navigation rapide
    if(val.length>2 && this.currentPage!=='trackers') this.navigate('trackers');
    if(Pages.trackers.all?.length) Pages.trackers.filter(val);
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('login-password')?.addEventListener('keypress', e=>{ if(e.key==='Enter') App.login(); });
  document.getElementById('login-email')?.addEventListener('keypress', e=>{ if(e.key==='Enter') App.login(); });
  if(API.hasToken()) {
    try {
      await API.me();
      document.getElementById('login-screen').style.display='none';
      document.getElementById('app').style.display='flex';
      await App.init();
    } catch(e) { API.clearToken(); }
  }
});

// Enregistrer les nouvelles pages dans le router
Object.assign(App.pageMap, {
  'driver-score':       { title: 'Score conducteur',         page: () => Pages.driverScore },
  'auto-immo-live':     { title: 'Gestion des recettes',     page: () => Pages.autoImmoLive },
  'analytics':          { title: 'Analytique & Rapports',    page: () => Pages.analytics },
  'immobilization':     { title: 'Immobilisation à distance', page: () => Pages.immobilization },
  'ai-alerts':          { title: 'Centre d\'alertes IA',       page: () => Pages.aiAlerts },
  'radars':             { title: 'Radars & Alertes vocales',  page: () => Pages.radars },
  'plans':              { title: 'Plans & Abonnements',        page: () => Pages.plans },
  'route-optimizer':    { title: 'Optimisation itinéraires', page: () => Pages.routeOptimizer },
});
