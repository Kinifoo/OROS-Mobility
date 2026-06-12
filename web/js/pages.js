/** OROS MOBILITY — Logique de toutes les pages */

// ── Utils ──────────────────────────────────────────
const fmt      = (v,u='')  => (v==null)?'—':v+(u?' '+u:'');
const fmtDate  = d => d ? new Date(d).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
const fmtDay   = d => d ? new Date(d).toLocaleDateString('fr-FR') : '—';
const fmtTime  = d => d ? new Date(d).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '—';
const fmtFCFA  = n => (n==null)?'—':new Intl.NumberFormat('fr-FR').format(n)+' FCFA';
const fmtKm    = n => n?new Intl.NumberFormat('fr-FR').format(Math.round(n))+' km':'—';
const fmtAgo   = d => { if(!d)return'—'; const m=Math.floor((Date.now()-new Date(d).getTime())/60000); if(m<1)return'à l\'instant'; if(m<60)return`il y a ${m}min`; const h=Math.floor(m/60); if(h<24)return`il y a ${h}h`; return`il y a ${Math.floor(h/24)}j`; };
const statusLabel = s => ({online:'En ligne',offline:'Hors ligne',idle:'À l\'arrêt',alarm:'ALARME',immobilized:'IMMOBILISÉ'})[s]||s;
const vehicleEmoji = t => ({car:'🚗',moto:'🏍️',truck:'🚛',bus:'🚌',van:'🚐',taxi:'🚕'})[t]||'🚗';

// ── Pages ──────────────────────────────────────────
const Pages = {

  /* ─── DASHBOARD ──────────────────────────────── */
  dashboard: {
    devices: [], selectedImei: null,

    async init() {
      MapManager.initMap('map');
      await this.load();
      setTimeout(()=>MapManager.fitAll(),300);
    },

    async load() {
      try {
        const devs = await API.getDevices();
        this.devices = devs;
        devs.forEach(d=>MapManager.updateDevice(d));
        this.updateKPIs(devs);
        this.renderActivity(devs);
        this.updateDonut(devs);
        this.renderTop5(devs);
        this.renderResources();
        document.getElementById('badge-total').textContent = devs.length;
      } catch(e){}
      try { const ev=await API.getEvents(false); this.renderDashAlerts(ev); } catch(e){}
    },

    updateKPIs(devs) {
      const online  = devs.filter(d=>d.status==='online').length;
      const offline = devs.filter(d=>d.status==='offline').length;
      const total   = devs.length;
      const set=(id,v)=>{ const el=document.getElementById(id); if(el)el.textContent=v; };
      set('kpi-total', total);
      set('kpi-total-sub', online);
      set('kpi-online', online);
      set('kpi-offline', offline);
      const distEl=document.getElementById('kpi-distance');
      if(distEl) distEl.textContent='— km';
    },

    renderActivity(devs) {
      const el=document.getElementById('activity-list');
      if(!el) return;
      const sorted=[...devs].sort((a,b)=>new Date(b.last_seen||0)-new Date(a.last_seen||0)).slice(0,6);
      if(!sorted.length){ el.innerHTML='<div class="loading-state"><i class="ti ti-activity"></i><span>Aucune activité</span></div>'; return; }
      el.innerHTML = sorted.map(d=>{
        const cls = d.speed>3?'moving': d.status==='online'?'moving': d.status==='offline'?'offline':'stopped';
        const icon = d.speed>3?'ti-trending-up': d.status==='offline'?'ti-wifi-off':'ti-player-stop';
        const sub  = d.speed>3?`En mouvement · ${d.speed||0} km/h`: d.status==='offline'?'Hors ligne':d.status==='idle'?'À l\'arrêt':'En ligne';
        const loc  = d.plate?`${d.brand||''} ${d.vmodel||''} · Abidjan`:'—';
        return `<div class="activity-item" onclick="Pages.dashboard.selectDevice('${d.imei}')">
          <div class="act-icon ${cls}"><i class="ti ${icon}"></i></div>
          <div class="act-body">
            <div class="act-name">${d.name||d.imei}</div>
            <div class="act-sub">${sub}</div>
            <div class="act-sub">${loc}</div>
          </div>
          <div class="act-time">${fmtAgo(d.last_seen)}</div>
        </div>`;
      }).join('');
    },

    renderDashAlerts(events) {
      const el=document.getElementById('dash-alerts-list');
      if(!el) return;
      const count=document.getElementById('kpi-alerts-val');
      if(count) count.textContent=events.length;
      const badge=document.getElementById('badge-alerts');
      const dot=document.getElementById('notif-dot');
      if(badge){ badge.textContent=events.length; badge.style.display=events.length?'':'none'; }
      if(dot) dot.style.display=events.length?'':'none';
      if(!events.length){ el.innerHTML='<div class="loading-state"><i class="ti ti-bell-off"></i><span>Aucune alerte</span></div>'; return; }
      const icons={ overspeed:'ti-gauge',power_cut:'ti-plug-off',sos:'ti-sos',exit_fence:'ti-map-pin-off',low_battery:'ti-battery-1',offline:'ti-wifi-off' };
      const colors={ critical:'danger',warning:'warning' };
      el.innerHTML = events.slice(0,6).map(e=>`
        <div class="alert-item">
          <div class="al-icon ${colors[e.severity]||'warning'}"><i class="ti ${icons[e.event_type]||'ti-alert-triangle'}"></i></div>
          <div class="al-body">
            <div class="al-title">${alertLabel(e.event_type)}</div>
            <div class="al-sub">${e.device_name||e.imei}</div>
            <div class="al-time">${fmtAgo(e.created_at)}</div>
          </div>
          <span class="al-badge ${e.severity==='critical'?'danger':'warning'}">${e.severity==='critical'?'Critique':'Alerte'}</span>
        </div>
      `).join('');
    },

    updateDonut(devs) {
      const byProto={};
      devs.forEach(d=>{ byProto[d.protocol]=(byProto[d.protocol]||0)+1; });
      const total=devs.length||1;
      const circ=2*Math.PI*35;
      const protos=['GT06','Teltonika','H02','TK103'];
      const colors=['#1E6FD9','#7C3AED','#16A34A','#D97706'];
      const ids=['gt06','teltonika','h02','tk103'];
      const labels=['dl-gt06','dl-teltonika','dl-h02','dl-tk103'];
      let offset=0;
      protos.forEach((p,i)=>{
        const n=byProto[p]||0;
        const arc=(n/total)*circ;
        const el=document.getElementById('donut-'+ids[i]);
        const lb=document.getElementById(labels[i]);
        if(el){ el.style.strokeDasharray=`${arc} ${circ-arc}`; el.style.strokeDashoffset=-(offset-circ/4); }
        if(lb) lb.textContent=n;
        offset+=arc;
      });
    },

    renderTop5(devs) {
      const el=document.getElementById('top5-list');
      if(!el) return;
      const sorted=[...devs].sort((a,b)=>(b.odometer||0)-(a.odometer||0)).slice(0,5);
      if(!sorted.length){ el.innerHTML='<div style="padding:16px;text-align:center;color:var(--text3);font-size:12px">Données disponibles après trajets</div>'; return; }
      const max=sorted[0].odometer||100;
      el.innerHTML=sorted.map((d,i)=>`
        <div class="top5-row">
          <div class="top5-rank">${i+1}</div>
          <div class="top5-name">${d.plate||d.name||d.imei}</div>
          <div class="top5-bar-wrap"><div class="top5-bar" style="width:${((d.odometer||0)/max*100).toFixed(0)}%"></div></div>
          <div class="top5-val">${fmtKm(d.odometer)}</div>
        </div>
      `).join('');
    },

    renderResources() {
      const cpu=Math.floor(Math.random()*30+10);
      const mem=Math.floor(Math.random()*30+30);
      const disk=Math.floor(Math.random()*20+20);
      const db=Math.floor(Math.random()*15+10);
      const set=(id,val,bar)=>{
        const v=document.getElementById(id); if(v) v.textContent=val+'%';
        const b=document.getElementById(bar); if(b) b.style.width=val+'%';
      };
      set('res-cpu',cpu,'bar-cpu'); set('res-mem',mem,'bar-mem'); set('res-disk',disk,'bar-disk'); set('res-db',db,'bar-db');
    },

    selectDevice(imei) {
      this.selectedImei=imei;
      const d=this.devices.find(x=>x.imei===imei);
      if(!d) return;
      const panel=document.getElementById('device-panel');
      if(panel) panel.style.display='block';
      document.getElementById('dp-name').textContent    = d.name||imei;
      document.getElementById('dp-imei').textContent    = imei;
      document.getElementById('dp-speed').textContent   = d.speed||0;
      document.getElementById('dp-heading').textContent = d.heading?d.heading+'°':'—';
      document.getElementById('dp-sats').textContent    = d.satellites||'—';
      document.getElementById('dp-proto').textContent   = d.protocol||'—';
      document.getElementById('dp-vehicle').textContent = d.plate?`${d.brand} ${d.vmodel} · ${d.plate}`:'—';
      document.getElementById('dp-driver').textContent  = d.driver_name||'—';
      document.getElementById('dp-lastseen').textContent= fmtAgo(d.last_seen);
      const btn=document.getElementById('dp-immo-btn');
      if(btn){
        const immob=(d.status==='immobilized');
        btn.className='dp-immobilize'+(immob?' restore':'');
        btn.innerHTML=immob?'<i class="ti ti-engine"></i> Réactiver':'<i class="ti ti-engine-off"></i> Immobiliser';
        btn.onclick=()=>this.confirmImmobilize();
      }
      MapManager.panTo(imei);
    },

    closePanel() {
      const p=document.getElementById('device-panel'); if(p) p.style.display='none';
      this.selectedImei=null;
    },

    confirmImmobilize() {
      if(!this.selectedImei) return;
      const d=this.devices.find(x=>x.imei===this.selectedImei);
      if(!d) return;
      const isImmob=(d.status==='immobilized');
      const cmd=isImmob?'engine_restore':'engine_cut';
      const action=isImmob?'Réactiver':'Immobiliser';
      const color=isImmob?'var(--green)':'var(--red)';
      const icon=isImmob?'🟢':'🔴';
      Modals.open(
        `<i class="ti ti-engine-off" style="color:${color}"></i> ${action} le véhicule`,
        `<div class="confirm-immo">
          <div class="confirm-immo-icon">${icon}</div>
          <div class="confirm-immo-title">${action} le moteur</div>
          <div class="confirm-immo-vehicle">${d.name||d.imei}</div>
          <div class="confirm-immo-desc">
            ${isImmob
              ? 'Cette action va envoyer la commande ENGINE RESTORE au traceur. Le conducteur pourra redémarrer le véhicule.'
              : 'Cette action va envoyer la commande ENGINE CUT au traceur GPS. <strong>Le véhicule ne pourra plus redémarrer</strong> jusqu\'à réactivation.'}
          </div>
        </div>`,
        `<button class="btn-secondary" onclick="Modals.close()">Annuler</button>
         <button style="background:${color};color:#fff;border:none;border-radius:6px;padding:9px 18px;font-size:13px;font-weight:700;font-family:var(--font);cursor:pointer" onclick="Pages.dashboard.sendCommand('${d.id}','${cmd}')">${action}</button>`
      );
    },

    async sendCommand(id, cmd) {
      Modals.close();
      try {
        await API.sendCommand(id, cmd);
        Toast.show(`Commande ${cmd} envoyée`, 'success');
        await this.load();
      } catch(e){ Toast.show('Erreur : '+e.message,'error'); }
    },

    showHistory() {
      if(this.selectedImei){ const h=document.getElementById('hist-device'); if(h) h.value=this.selectedImei; }
      App.navigate('history');
    },

    toggleFollow() {
      const btn=document.getElementById('follow-btn');
      const active=MapManager.toggleFollow(this.selectedImei);
      btn?.classList.toggle('active',active);
      Toast.show(active?'Suivi activé':'Suivi désactivé','info');
    },

    setLayer(type,el) {
      MapManager.setLayer(type);
      document.querySelectorAll('.card-action-btn').forEach(b=>b.classList.remove('active'));
      el?.classList.add('active');
    },

    onPosition(msg) {
      const d=this.devices.find(x=>x.imei===msg.imei);
      if(d){ Object.assign(d,msg); MapManager.updateDevice(d); if(this.selectedImei===msg.imei) this.selectDevice(msg.imei); }
    }
  },

  /* ─── TRACEURS ───────────────────────────────── */
  trackers: {
    all:[], statusFilter:null, searchTerm:'',

    async init() { await this.load(); },

    async load() {
      const list=document.getElementById('trackers-list');
      if(list) list.innerHTML='<div class="loading-state"><i class="ti ti-loader"></i></div>';
      try {
        this.all=await API.getDevices();
        this.applyFilters();
      } catch(e){ if(list) list.innerHTML='<div class="empty-state"><i class="ti ti-alert-circle"></i>Erreur de chargement</div>'; }
    },

    render(items) {
      const list=document.getElementById('trackers-list');
      if(!list) return;
      if(!items.length){ list.innerHTML='<div class="empty-state"><i class="ti ti-device-mobile-off"></i>Aucun traceur trouvé</div>'; return; }
      list.innerHTML=items.map(d=>{
        const isImmob=d.status==='immobilized';
        return `<div class="device-card ${isImmob?'immobilized':''}" onclick="Pages.trackers.select('${d.imei}')">
          <div class="dc-status ${isImmob?'alarm':d.status}"></div>
          <div class="dc-icon">${vehicleEmoji(d.vtype)}</div>
          <div class="dc-body">
            <div class="dc-name">${d.name||d.imei}</div>
            <div class="dc-sub">${d.imei}</div>
            <div class="dc-tags">
              <span class="dc-tag ${d.status==='online'?'green':d.status==='offline'?'red':d.status==='alarm'?'red':isImmob?'red':'amber'}">${statusLabel(d.status)}</span>
              ${d.plate?`<span class="dc-tag blue">${d.plate}</span>`:''}
              ${d.driver_name?`<span class="dc-tag gray">${d.driver_name}</span>`:''}
              <span class="dc-tag gray mono">${d.protocol||'—'}</span>
            </div>
          </div>
          <div class="dc-right">
            <div class="dc-speed">${d.speed||0}</div>
            <div class="dc-unit">km/h</div>
            <div class="dc-time">${fmtAgo(d.last_seen)}</div>
          </div>
        </div>`;
      }).join('');
    },

    filter(term){ this.searchTerm=term.toLowerCase(); this.applyFilters(); },
    filterStatus(s,el){ this.statusFilter=s; document.querySelectorAll('#tracker-filters .chip').forEach(c=>c.classList.remove('active')); el?.classList.add('active'); this.applyFilters(); },
    applyFilters(){
      this.render(this.all.filter(d=>{
        const ms=!this.searchTerm||(d.name||'').toLowerCase().includes(this.searchTerm)||d.imei.includes(this.searchTerm)||(d.plate||'').toLowerCase().includes(this.searchTerm)||(d.protocol||'').toLowerCase().includes(this.searchTerm);
        const mf=!this.statusFilter||d.status===this.statusFilter;
        return ms&&mf;
      }));
    },
    select(imei){ Pages.dashboard.selectedImei=imei; App.navigate('dashboard'); setTimeout(()=>Pages.dashboard.selectDevice(imei),200); }
  },

  /* ─── LIVE MAP ───────────────────────────────── */
  live: {
    init() { MapManager.initMap('live-map'); setTimeout(()=>MapManager.fitAll(),200); }
  },

  /* ─── HISTORY ────────────────────────────────── */
  history: {
    positions:[], playing:false, playIdx:0, playTimer:null, speed:10,

    async init() {
      MapManager.initHistoryMap();
      try {
        const devs=await API.getDevices();
        const sel=document.getElementById('hist-device');
        if(sel) sel.innerHTML='<option value="">Sélectionner...</option>'+devs.map(d=>`<option value="${d.imei}">${d.name||d.imei}</option>`).join('');
      } catch(e){}
      const today=new Date().toISOString().split('T')[0];
      const f=document.getElementById('hist-from'); if(f&&!f.value) f.value=today;
      const t=document.getElementById('hist-to');   if(t&&!t.value) t.value=today;
    },

    async load() {
      const imei=document.getElementById('hist-device')?.value;
      const from=document.getElementById('hist-from')?.value;
      const to=document.getElementById('hist-to')?.value;
      if(!imei){ Toast.show('Sélectionner un traceur','warning'); return; }
      try {
        const res=await API.getPositions(imei,from+'T00:00:00',(to||from)+'T23:59:59');
        this.positions=res.positions||res||[];
        MapManager.drawHistory(this.positions);
        this.renderList();
        document.getElementById('replay-controls').style.display=this.positions.length?'block':'none';
        if(!this.positions.length) Toast.show('Aucune position','warning');
      } catch(e){ Toast.show('Erreur : '+e.message,'error'); }
    },

    renderList() {
      const el=document.getElementById('history-positions-list'); if(!el) return;
      el.innerHTML=this.positions.map((p,i)=>`
        <div class="pos-item ${this.playIdx===i?'active':''}" onclick="Pages.history.seekTo(${i})">
          <div class="pos-time">${fmtTime(p.time||p.timestamp)}</div>
          <div class="pos-coord">${p.lat?.toFixed(5)}, ${p.lon?.toFixed(5)}</div>
          <div class="pos-speed">${p.speed||0} km/h · ${p.ignition?'🔑 Allumé':'⭕ Coupé'}</div>
        </div>`).join('');
    },

    seekTo(idx) {
      this.playIdx=Math.max(0,Math.min(this.positions.length-1,parseInt(idx)));
      const p=this.positions[this.playIdx];
      if(p){ MapManager.moveReplayMarker(p); document.getElementById('replay-slider').value=this.playIdx; document.getElementById('replay-time').textContent=fmtTime(p.time||p.timestamp); document.getElementById('replay-speed-val').textContent=(p.speed||0)+' km/h'; }
    },

    togglePlay() {
      const btn=document.getElementById('replay-play-btn');
      if(this.playing){ clearInterval(this.playTimer); this.playing=false; if(btn) btn.innerHTML='<i class="ti ti-player-play"></i>'; }
      else { if(this.playIdx>=this.positions.length-1) this.playIdx=0; this.playing=true; if(btn) btn.innerHTML='<i class="ti ti-player-pause"></i>'; this.playTimer=setInterval(()=>{ this.seekTo(this.playIdx+1); document.getElementById('replay-slider').max=this.positions.length-1; if(this.playIdx>=this.positions.length-1) this.togglePlay(); },1000/this.speed); }
    },

    setSpeed(v){ this.speed=parseInt(v); },
    replayBack(){this.seekTo(Math.max(0,this.playIdx-Math.floor(this.positions.length*0.1)));},
    replayForward(){this.seekTo(Math.min(this.positions.length-1,this.playIdx+Math.floor(this.positions.length*0.1)));}
  },

  /* ─── ALERTES ────────────────────────────────── */
  alerts: {
    all:[],
    async init(){ await this.load(); },
    async load(){
      const list=document.getElementById('alerts-list'); if(list) list.innerHTML='<div class="loading-state"><i class="ti ti-loader"></i></div>';
      try { this.all=await API.getEvents(false); this.render(this.all); } catch(e){ if(list) list.innerHTML='<div class="empty-state"><i class="ti ti-alert-circle"></i>Erreur</div>'; }
    },
    render(items){
      const list=document.getElementById('alerts-list'); if(!list) return;
      if(!items.length){ list.innerHTML='<div class="empty-state"><i class="ti ti-bell-off"></i>Aucune alerte active</div>'; return; }
      const icons={overspeed:'ti-gauge',power_cut:'ti-plug-off',sos:'ti-sos',exit_fence:'ti-map-pin-off',low_battery:'ti-battery-1',offline:'ti-wifi-off',vibration:'ti-wave-sine'};
      list.innerHTML=items.map(e=>`
        <div class="alert-card-full ${e.severity}">
          <div class="ac-icon ${e.severity}"><i class="ti ${icons[e.event_type]||'ti-alert-triangle'}"></i></div>
          <div class="ac-body">
            <div class="ac-title">${alertLabel(e.event_type)}</div>
            <div class="ac-sub">${e.device_name||e.imei}</div>
            <div class="ac-time">${fmtDate(e.created_at)}</div>
          </div>
          <button class="ac-ack" onclick="Pages.alerts.ack(${e.id},this)"><i class="ti ti-check"></i> Acquitter</button>
        </div>`).join('');
    },
    filter(s,el){ document.querySelectorAll('.filter-chips .chip').forEach(c=>c.classList.remove('active')); el?.classList.add('active'); this.render(s?this.all.filter(e=>e.severity===s):this.all); },
    async ack(id,btn){ try { await API.ackEvent(id); btn?.closest('.alert-card-full')?.remove(); this.all=this.all.filter(e=>e.id!==id); } catch(e){ Toast.show('Erreur','error'); } },
    async ackAll(){ if(!confirm('Acquitter toutes les alertes ?')) return; try{ await API.ackAllEvents(); await this.load(); Toast.show('Toutes acquittées','success'); } catch(e){ Toast.show('Erreur','error'); } }
  },

  /* ─── GÉOFENCES ──────────────────────────────── */
  geofences: {
    gmap:null,
    async init(){ this.gmap=MapManager.initGeofenceMap(); await this.load(); },
    async load(){
      const list=document.getElementById('geofences-list');
      try {
        const gfs=await API.getGeofences();
        MapManager.drawGeofences(gfs);
        if(list) list.innerHTML=gfs.length?gfs.map(g=>`
          <div class="fleet-card">
            <div class="fc-avatar">${g.type==='circle'?'⭕':'🔷'}</div>
            <div class="fc-body"><div class="fc-name">${g.name}</div><div class="fc-sub">${g.type==='circle'?`Rayon: ${g.radius}m`:'Polygone'}</div>
            <div class="fc-tags">${g.alert_enter?'<span class="fc-tag green">🔔 Entrée</span>':''}${g.alert_exit?'<span class="fc-tag amber">🔔 Sortie</span>':''}</div></div>
            <div class="fc-actions"><button class="btn-sm danger" onclick="Pages.geofences.delete(${g.id})"><i class="ti ti-trash"></i></button></div>
          </div>`).join(''):'<div class="empty-state" style="padding:20px"><i class="ti ti-map-pin-off"></i>Aucune géofence</div>';
      } catch(e){}
    },
    async delete(id){ if(!confirm('Supprimer ?')) return; try{ await API.deleteGeofence(id); await this.load(); Toast.show('Supprimée','success'); }catch(e){ Toast.show('Erreur','error'); } },
    startDraw(type){ const name=prompt('Nom de la géofence :'); if(!name) return; const radius=parseInt(prompt('Rayon (mètres) :')||500); const c=this.gmap?.getCenter()||{lat:5.354,lng:-4.007}; API.createGeofence({name,type:'circle',lat:c.lat,lon:c.lng,radius,alert_enter:true,alert_exit:true}).then(()=>{ this.load(); Toast.show('Géofence créée','success'); }).catch(e=>Toast.show('Erreur : '+e.message,'error')); }
  },

  /* ─── VÉHICULES ──────────────────────────────── */
  vehicles: {
    all:[],
    async init(){ await this.load(); },
    async load(){
      const list=document.getElementById('vehicles-list'); if(list) list.innerHTML='<div class="loading-state"><i class="ti ti-loader"></i></div>';
      try { this.all=await API.getVehicles(); this.render(this.all); } catch(e){ if(list) list.innerHTML='<div class="empty-state"><i class="ti ti-car-off"></i>Erreur</div>'; }
    },
    render(items){
      const list=document.getElementById('vehicles-list'); if(!list) return;
      if(!items.length){ list.innerHTML='<div class="empty-state"><i class="ti ti-car-off"></i>Aucun véhicule<br><button class="btn-primary" style="margin-top:12px" onclick="Modals.addVehicle()"><i class="ti ti-plus"></i> Ajouter</button></div>'; return; }
      list.innerHTML=items.map(v=>`
        <div class="fleet-card">
          <div class="fc-avatar">${vehicleEmoji(v.type)}</div>
          <div class="fc-body">
            <div class="fc-name">${v.brand} ${v.model} — <span class="mono">${v.plate}</span></div>
            <div class="fc-sub">${v.color||''} · ${v.year||'—'}</div>
            <div class="fc-tags">
              ${v.device_imei?`<span class="fc-tag blue">📡 ${v.device_imei}</span>`:'<span class="fc-tag">Pas de traceur</span>'}
              ${v.driver_name?`<span class="fc-tag green">👤 ${v.driver_name}</span>`:''}
              ${v.daily_target?`<span class="fc-tag">🎯 ${fmtFCFA(v.daily_target)}/j</span>`:''}
            </div>
          </div>
          <div class="fc-actions">
            <button class="btn-sm danger" onclick="Pages.vehicles.delete(${v.id})"><i class="ti ti-trash"></i></button>
          </div>
        </div>`).join('');
    },
    filter(t){ const tt=t.toLowerCase(); this.render(this.all.filter(v=>(v.plate||'').toLowerCase().includes(tt)||(v.brand||'').toLowerCase().includes(tt)||(v.model||'').toLowerCase().includes(tt))); },
    async delete(id){ if(!confirm('Supprimer ce véhicule ?')) return; try{ await API.deleteVehicle(id); await this.load(); Toast.show('Supprimé','success'); }catch(e){ Toast.show('Erreur : '+e.message,'error'); } }
  },

  /* ─── CONDUCTEURS ────────────────────────────── */
  drivers: {
    all:[],
    async init(){ await this.load(); },
    async load(){
      const list=document.getElementById('drivers-list'); if(list) list.innerHTML='<div class="loading-state"><i class="ti ti-loader"></i></div>';
      try { this.all=await API.getDrivers(); this.render(this.all); } catch(e){ if(list) list.innerHTML='<div class="empty-state"><i class="ti ti-user-off"></i>Erreur</div>'; }
    },
    render(items){
      const list=document.getElementById('drivers-list'); if(!list) return;
      if(!items.length){ list.innerHTML='<div class="empty-state"><i class="ti ti-user-off"></i>Aucun conducteur<br><button class="btn-primary" style="margin-top:12px" onclick="Modals.addDriver()"><i class="ti ti-plus"></i> Ajouter</button></div>'; return; }
      list.innerHTML=items.map(d=>`
        <div class="fleet-card">
          <div class="fc-avatar" style="background:var(--blue-lt);color:var(--blue);font-weight:700;font-size:16px">${(d.name||'X').charAt(0).toUpperCase()}</div>
          <div class="fc-body">
            <div class="fc-name">${d.name}</div>
            <div class="fc-sub">${d.phone||'—'} · Permis: ${d.license||'—'}</div>
            <div class="fc-tags">
              ${d.vehicle_plate?`<span class="fc-tag blue">🚗 ${d.vehicle_plate}</span>`:'<span class="fc-tag">Non affecté</span>'}
              <span class="fc-tag ${d.status==='active'?'green':'amber'}">${d.status==='active'?'Actif':'Inactif'}</span>
            </div>
          </div>
          <div class="fc-actions"><button class="btn-sm danger" onclick="Pages.drivers.delete(${d.id})"><i class="ti ti-trash"></i></button></div>
        </div>`).join('');
    },
    filter(t){ const tt=t.toLowerCase(); this.render(this.all.filter(d=>(d.name||'').toLowerCase().includes(tt)||(d.phone||'').includes(tt))); },
    async delete(id){ if(!confirm('Supprimer ?')) return; try{ await API.deleteDriver(id); await this.load(); Toast.show('Supprimé','success'); }catch(e){ Toast.show('Erreur','error'); } }
  },

  /* ─── TRAJETS ────────────────────────────────── */
  trips: {
    async init(){
      try { const devs=await API.getDevices(); const sel=document.getElementById('trips-device'); if(sel) sel.innerHTML='<option value="">Tous</option>'+devs.map(d=>`<option value="${d.imei}">${d.name||d.imei}</option>`).join(''); }catch(e){}
      const today=new Date().toISOString().split('T')[0];
      const f=document.getElementById('trips-from'); if(f) f.value=today;
      const t=document.getElementById('trips-to');   if(t) t.value=today;
      await this.load();
    },
    async load(){
      const list=document.getElementById('trips-list'); if(list) list.innerHTML='<div class="loading-state"><i class="ti ti-loader"></i></div>';
      try {
        const params={};
        const imei=document.getElementById('trips-device')?.value; const from=document.getElementById('trips-from')?.value; const to=document.getElementById('trips-to')?.value;
        if(imei) params.imei=imei; if(from) params.from=from+'T00:00:00'; if(to) params.to=to+'T23:59:59';
        const res=await API.getTrips(params); const trips=res.trips||res||[];
        const sm=document.getElementById('trips-summary');
        if(sm){ const totalKm=trips.reduce((s,t)=>s+(t.distance||0),0); const totalMin=trips.reduce((s,t)=>s+(t.duration_minutes||0),0); sm.innerHTML=`<div class="trip-kpi"><strong>${trips.length}</strong> trajets</div><div class="trip-kpi"><strong>${fmtKm(totalKm)}</strong></div><div class="trip-kpi"><strong>${Math.floor(totalMin/60)}h${totalMin%60}min</strong></div>`; }
        if(list){ if(!trips.length){ list.innerHTML='<div class="empty-state"><i class="ti ti-route-off"></i>Aucun trajet pour cette période</div>'; return; } list.innerHTML=trips.map(t=>`<div class="trip-card"><div class="trip-icon"><i class="ti ti-route"></i></div><div class="trip-body"><div class="trip-title">${t.device_name||t.imei} · ${fmtDay(t.start_time)}</div><div class="trip-meta"><span><i class="ti ti-clock"></i>${fmtTime(t.start_time)} → ${fmtTime(t.end_time)}</span><span><i class="ti ti-road"></i>${fmtKm(t.distance)}</span><span><i class="ti ti-gauge"></i>Max: ${t.max_speed||0} km/h</span>${t.driver_name?`<span><i class="ti ti-user"></i>${t.driver_name}</span>`:''}</div></div></div>`).join(''); }
      } catch(e){ if(list) list.innerHTML='<div class="empty-state"><i class="ti ti-route-off"></i>Aucun trajet</div>'; }
    }
  },

  /* ─── REVENUS ────────────────────────────────── */
  revenues: {
    async init(){
      try{ const vs=await API.getVehicles(); const sel=document.getElementById('rev-vehicle'); if(sel) sel.innerHTML='<option value="">Tous</option>'+vs.map(v=>`<option value="${v.id}">${v.plate} — ${v.brand} ${v.model}</option>`).join(''); }catch(e){}
      const today=new Date().toISOString().split('T')[0];
      const f=document.getElementById('rev-from'); if(f) f.value=today;
      const t=document.getElementById('rev-to');   if(t) t.value=today;
      await this.load();
    },
    async load(){
      const list=document.getElementById('revenues-list'); if(list) list.innerHTML='<div class="loading-state"><i class="ti ti-loader"></i></div>';
      try {
        const params={}; const vid=document.getElementById('rev-vehicle')?.value; const from=document.getElementById('rev-from')?.value; const to=document.getElementById('rev-to')?.value;
        if(vid) params.vehicle_id=vid; if(from) params.from=from; if(to) params.to=to;
        const res=await API.getRevenues(params); const items=res.revenues||res||[];
        const kpi=document.getElementById('revenue-kpis');
        if(kpi){ const total=items.reduce((s,r)=>s+(r.amount||0),0); const validated=items.filter(r=>r.validated).reduce((s,r)=>s+(r.amount||0),0); kpi.innerHTML=`<div class="rev-kpi"><div class="rev-kpi-val" style="color:var(--blue)">${fmtFCFA(total)}</div><div class="rev-kpi-label">Total recettes</div></div><div class="rev-kpi"><div class="rev-kpi-val" style="color:var(--green)">${fmtFCFA(validated)}</div><div class="rev-kpi-label">Validé</div></div><div class="rev-kpi"><div class="rev-kpi-val" style="color:var(--amber)">${fmtFCFA(total-validated)}</div><div class="rev-kpi-label">En attente</div></div><div class="rev-kpi"><div class="rev-kpi-val">${items.length}</div><div class="rev-kpi-label">Transactions</div></div>`; }
        const mIcons={orange_money:'🟠',mtn_momo:'🟡',wave:'🔵',moov:'🟢',cash:'💵'};
        const mLabels={orange_money:'Orange Money',mtn_momo:'MTN MoMo',wave:'Wave',moov:'Moov Money',cash:'Espèces'};
        if(list){ if(!items.length){ list.innerHTML='<div class="empty-state"><i class="ti ti-currency-dollar"></i>Aucune recette<br><button class="btn-success" style="margin-top:12px" onclick="Modals.addRevenue()"><i class="ti ti-plus"></i> Saisir</button></div>'; return; }
          list.innerHTML=items.map(r=>`<div class="fleet-card"><div class="fc-avatar">${mIcons[r.payment_method]||'💰'}</div><div class="fc-body"><div class="fc-name">${r.vehicle_plate||'—'} — ${fmtDay(r.date)}</div><div class="fc-sub">${mLabels[r.payment_method]||r.payment_method||'—'} · ${r.driver_name||'—'}</div><div class="fc-tags">${r.validated?'<span class="fc-tag green">✅ Validé</span>':'<span class="fc-tag amber">⏳ En attente</span>'}${r.notes?`<span class="fc-tag">${r.notes}</span>`:''}</div></div><div class="fc-actions" style="flex-direction:column;align-items:flex-end"><div style="font-size:17px;font-weight:800;color:var(--blue);font-family:var(--mono)">${fmtFCFA(r.amount)}</div><button class="btn-sm danger" onclick="Pages.revenues.delete(${r.id})"><i class="ti ti-trash"></i></button></div></div>`).join(''); }
      } catch(e){ if(list) list.innerHTML='<div class="empty-state"><i class="ti ti-alert-circle"></i>Erreur</div>'; }
    },
    async delete(id){ if(!confirm('Supprimer cette recette ?')) return; try{ await API.deleteRevenue(id); await this.load(); Toast.show('Supprimée','success'); }catch(e){ Toast.show('Erreur','error'); } }
  },

  /* ─── AUTO IMMO (page statique) ─────────────── */
  autoImmo: { init(){} },

  /* ─── MAINTENANCE ────────────────────────────── */
  maintenance: {
    async init(){ await this.load(); },
    async load(){
      const list=document.getElementById('maintenance-list'); if(list) list.innerHTML='<div class="loading-state"><i class="ti ti-loader"></i></div>';
      try {
        const items=await API.getMaintenance();
        if(!list) return;
        if(!items.length){ list.innerHTML='<div class="empty-state"><i class="ti ti-tool"></i>Aucune maintenance<br><button class="btn-primary" style="margin-top:12px" onclick="Modals.addMaintenance()"><i class="ti ti-plus"></i> Ajouter</button></div>'; return; }
        const tIcons={oil:'🛢️',tires:'🔄',brakes:'🛑',revision:'🔧',belt:'⚙️',filter:'🔩',other:'🔨'};
        const tLabels={oil:'Vidange',tires:'Pneumatiques',brakes:'Freins',revision:'Révision',belt:'Courroie',filter:'Filtre',other:'Autre'};
        list.innerHTML=items.map(m=>{ const isOverdue=m.due_date&&new Date(m.due_date)<new Date()&&m.status!=='done'; const isDueSoon=m.due_date&&!isOverdue&&(new Date(m.due_date)-Date.now())<7*86400000; return `<div class="maint-card ${isOverdue?'overdue':isDueSoon?'due-soon':''}"><div class="maint-icon">${tIcons[m.type]||'🔧'}</div><div class="maint-body"><div class="maint-title">${tLabels[m.type]||m.type} — ${m.vehicle_plate||'—'}</div><div class="maint-sub">${m.description||''} · ${m.garage||''}</div><div class="fc-tags" style="margin-top:6px">${isOverdue?'<span class="fc-tag red">⚠️ En retard</span>':''}${isDueSoon?'<span class="fc-tag amber">⏰ Bientôt</span>':''}${m.status==='done'?'<span class="fc-tag green">✅ Fait</span>':''}${m.cost?`<span class="fc-tag">${fmtFCFA(m.cost)}</span>`:''}</div></div><div class="maint-right"><div class="maint-date">${fmtDay(m.due_date)}</div>${m.due_km?`<div class="maint-km">${fmtKm(m.due_km)}</div>`:''}</div></div>`; }).join('');
      } catch(e){ if(list) list.innerHTML='<div class="empty-state"><i class="ti ti-alert-circle"></i>Erreur</div>'; }
    }
  },

  /* ─── ADD DEVICE ─────────────────────────────── */
  addDevice: {
    init(){},
    async save(){
      const name=document.getElementById('dev-name')?.value.trim(); const imei=document.getElementById('dev-imei')?.value.trim(); const protocol=document.getElementById('dev-protocol')?.value; const errEl=document.getElementById('add-device-error');
      if(!name||!imei){ if(errEl){errEl.textContent='Nom et IMEI obligatoires.';errEl.style.display='block';} return; }
      if(!/^\d{15}$/.test(imei)){ if(errEl){errEl.textContent='IMEI : exactement 15 chiffres.';errEl.style.display='block';} return; }
      if(errEl) errEl.style.display='none';
      const portMap={GT06:8090,Teltonika:5027,H02:5013,Seeworld:8000,TK103:5002};
      try {
        await API.createDevice({name,imei,protocol,model:document.getElementById('dev-model')?.value.trim(),phone:document.getElementById('dev-phone')?.value.trim(),max_speed:parseInt(document.getElementById('dev-speed')?.value)||100,port:portMap[protocol]||0});
        Toast.show('Traceur enregistré !','success'); App.navigate('trackers');
      } catch(e){ if(errEl){errEl.textContent='Erreur : '+e.message;errEl.style.display='block';} }
    }
  },

  /* ─── USERS ──────────────────────────────────── */
  users: {
    async init(){ await this.load(); },
    async load(){
      const list=document.getElementById('users-list'); if(!list) return;
      try {
        const users=await API.getUsers();
        list.innerHTML=users.map(u=>`<div class="fleet-card"><div class="fc-avatar" style="background:var(--purple-lt);color:var(--purple);font-weight:700">${(u.name||u.email).charAt(0).toUpperCase()}</div><div class="fc-body"><div class="fc-name">${u.name||'—'}</div><div class="fc-sub">${u.email}</div><div class="fc-tags"><span class="fc-tag ${u.role==='admin'||u.role==='superadmin'?'blue':''}">${u.role}</span>${u.active?'<span class="fc-tag green">Actif</span>':'<span class="fc-tag">Inactif</span>'}</div></div><div class="fc-actions"><button class="btn-sm danger" onclick="Pages.users.delete(${u.id})"><i class="ti ti-trash"></i></button></div></div>`).join('');
      } catch(e){ list.innerHTML='<div class="empty-state">Erreur</div>'; }
    },
    async delete(id){ if(!confirm('Supprimer ?')) return; try{ await API.deleteUser(id); await this.load(); Toast.show('Supprimé','success'); }catch(e){ Toast.show('Erreur','error'); } }
  },

  /* ─── SETTINGS ───────────────────────────────── */
  settings: {
    async init(){
      try { const me=await API.me(); const n=document.getElementById('profile-name'); const e=document.getElementById('profile-email'); if(n) n.value=me.name||''; if(e) e.value=me.email||''; } catch(ex){}
    },
    async saveProfile(){
      const name=document.getElementById('profile-name')?.value.trim(); const pass=document.getElementById('profile-pass')?.value;
      try { const me=await API.me(); await API.updateUser(me.id,{name,...(pass?{password:pass}:{})}); Toast.show('Profil mis à jour','success'); document.getElementById('user-name').textContent=name; } catch(e){ Toast.show('Erreur : '+e.message,'error'); }
    }
  },

  /* ─── LOGS ───────────────────────────────────── */
  logs: {
    count:0,
    init(){},
    addLog(msg){
      const list=document.getElementById('logs-list'); if(!list) return;
      this.count++;
      const el=document.getElementById('log-count'); if(el) el.textContent=`${this.count} trames reçues`;
      const div=document.createElement('div');
      div.style.cssText='display:flex;gap:12px;padding:3px 0;animation:slideIn 0.2s ease';
      div.innerHTML=`<span style="color:#3D5A78">${fmtTime(msg.timestamp||new Date())}</span><span style="color:#22D3EE">[${msg.protocol||'?'}]</span><span style="color:#60A5FA">${msg.imei}</span><span style="color:#94A3B8">${msg.lat?.toFixed(4)},${msg.lon?.toFixed(4)}</span><span style="color:#FBBF24">${msg.speed||0}km/h</span>`;
      list.insertBefore(div,list.firstChild);
      while(list.children.length>50) list.removeChild(list.lastChild);
    }
  }
};

// ── Modals ─────────────────────────────────────────
const Modals = {
  open(title,body,footer=''){
    document.getElementById('modal-title').innerHTML=title;
    document.getElementById('modal-body').innerHTML=body;
    document.getElementById('modal-footer').innerHTML=footer;
    document.getElementById('modal-overlay').style.display='flex';
  },
  close(){ document.getElementById('modal-overlay').style.display='none'; },

  addVehicle(){
    this.open('<i class="ti ti-car" style="color:var(--blue)"></i> Ajouter un véhicule',
      `<div class="form-grid">
        <div class="form-group"><label>Marque *</label><input id="m-brand" class="form-input" placeholder="Toyota, Hyundai..."></div>
        <div class="form-group"><label>Modèle *</label><input id="m-model" class="form-input" placeholder="Corolla..."></div>
        <div class="form-group"><label>Plaque *</label><input id="m-plate" class="form-input mono" placeholder="AB 1234 CI"></div>
        <div class="form-group"><label>Type</label><select id="m-type" class="form-select"><option value="car">Voiture</option><option value="taxi">Taxi/VTC</option><option value="moto">Moto</option><option value="truck">Camion</option><option value="van">Minibus</option></select></div>
        <div class="form-group"><label>Couleur</label><input id="m-color" class="form-input" placeholder="Blanc..."></div>
        <div class="form-group"><label>Année</label><input id="m-year" class="form-input mono" type="number" placeholder="2022"></div>
        <div class="form-group full"><label>IMEI traceur GPS</label><input id="m-device-imei" class="form-input mono" placeholder="Laisser vide si non affecté"></div>
        <div class="form-group full"><label>Objectif journalier (FCFA)</label><input id="m-daily-target" class="form-input mono" type="number" placeholder="15000"></div>
      </div>`,
      `<button class="btn-secondary" onclick="Modals.close()">Annuler</button><button class="btn-primary" onclick="Modals.saveVehicle()"><i class="ti ti-device-floppy"></i> Enregistrer</button>`
    );
  },
  async saveVehicle(){
    const brand=document.getElementById('m-brand')?.value.trim(); const model=document.getElementById('m-model')?.value.trim(); const plate=document.getElementById('m-plate')?.value.trim();
    if(!brand||!model||!plate){ Toast.show('Marque, modèle et plaque obligatoires','warning'); return; }
    try { await API.createVehicle({brand,model,plate,type:document.getElementById('m-type')?.value,color:document.getElementById('m-color')?.value.trim(),year:parseInt(document.getElementById('m-year')?.value)||null,device_imei:document.getElementById('m-device-imei')?.value.trim()||null,daily_target:parseInt(document.getElementById('m-daily-target')?.value)||null}); this.close(); await Pages.vehicles.load(); Toast.show('Véhicule ajouté','success'); } catch(e){ Toast.show('Erreur : '+e.message,'error'); }
  },

  addDriver(){
    this.open('<i class="ti ti-steering-wheel" style="color:var(--blue)"></i> Ajouter un conducteur',
      `<div class="form-grid">
        <div class="form-group full"><label>Nom complet *</label><input id="m-dname" class="form-input" placeholder="Kouassi Jean"></div>
        <div class="form-group"><label>Téléphone *</label><input id="m-dphone" class="form-input mono" placeholder="+225 07 00 00 00 00"></div>
        <div class="form-group"><label>Numéro de permis</label><input id="m-dlicense" class="form-input mono"></div>
        <div class="form-group full"><label>Email</label><input id="m-demail" class="form-input" type="email"></div>
      </div>`,
      `<button class="btn-secondary" onclick="Modals.close()">Annuler</button><button class="btn-primary" onclick="Modals.saveDriver()"><i class="ti ti-device-floppy"></i> Enregistrer</button>`
    );
  },
  async saveDriver(){
    const name=document.getElementById('m-dname')?.value.trim(); const phone=document.getElementById('m-dphone')?.value.trim();
    if(!name||!phone){ Toast.show('Nom et téléphone obligatoires','warning'); return; }
    try { await API.createDriver({name,phone,license:document.getElementById('m-dlicense')?.value.trim(),email:document.getElementById('m-demail')?.value.trim()}); this.close(); await Pages.drivers.load(); Toast.show('Conducteur ajouté','success'); } catch(e){ Toast.show('Erreur : '+e.message,'error'); }
  },

  addMaintenance(){
    this.open('<i class="ti ti-tool" style="color:var(--blue)"></i> Ajouter une maintenance',
      `<div class="form-grid">
        <div class="form-group"><label>Type *</label><select id="m-mtype" class="form-select"><option value="oil">Vidange</option><option value="tires">Pneumatiques</option><option value="brakes">Freins</option><option value="revision">Révision</option><option value="belt">Courroie</option><option value="filter">Filtre(s)</option><option value="other">Autre</option></select></div>
        <div class="form-group"><label>Date prévue</label><input id="m-mdate" class="form-input" type="date"></div>
        <div class="form-group"><label>Kilométrage</label><input id="m-mkm" class="form-input mono" type="number" placeholder="50000"></div>
        <div class="form-group"><label>Coût (FCFA)</label><input id="m-mcost" class="form-input mono" type="number" placeholder="25000"></div>
        <div class="form-group full"><label>Garage</label><input id="m-mgarage" class="form-input" placeholder="Nom du garage"></div>
        <div class="form-group full"><label>Description</label><input id="m-mdesc" class="form-input" placeholder="Détails..."></div>
      </div>`,
      `<button class="btn-secondary" onclick="Modals.close()">Annuler</button><button class="btn-primary" onclick="Modals.saveMaintenance()"><i class="ti ti-device-floppy"></i> Enregistrer</button>`
    );
  },
  async saveMaintenance(){
    try { await API.createMaintenance({type:document.getElementById('m-mtype')?.value,due_date:document.getElementById('m-mdate')?.value,due_km:parseInt(document.getElementById('m-mkm')?.value)||null,cost:parseInt(document.getElementById('m-mcost')?.value)||null,garage:document.getElementById('m-mgarage')?.value.trim(),description:document.getElementById('m-mdesc')?.value.trim()}); this.close(); await Pages.maintenance.load(); Toast.show('Maintenance enregistrée','success'); } catch(e){ Toast.show('Erreur : '+e.message,'error'); }
  },

  addRevenue(){
    this.open('<i class="ti ti-currency-dollar" style="color:var(--green)"></i> Saisir une recette',
      `<div class="form-grid">
        <div class="form-group"><label>Montant (FCFA) *</label><input id="m-ramount" class="form-input mono" type="number" placeholder="15000"></div>
        <div class="form-group"><label>Date</label><input id="m-rdate" class="form-input" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
        <div class="form-group full"><label>Mode de paiement</label><select id="m-rmethod" class="form-select"><option value="cash">💵 Espèces</option><option value="orange_money">🟠 Orange Money</option><option value="mtn_momo">🟡 MTN MoMo</option><option value="wave">🔵 Wave</option><option value="moov">🟢 Moov Money</option></select></div>
        <div class="form-group full"><label>Référence Mobile Money</label><input id="m-rref" class="form-input mono" placeholder="Numéro de confirmation"></div>
        <div class="form-group full"><label>Notes</label><input id="m-rnotes" class="form-input" placeholder="Observations..."></div>
      </div>`,
      `<button class="btn-secondary" onclick="Modals.close()">Annuler</button><button class="btn-success" onclick="Modals.saveRevenue()"><i class="ti ti-device-floppy"></i> Enregistrer</button>`
    );
  },
  async saveRevenue(){
    const amount=parseInt(document.getElementById('m-ramount')?.value);
    if(!amount||amount<=0){ Toast.show('Montant invalide','warning'); return; }
    try { await API.createRevenue({amount,date:document.getElementById('m-rdate')?.value,payment_method:document.getElementById('m-rmethod')?.value,reference:document.getElementById('m-rref')?.value.trim(),notes:document.getElementById('m-rnotes')?.value.trim()}); this.close(); await Pages.revenues.load(); Toast.show('Recette : '+fmtFCFA(amount),'success'); } catch(e){ Toast.show('Erreur : '+e.message,'error'); }
  },

  addUser(){
    this.open('<i class="ti ti-user-plus" style="color:var(--blue)"></i> Ajouter un utilisateur',
      `<div class="form-grid">
        <div class="form-group full"><label>Nom</label><input id="m-uname" class="form-input" placeholder="Prénom Nom"></div>
        <div class="form-group"><label>Email *</label><input id="m-uemail" class="form-input" type="email"></div>
        <div class="form-group"><label>Mot de passe *</label><input id="m-upass" class="form-input" type="password"></div>
        <div class="form-group full"><label>Rôle</label><select id="m-urole" class="form-select"><option value="viewer">Observateur</option><option value="driver">Conducteur</option><option value="manager">Gestionnaire</option><option value="admin">Administrateur</option></select></div>
      </div>`,
      `<button class="btn-secondary" onclick="Modals.close()">Annuler</button><button class="btn-primary" onclick="Modals.saveUser()"><i class="ti ti-device-floppy"></i> Créer</button>`
    );
  },
  async saveUser(){
    const email=document.getElementById('m-uemail')?.value.trim(); const pass=document.getElementById('m-upass')?.value;
    if(!email||!pass){ Toast.show('Email et mot de passe obligatoires','warning'); return; }
    try { await API.createUser({name:document.getElementById('m-uname')?.value.trim(),email,password:pass,role:document.getElementById('m-urole')?.value}); this.close(); await Pages.users.load(); Toast.show('Utilisateur créé','success'); } catch(e){ Toast.show('Erreur : '+e.message,'error'); }
  }
};

// ── Alert labels ────────────────────────────────────
function alertLabel(t){
  return ({overspeed:'Excès de vitesse',power_cut:'Coupure alimentation',sos:'SOS',exit_fence:'Sortie de zone',enter_fence:'Entrée en zone',low_battery:'Batterie faible',engine_alarm:'Alarme moteur',offline:'Traceur hors ligne',vibration:'Vibration détectée'})[t]||t;
}

/* ─── SCORE CONDUCTEUR ────────────────────────────────────────────── */
Pages.driverScore = {
  ranking: [],

  async init() {
    // Injecter la page dans le DOM si pas encore là
    if (!document.getElementById('page-driver-score')) {
      const div = document.createElement('div');
      div.id = 'page-driver-score';
      div.className = 'page';
      div.innerHTML = `
        <div class="page-header">
          <div><div class="page-title-h">Score conducteur</div><div class="page-subtitle">Classement et analyse comportement de conduite</div></div>
          <div class="page-actions">
            <input type="date" id="score-from" class="form-input" style="width:140px">
            <input type="date" id="score-to" class="form-input" style="width:140px">
            <button class="btn-primary" onclick="Pages.driverScore.load()"><i class="ti ti-refresh"></i> Actualiser</button>
          </div>
        </div>
        <div style="padding:0 24px 24px;flex:1;overflow-y:auto">
          <div id="score-podium" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px"></div>
          <div id="score-table" class="card-list" style="padding:0"></div>
        </div>
      `;
      document.querySelector('.pages-container').appendChild(div);
    }
    const today = new Date().toISOString().split('T')[0];
    const from30 = new Date(Date.now()-30*86400000).toISOString().split('T')[0];
    const f = document.getElementById('score-from'); if(f&&!f.value) f.value=from30;
    const t = document.getElementById('score-to');   if(t&&!t.value) t.value=today;
    await this.load();
  },

  async load() {
    const from = document.getElementById('score-from')?.value;
    const to   = document.getElementById('score-to')?.value;
    try {
      const res = await API.getDriverScores(from, to);
      this.ranking = res.ranking || [];
      this.renderPodium();
      this.renderTable();
    } catch(e) {
      const el = document.getElementById('score-table');
      if(el) el.innerHTML = '<div class="empty-state"><i class="ti ti-trophy-off"></i>Données insuffisantes — des trajets doivent être enregistrés</div>';
    }
  },

  renderPodium() {
    const el = document.getElementById('score-podium');
    if (!el) return;
    const top3 = this.ranking.slice(0,3);
    const medals = ['🥇','🥈','🥉'];
    const bgs = ['var(--amber-lt)','var(--bg)','var(--bg)'];
    el.innerHTML = top3.map((d,i) => `
      <div style="background:${bgs[i]};border:1px solid var(--border);border-radius:var(--radius);padding:20px;text-align:center;box-shadow:var(--shadow)">
        <div style="font-size:32px;margin-bottom:8px">${medals[i]}</div>
        <div style="font-size:15px;font-weight:800">${d.name}</div>
        <div style="font-size:28px;font-weight:800;color:${scoreColor(d.score)};font-family:var(--mono);margin:8px 0">${d.score}</div>
        <div style="font-size:12px;font-weight:700;color:${scoreColor(d.score)};background:${scoreColor(d.score)}18;display:inline-block;padding:2px 10px;border-radius:99px">Mention ${d.grade}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:8px">${d.tripCount} trajets · ${fmtKm(d.totalKm)}</div>
      </div>
    `).join('');
  },

  renderTable() {
    const el = document.getElementById('score-table');
    if (!el) return;
    if (!this.ranking.length) { el.innerHTML='<div class="empty-state"><i class="ti ti-trophy-off"></i>Aucune donnée</div>'; return; }
    el.innerHTML = this.ranking.map(d => `
      <div class="fleet-card" onclick="Pages.driverScore.showDetail(${d.driverId})" style="cursor:pointer">
        <div class="fc-avatar" style="background:${scoreColor(d.score)}18;color:${scoreColor(d.score)};font-size:18px;font-weight:800">${d.grade}</div>
        <div class="fc-body">
          <div style="display:flex;align-items:center;gap:8px">
            <div class="fc-name">#${d.rank} — ${d.name}</div>
            <span style="font-size:10px;background:var(--bg);color:var(--text3);padding:2px 8px;border-radius:99px;border:1px solid var(--border)">${d.tripCount} trajets</span>
          </div>
          <div style="display:flex;gap:14px;margin-top:6px;flex-wrap:wrap">
            <span style="font-size:11px;color:var(--text3)"><i class="ti ti-road" style="color:var(--blue)"></i> ${fmtKm(d.totalKm)}</span>
            <span style="font-size:11px;color:var(--red)"><i class="ti ti-brake" style="color:var(--red)"></i> ${d.harshBrakes} frein. brusques</span>
            <span style="font-size:11px;color:var(--amber)"><i class="ti ti-gauge" style="color:var(--amber)"></i> ${d.overSpeeds} excès</span>
            <span style="font-size:11px;color:var(--text3)"><i class="ti ti-activity"></i> Max ${d.peakSpeed} km/h</span>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:24px;font-weight:800;font-family:var(--mono);color:${scoreColor(d.score)}">${d.score}</div>
          <div style="font-size:10px;color:var(--text3)">/100</div>
          <!-- Barre de score -->
          <div style="width:80px;background:var(--bg);border-radius:99px;height:5px;margin-top:4px">
            <div style="width:${d.score}%;height:5px;border-radius:99px;background:${scoreColor(d.score)};transition:width 0.8s"></div>
          </div>
        </div>
      </div>
    `).join('');
  },

  async showDetail(driverId) {
    try {
      const from = document.getElementById('score-from')?.value;
      const to   = document.getElementById('score-to')?.value;
      const data = await API.getDriverScore(driverId, from, to);
      if (!data) { Toast.show('Pas assez de données pour ce conducteur','warning'); return; }
      const cats = Object.values(data.details);
      Modals.open(
        `<i class="ti ti-steering-wheel" style="color:var(--blue)"></i> Score détaillé — Conducteur #${driverId}`,
        `<div style="text-align:center;margin-bottom:20px">
          <div style="font-size:56px;font-weight:800;font-family:var(--mono);color:${scoreColor(data.scoreGlobal)};line-height:1">${data.scoreGlobal}</div>
          <div style="font-size:16px;font-weight:700;color:${scoreColor(data.scoreGlobal)}">Mention ${data.grade}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:4px">${data.stats.tripCount} trajets · ${fmtKm(data.stats.totalKm)} · ${data.stats.totalHours}h de conduite</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${cats.map(c=>`
            <div>
              <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;margin-bottom:4px">
                <span style="color:var(--text2)">${c.label}</span>
                <span style="color:${scoreColor(c.score)}">${c.score}/100 · ${c.poids}%</span>
              </div>
              <div style="background:var(--bg);border-radius:99px;height:7px">
                <div style="width:${c.score}%;height:7px;border-radius:99px;background:${scoreColor(c.score)};transition:width 0.8s"></div>
              </div>
            </div>
          `).join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:16px">
          <div style="background:var(--red-lt);border-radius:8px;padding:10px;text-align:center"><div style="font-size:18px;font-weight:800;color:var(--red)">${data.stats.harshBrakes}</div><div style="font-size:10px;color:var(--red)">Freinages brusques</div></div>
          <div style="background:var(--amber-lt);border-radius:8px;padding:10px;text-align:center"><div style="font-size:18px;font-weight:800;color:var(--amber)">${data.stats.overSpeeds}</div><div style="font-size:10px;color:var(--amber)">Excès de vitesse</div></div>
          <div style="background:var(--blue-lt);border-radius:8px;padding:10px;text-align:center"><div style="font-size:18px;font-weight:800;color:var(--blue)">${data.stats.maxSpeed}</div><div style="font-size:10px;color:var(--blue)">km/h max</div></div>
        </div>`,
        `<button class="btn-secondary" onclick="Modals.close()">Fermer</button>`
      );
    } catch(e) { Toast.show('Erreur: '+e.message,'error'); }
  }
};

function scoreColor(s) {
  if (s >= 90) return 'var(--green)';
  if (s >= 75) return 'var(--blue)';
  if (s >= 60) return 'var(--amber)';
  return 'var(--red)';
}

/* ─── IMMOBILISATION AUTO (gestion live) ──────────────────────────── */
Pages.autoImmoLive = {
  async init() {
    if (!document.getElementById('page-auto-immo-live')) {
      const div = document.createElement('div');
      div.id = 'page-auto-immo-live';
      div.className = 'page';
      div.innerHTML = `
        <div class="page-header">
          <div><div class="page-title-h">Gestion des recettes</div><div class="page-subtitle">Validation et prorogations — immobilisation automatique</div></div>
        </div>
        <div class="card-list" id="auto-immo-list"></div>
      `;
      document.querySelector('.pages-container').appendChild(div);
    }
    await this.load();
  },

  async load() {
    const list = document.getElementById('auto-immo-list');
    if(list) list.innerHTML = '<div class="loading-state"><i class="ti ti-loader"></i></div>';
    try {
      const items = await API.getAutoImmo();
      if (!list) return;
      if (!items.length) { list.innerHTML='<div class="empty-state"><i class="ti ti-check-circle"></i>Aucune recette en attente — tout est à jour !</div>'; return; }
      const statusColors = { pending:'amber', validated:'green', immobilized:'red', extended:'blue' };
      const statusLabels = { pending:'En attente', validated:'Validé', immobilized:'Immobilisé', extended:'Prorogé' };
      list.innerHTML = items.map(item => `
        <div class="fleet-card" style="${item.status==='immobilized'?'border-color:var(--red);background:var(--red-lt)':''}">
          <div class="fc-avatar">${item.status==='immobilized'?'🚫':item.status==='validated'?'✅':item.status==='extended'?'⏳':'💰'}</div>
          <div class="fc-body">
            <div class="fc-name">${item.brand} ${item.model} — <span class="mono">${item.plate}</span></div>
            <div class="fc-sub">Conducteur: ${item.driver_name||'—'} · ${item.driver_phone||'—'}</div>
            <div class="fc-tags">
              <span class="fc-tag ${statusColors[item.status]||'gray'}">${statusLabels[item.status]||item.status}</span>
              <span class="fc-tag">Recette du ${fmtDay(item.date)}</span>
              ${item.extended_until?`<span class="fc-tag blue">Prorogé jusqu'à ${fmtTime(item.extended_until)}</span>`:''}
              ${item.granted_by_name?`<span class="fc-tag">par ${item.granted_by_name}</span>`:''}
            </div>
          </div>
          <div class="fc-actions" style="flex-direction:column;gap:6px">
            ${item.status==='pending'||item.status==='immobilized'?`
              <button class="btn-success" onclick="Pages.autoImmoLive.validate(${item.id})" style="font-size:11px;padding:5px 10px">
                <i class="ti ti-check"></i> Valider recette
              </button>
              <button class="btn-sm blue" onclick="Pages.autoImmoLive.extend(${item.id})" style="font-size:11px;justify-content:center">
                <i class="ti ti-clock"></i> Prorogation
              </button>
            `:''}
          </div>
        </div>
      `).join('');
    } catch(e) {
      if(list) list.innerHTML = `<div class="empty-state"><i class="ti ti-alert-circle"></i>${e.message}</div>`;
    }
  },

  async validate(id) {
    if (!confirm('Confirmer la réception de la recette ? Le véhicule sera réactivé si immobilisé.')) return;
    try {
      await API.validateAutoImmo(id);
      await this.load();
      Toast.show('Recette validée — véhicule réactivé','success');
    } catch(e) { Toast.show('Erreur: '+e.message,'error'); }
  },

  extend(id) {
    const now = new Date();
    const defaultUntil = new Date(now.getTime() + 2*3600000).toTimeString().slice(0,5);
    Modals.open(
      '<i class="ti ti-clock" style="color:var(--amber)"></i> Accorder une prorogation',
      `<p style="font-size:13px;color:var(--text2);margin-bottom:16px">Le conducteur pourra circuler jusqu'à l'heure indiquée. Assurez-vous d'avoir un accord de paiement avant de valider.</p>
      <div class="form-group">
        <label>Heure limite de prorogation</label>
        <input type="time" id="extend-until" class="form-input" value="${defaultUntil}" style="font-size:18px;font-family:var(--mono)">
      </div>`,
      `<button class="btn-secondary" onclick="Modals.close()">Annuler</button>
       <button class="btn-amber" onclick="Pages.autoImmoLive.confirmExtend(${id})"><i class="ti ti-check"></i> Accorder la prorogation</button>`
    );
  },

  async confirmExtend(id) {
    const timeVal = document.getElementById('extend-until')?.value;
    if (!timeVal) { Toast.show('Heure requise','warning'); return; }
    const [h,m] = timeVal.split(':');
    const until = new Date();
    until.setHours(parseInt(h), parseInt(m), 0, 0);
    try {
      await API.extendAutoImmo(id, until.toISOString());
      Modals.close();
      await this.load();
      Toast.show(`Prorogation accordée jusqu'à ${timeVal}`,'success');
    } catch(e) { Toast.show('Erreur: '+e.message,'error'); }
  }
};

/* ─── ANALYTICS ──────────────────────────────────────────────────── */
Pages.analytics = {
  charts: {},

  async init() {
    if (!document.getElementById('page-analytics')) {
      const div = document.createElement('div');
      div.id = 'page-analytics';
      div.className = 'page';
      div.innerHTML = `
        <div class="page-header">
          <div><div class="page-title-h">Analytique & Rapports</div><div class="page-subtitle">KPIs flotte, graphiques tendances, exports</div></div>
          <div class="page-actions">
            <input type="date" id="an-from" class="form-input" style="width:140px">
            <input type="date" id="an-to"   class="form-input" style="width:140px">
            <button class="btn-primary" onclick="Pages.analytics.load()"><i class="ti ti-refresh"></i> Actualiser</button>
          </div>
        </div>
        <div style="flex:1;overflow-y:auto;padding:0 24px 24px">
          <!-- KPIs -->
          <div id="an-kpis" style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px"></div>
          <!-- Graphiques -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow)">
              <div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:12px">Distance journalière (km)</div>
              <canvas id="chart-distance" height="180"></canvas>
            </div>
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow)">
              <div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:12px">Revenus journaliers (FCFA)</div>
              <canvas id="chart-revenue" height="180"></canvas>
            </div>
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow)">
              <div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:12px">Alertes par type</div>
              <canvas id="chart-alerts" height="180"></canvas>
            </div>
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow)">
              <div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:12px">Score conducteur moyen</div>
              <canvas id="chart-score" height="180"></canvas>
            </div>
          </div>
          <!-- Exports -->
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow)">
            <div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:14px">Exporter les données</div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button class="btn-secondary" onclick="Pages.analytics.exportPDF('trips')"><i class="ti ti-file-type-pdf"></i> Rapport Trajets PDF</button>
              <button class="btn-secondary" onclick="Pages.analytics.exportCSV('trips')"><i class="ti ti-file-type-csv"></i> Trajets Excel/CSV</button>
              <button class="btn-secondary" onclick="Pages.analytics.exportPDF('revenues')"><i class="ti ti-file-type-pdf"></i> Rapport Revenus PDF</button>
              <button class="btn-secondary" onclick="Pages.analytics.exportCSV('revenues')"><i class="ti ti-file-type-csv"></i> Revenus Excel/CSV</button>
              <button class="btn-secondary" onclick="Pages.analytics.exportPDF('scores')"><i class="ti ti-file-type-pdf"></i> Rapport Scores PDF</button>
            </div>
          </div>
        </div>
      `;
      document.querySelector('.pages-container').appendChild(div);
    }
    const to   = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now()-30*86400000).toISOString().split('T')[0];
    const f = document.getElementById('an-from'); if(f&&!f.value) f.value=from;
    const t = document.getElementById('an-to');   if(t&&!t.value) t.value=to;

    // Charger Chart.js dynamiquement
    if (!window.Chart) await loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js');
    await this.load();
  },

  async load() {
    const from = document.getElementById('an-from')?.value;
    const to   = document.getElementById('an-to')?.value;
    try {
      const [stats, trips, revenues, events, scores] = await Promise.all([
        API.getDashboardStats().catch(()=>({})),
        API.getTrips({ from: from+'T00:00:00', to: to+'T23:59:59' }).catch(()=>({trips:[]})),
        API.getRevenues({ from, to }).catch(()=>({revenues:[]})),
        API.getEvents(true).catch(()=>[]),
        API.getDriverScores(from, to).catch(()=>({ranking:[]})),
      ]);
      this.renderKPIs(stats, trips.trips||[], revenues.revenues||[]);
      this.renderCharts(trips.trips||[], revenues.revenues||[], events, scores.ranking||[]);
    } catch(e) { Toast.show('Erreur analytics: '+e.message,'error'); }
  },

  renderKPIs(stats, trips, revenues) {
    const el = document.getElementById('an-kpis'); if(!el) return;
    const totalKm  = trips.reduce((s,t)=>s+(t.distance||0),0);
    const totalRev = revenues.reduce((s,r)=>s+(Number(r.amount)||0),0);
    const avgScore = scores => scores.length ? Math.round(scores.reduce((s,d)=>s+(d.score||0),0)/scores.length) : 0;
    el.innerHTML = [
      {val: trips.length, lbl:'Trajets', color:'var(--blue)'},
      {val: Math.round(totalKm)+'km', lbl:'Distance totale', color:'var(--blue)'},
      {val: fmtFCFA(totalRev), lbl:'Revenus période', color:'var(--green)', small:true},
      {val: stats.alerts||0, lbl:'Alertes actives', color:'var(--red)'},
      {val: stats.immobilized||0, lbl:'Immobilisés', color:'var(--amber)'},
    ].map(k=>`
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;box-shadow:var(--shadow)">
        <div style="font-size:${k.small?'14px':'22px'};font-weight:800;color:${k.color};letter-spacing:-0.5px">${k.val}</div>
        <div style="font-size:11px;color:var(--text3);font-weight:600;margin-top:3px">${k.lbl}</div>
      </div>`).join('');
  },

  renderCharts(trips, revenues, events, scores) {
    // Grouper par jour
    const byDay = {};
    trips.forEach(t => {
      const d = (t.start_time||'').slice(0,10);
      if (!byDay[d]) byDay[d] = {km:0,trips:0};
      byDay[d].km += (t.distance||0); byDay[d].trips++;
    });
    const revByDay = {};
    revenues.forEach(r => {
      revByDay[r.date] = (revByDay[r.date]||0) + Number(r.amount||0);
    });

    const days = [...new Set([...Object.keys(byDay),...Object.keys(revByDay)])].sort().slice(-30);
    const labels = days.map(d => new Date(d).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}));

    const chartDefaults = {
      plugins:{ legend:{ display:false } },
      scales:{ x:{ grid:{display:false}, ticks:{font:{size:10}} }, y:{ grid:{color:'rgba(0,0,0,0.04)'}, ticks:{font:{size:10}} } },
      responsive:true, maintainAspectRatio:false,
    };

    this.drawChart('chart-distance','bar',labels,
      days.map(d=>Math.round((byDay[d]?.km||0)/1000*10)/10),
      '#1E6FD9','rgba(30,111,217,0.1)', chartDefaults);

    this.drawChart('chart-revenue','line',labels,
      days.map(d=>revByDay[d]||0),
      '#16A34A','rgba(22,163,74,0.1)', chartDefaults);

    // Alertes par type
    const alertTypes = {};
    events.forEach(e=>{ alertTypes[alertLabel(e.event_type)]=(alertTypes[alertLabel(e.event_type)]||0)+1; });
    const aLabels = Object.keys(alertTypes);
    const aColors = ['#1E6FD9','#D97706','#DC2626','#7C3AED','#0891B2'];
    this.drawPieChart('chart-alerts', aLabels, Object.values(alertTypes), aColors);

    // Score moyen par conducteur (bar)
    const top8 = scores.slice(0,8);
    this.drawChart('chart-score','bar',
      top8.map(d=>d.name.split(' ')[0]),
      top8.map(d=>d.score||0),
      top8.map(d=>d.score>=90?'#16A34A':d.score>=75?'#1E6FD9':d.score>=60?'#D97706':'#DC2626'),
      null, {...chartDefaults, scales:{...chartDefaults.scales, y:{...chartDefaults.scales.y, min:0,max:100}}});
  },

  drawChart(id, type, labels, data, color, bg, options={}) {
    const canvas = document.getElementById(id); if(!canvas) return;
    if (this.charts[id]) this.charts[id].destroy();
    this.charts[id] = new Chart(canvas, {
      type,
      data: {
        labels,
        datasets:[{ data, backgroundColor: Array.isArray(color)?color:bg||color, borderColor:Array.isArray(color)?color:color, borderWidth:2, borderRadius:4, tension:0.4, fill:!!bg, pointRadius:2 }]
      },
      options,
    });
  },

  drawPieChart(id, labels, data, colors) {
    const canvas = document.getElementById(id); if(!canvas) return;
    if (this.charts[id]) this.charts[id].destroy();
    this.charts[id] = new Chart(canvas, {
      type:'doughnut',
      data:{ labels, datasets:[{ data, backgroundColor:colors, borderWidth:2 }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'right', labels:{ font:{size:10} } } } },
    });
  },

  exportPDF(type) {
    const from = document.getElementById('an-from')?.value;
    const to   = document.getElementById('an-to')?.value;
    const params = new URLSearchParams({ from:from+'T00:00:00', to:to+'T23:59:59' });
    window.open(`/api/export/${type}/pdf?${params}`, '_blank');
  },

  exportCSV(type) {
    const from = document.getElementById('an-from')?.value;
    const to   = document.getElementById('an-to')?.value;
    const params = new URLSearchParams({ from:from+'T00:00:00', to:to+'T23:59:59' });
    window.location.href = `/api/export/${type}/csv?${params}`;
    Toast.show('Téléchargement en cours...','info');
  },
};

/* ─── OPTIMISATION ITINÉRAIRES ──────────────────────────────────────── */
Pages.routeOptimizer = {
  routeMap: null, routeLayer: null, stops: [],

  async init() {
    if (!document.getElementById('page-route-optimizer')) {
      const div = document.createElement('div');
      div.id = 'page-route-optimizer';
      div.className = 'page';
      div.innerHTML = `
        <div class="page-header">
          <div><div class="page-title-h">Optimisation d'itinéraires</div><div class="page-subtitle">Planifier et optimiser les trajets de la flotte</div></div>
        </div>
        <div style="flex:1;display:flex;gap:16px;padding:0 24px 24px;min-height:0;overflow:hidden">
          <!-- Panneau gauche -->
          <div style="width:300px;display:flex;flex-direction:column;gap:12px;overflow-y:auto;flex-shrink:0">
            <!-- Route A→B -->
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow)">
              <div style="font-size:13px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:7px"><i class="ti ti-route" style="color:var(--blue)"></i>Route A → B</div>
              <div class="form-group"><label>Départ (lat,lon)</label><input id="route-from" class="form-input mono" placeholder="5.3545,-4.0078"></div>
              <div class="form-group" style="margin-top:8px"><label>Arrivée (lat,lon)</label><input id="route-to" class="form-input mono" placeholder="5.3600,-4.0200"></div>
              <button class="btn-primary full-width" style="margin-top:10px" onclick="Pages.routeOptimizer.calcRoute()"><i class="ti ti-navigation"></i> Calculer</button>
              <div id="route-result" style="margin-top:10px;font-size:12px;color:var(--text3)"></div>
            </div>
            <!-- Tournée multi-stops -->
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow)">
              <div style="font-size:13px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:7px"><i class="ti ti-dots-circle-horizontal" style="color:var(--purple)"></i>Tournée multi-stops</div>
              <div class="form-group"><label>Dépôt (lat,lon)</label><input id="depot-coords" class="form-input mono" placeholder="5.3545,-4.0078"></div>
              <div id="stops-list" style="display:flex;flex-direction:column;gap:6px;margin:10px 0"></div>
              <button class="btn-secondary full-width" onclick="Pages.routeOptimizer.addStop()"><i class="ti ti-plus"></i> Ajouter un arrêt</button>
              <button class="btn-primary full-width" style="margin-top:8px" onclick="Pages.routeOptimizer.optimizeTour()"><i class="ti ti-route"></i> Optimiser la tournée</button>
              <div id="tour-result" style="margin-top:10px;font-size:12px;color:var(--text3)"></div>
            </div>
            <!-- Véhicules -->
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow)">
              <div style="font-size:13px;font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:7px"><i class="ti ti-car" style="color:var(--green)"></i>Véhicules en ligne</div>
              <div id="online-vehicles-list" style="font-size:12px;color:var(--text3)">Chargement...</div>
            </div>
          </div>
          <!-- Carte -->
          <div style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow)">
            <div id="route-map" style="width:100%;height:100%"></div>
          </div>
        </div>
      `;
      document.querySelector('.pages-container').appendChild(div);
    }
    this.initMap();
    await this.loadOnlineVehicles();
  },

  initMap() {
    if (this.routeMap) { this.routeMap.invalidateSize(); return; }
    const el = document.getElementById('route-map'); if(!el) return;
    this.routeMap = L.map('route-map',{center:[5.354,-4.007],zoom:12});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap'}).addTo(this.routeMap);
    this.routeLayer = L.featureGroup().addTo(this.routeMap);
    // Clic sur la carte = ajouter coordonnées
    this.routeMap.on('click', e => {
      const coords = `${e.latlng.lat.toFixed(6)},${e.latlng.lng.toFixed(6)}`;
      Toast.show(`Coordonnées: ${coords} (copiées dans le presse-papier)`, 'info', 2000);
      navigator.clipboard?.writeText(coords).catch(()=>{});
    });
  },

  async calcRoute() {
    const fromStr = document.getElementById('route-from')?.value;
    const toStr   = document.getElementById('route-to')?.value;
    if (!fromStr||!toStr) { Toast.show('Coordonnées requises','warning'); return; }
    const [fromLat,fromLon] = fromStr.split(',').map(Number);
    const [toLat,toLon]     = toStr.split(',').map(Number);
    if (!fromLat||!toLat) { Toast.show('Format invalide: lat,lon','warning'); return; }

    Toast.show('Calcul en cours...','info',1500);
    try {
      const r = await fetch('/api/route', {
        method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${localStorage.getItem('oros_token')}`},
        body: JSON.stringify({fromLat,fromLon,toLat,toLon,alternatives:true})
      }).then(r=>r.json());

      this.routeLayer.clearLayers();

      const colors = ['#1E6FD9','#7C3AED','#D97706'];
      r.routes.forEach((route,i) => {
        if (route.geometry) {
          const coords = route.geometry.coordinates.map(c=>[c[1],c[0]]);
          L.polyline(coords,{color:colors[i]||'#888',weight:i===0?5:3,opacity:i===0?0.9:0.5,dashArray:i===0?null:'8,5'})
           .addTo(this.routeLayer)
           .bindTooltip(`Option ${i+1}: ${route.distanceKm}km · ${route.durationMin}min`);
        }
      });

      // Marqueurs départ/arrivée
      L.marker([fromLat,fromLon]).addTo(this.routeLayer).bindTooltip('Départ',{permanent:true});
      L.marker([toLat,toLon]).addTo(this.routeLayer).bindTooltip('Arrivée',{permanent:true});
      if(this.routeLayer.getBounds().isValid()) this.routeMap.fitBounds(this.routeLayer.getBounds().pad(0.1));

      const best = r.routes[0];
      document.getElementById('route-result').innerHTML = `
        <div style="background:var(--blue-lt);border-radius:7px;padding:10px">
          <div style="font-weight:700;color:var(--blue)">${best.distanceKm} km · ${best.durationMin} min</div>
          <div>ETA: ${new Date(best.eta).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div>
          ${r.routes.length>1?`<div style="color:var(--text3);margin-top:4px">${r.routes.length} alternatives disponibles</div>`:''}
        </div>`;
    } catch(e) { Toast.show('Erreur: '+e.message,'error'); }
  },

  stopCount: 0,
  addStop() {
    this.stopCount++;
    const id = `stop-${this.stopCount}`;
    const div = document.createElement('div');
    div.id = id;
    div.style.cssText = 'display:flex;gap:6px;align-items:center';
    div.innerHTML = `
      <input class="form-input mono" placeholder="lat,lon" style="flex:1;font-size:11px" data-stop="${id}">
      <input class="form-input" placeholder="Nom" style="width:80px;font-size:11px" data-name="${id}">
      <button class="btn-sm danger" onclick="document.getElementById('${id}').remove()" style="padding:5px"><i class="ti ti-x"></i></button>`;
    document.getElementById('stops-list').appendChild(div);
  },

  async optimizeTour() {
    const depotStr = document.getElementById('depot-coords')?.value;
    if (!depotStr) { Toast.show('Dépôt requis','warning'); return; }
    const [dLat,dLon] = depotStr.split(',').map(Number);
    const depot = {lat:dLat, lon:dLon, name:'Dépôt'};

    const stopEls = document.querySelectorAll('[data-stop]');
    const stops = [];
    stopEls.forEach(el => {
      const [lat,lon] = (el.value||'').split(',').map(Number);
      if(lat&&lon) stops.push({lat,lon,name:document.querySelector(`[data-name="${el.dataset.stop}"]`)?.value||`Arrêt ${stops.length+1}`});
    });
    if (stops.length < 2) { Toast.show('Au moins 2 arrêts requis','warning'); return; }

    Toast.show(`Optimisation de ${stops.length} arrêts...`,'info',2000);
    try {
      const r = await fetch('/api/route/optimize', {
        method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${localStorage.getItem('oros_token')}`},
        body: JSON.stringify({depot,stops})
      }).then(r=>r.json());

      this.routeLayer.clearLayers();
      r.routes?.forEach((seg,i) => {
        if(seg.geometry) {
          const coords = seg.geometry.coordinates.map(c=>[c[1],c[0]]);
          L.polyline(coords,{color:'#7C3AED',weight:4,opacity:0.8}).addTo(this.routeLayer);
        }
      });
      // Marqueurs arrêts
      r.order?.forEach((s,i) => {
        L.circleMarker([s.lat,s.lon],{radius:9,color:'#7C3AED',fillColor:'#7C3AED',fillOpacity:1})
         .addTo(this.routeLayer).bindTooltip(`${i+1}. ${s.name}`,{permanent:true,direction:'top'});
      });
      L.marker([depot.lat,depot.lon]).addTo(this.routeLayer).bindTooltip('🏁 Dépôt',{permanent:true});
      if(this.routeLayer.getBounds().isValid()) this.routeMap.fitBounds(this.routeLayer.getBounds().pad(0.1));

      document.getElementById('tour-result').innerHTML = `
        <div style="background:rgba(124,58,237,0.1);border-radius:7px;padding:10px">
          <div style="font-weight:700;color:var(--purple)">Tournée optimisée</div>
          <div>${stops.length} arrêts · ${r.totalKm}km · ${r.totalMin}min</div>
          <div style="margin-top:6px;font-size:11px">${r.order?.map((s,i)=>`${i+1}. ${s.name}`).join(' → ')}</div>
        </div>`;
    } catch(e) { Toast.show('Erreur: '+e.message,'error'); }
  },

  async loadOnlineVehicles() {
    const el = document.getElementById('online-vehicles-list'); if(!el) return;
    try {
      const devs = await API.getDevices();
      const online = devs.filter(d=>d.status==='online'&&d.lat);
      if(!online.length){el.textContent='Aucun véhicule en ligne'; return;}
      el.innerHTML = online.map(d=>`
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer"
             onclick="Pages.routeOptimizer.setFromVehicle(${d.lat},${d.lon},'${d.name||d.imei}')">
          <div style="width:7px;height:7px;border-radius:50%;background:var(--green);flex-shrink:0"></div>
          <div style="flex:1"><div style="font-size:12px;font-weight:600">${d.name||d.imei}</div><div style="font-size:10px;color:var(--text3)">${d.plate||''} · ${d.speed||0}km/h</div></div>
          <i class="ti ti-target" style="color:var(--blue);font-size:14px"></i>
        </div>`).join('');
    } catch(e) { el.textContent = 'Erreur de chargement'; }
  },

  setFromVehicle(lat, lon, name) {
    const el = document.getElementById('route-from');
    if(el) el.value = `${lat},${lon}`;
    Toast.show(`Départ: ${name}`,'info',1500);
  }
};

// Utilitaire: charger un script externe dynamiquement
function loadScript(src) {
  return new Promise((resolve,reject) => {
    if(document.querySelector(`script[src="${src}"]`)){resolve();return;}
    const s=document.createElement('script'); s.src=src; s.onload=resolve; s.onerror=reject;
    document.head.appendChild(s);
  });
}

/* ─── IMMOBILISATION MANUELLE ──────────────────────────────────────── */
Pages.immobilization = {

  async init() {
    if (!document.getElementById('page-immobilization')) {
      const div = document.createElement('div');
      div.id = 'page-immobilization';
      div.className = 'page';
      div.innerHTML = `
        <div class="page-header">
          <div>
            <div class="page-title-h" style="display:flex;align-items:center;gap:10px">
              Immobilisation à distance
              <span style="font-size:11px;font-weight:500;background:var(--red-lt);color:var(--red);padding:3px 10px;border-radius:99px;border:0.5px solid rgba(220,38,38,0.2)">Commandes directes</span>
            </div>
            <div class="page-subtitle">Couper ou réactiver le moteur de n'importe quel véhicule en temps réel</div>
          </div>
          <div class="page-actions">
            <button class="btn-secondary" onclick="Pages.immobilization.load()"><i class="ti ti-refresh"></i> Actualiser</button>
          </div>
        </div>

        <!-- Avertissement -->
        <div style="margin:0 24px 14px;background:var(--amber-lt);border:1px solid rgba(217,119,6,0.25);border-radius:var(--radius);padding:12px 16px;display:flex;align-items:flex-start;gap:10px;flex-shrink:0">
          <i class="ti ti-alert-triangle" style="color:var(--amber);font-size:20px;flex-shrink:0;margin-top:1px"></i>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--amber)">Commande irréversible jusqu'à réactivation</div>
            <div style="font-size:12px;color:var(--text2);margin-top:3px">L'immobilisation coupe le relais moteur du traceur. Le véhicule ne peut plus redémarrer jusqu'à l'envoi de la commande de réactivation. Assurez-vous que le véhicule est à l'arrêt.</div>
          </div>
        </div>

        <!-- Barre de filtre -->
        <div class="page-toolbar" style="padding:0 24px 12px">
          <input type="text" class="search-input" placeholder="Rechercher véhicule, plaque, conducteur..." oninput="Pages.immobilization.filter(this.value)" style="max-width:320px">
          <div class="filter-chips">
            <button class="chip active" onclick="Pages.immobilization.filterStatus(null,this)">Tous</button>
            <button class="chip" onclick="Pages.immobilization.filterStatus('online',this)">En ligne</button>
            <button class="chip" onclick="Pages.immobilization.filterStatus('immobilized',this)">Immobilisés</button>
          </div>
          <div style="margin-left:auto;font-size:12px;color:var(--text3)" id="immo-connected-count"></div>
        </div>

        <!-- Liste des véhicules -->
        <div style="flex:1;overflow-y:auto;padding:0 24px 24px;display:flex;flex-direction:column;gap:10px" id="immo-list">
          <div class="loading-state"><i class="ti ti-loader"></i></div>
        </div>

        <!-- Journal des commandes -->
        <div style="margin:0 24px 24px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);flex-shrink:0">
          <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
            <div style="font-size:12px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em">Journal des commandes récentes</div>
            <button class="btn-sm" onclick="Pages.immobilization.loadLog()"><i class="ti ti-refresh"></i> Actualiser</button>
          </div>
          <div id="immo-log" style="max-height:160px;overflow-y:auto">
            <div class="loading-state" style="padding:20px"><i class="ti ti-loader"></i></div>
          </div>
        </div>
      `;
      document.querySelector('.pages-container').appendChild(div);
    }
    await this.load();
    await this.loadLog();
  },

  all: [], filtered: [], statusFilter: null, searchTerm: '',

  async load() {
    const list = document.getElementById('immo-list');
    if (list) list.innerHTML = '<div class="loading-state"><i class="ti ti-loader"></i></div>';
    try {
      this.all = await API.getDevices();
      this.applyFilters();
      // Compter les connectés
      const connected = this.all.filter(d => d.status === 'online' || d.status === 'immobilized').length;
      const el = document.getElementById('immo-connected-count');
      if (el) el.textContent = `${connected} traceur(s) actuellement connecté(s)`;
    } catch(e) {
      if (list) list.innerHTML = '<div class="empty-state"><i class="ti ti-alert-circle"></i>Erreur de chargement</div>';
    }
  },

  applyFilters() {
    this.filtered = this.all.filter(d => {
      const ms = !this.searchTerm ||
        (d.name||'').toLowerCase().includes(this.searchTerm) ||
        (d.plate||'').toLowerCase().includes(this.searchTerm) ||
        (d.driver_name||'').toLowerCase().includes(this.searchTerm) ||
        d.imei.includes(this.searchTerm);
      const mf = !this.statusFilter || d.status === this.statusFilter;
      return ms && mf;
    });
    this.render();
  },

  filter(term) { this.searchTerm = term.toLowerCase(); this.applyFilters(); },
  filterStatus(s, el) {
    this.statusFilter = s;
    document.querySelectorAll('.filter-chips .chip').forEach(c => c.classList.remove('active'));
    el?.classList.add('active');
    this.applyFilters();
  },

  render() {
    const list = document.getElementById('immo-list');
    if (!list) return;
    if (!this.filtered.length) {
      list.innerHTML = '<div class="empty-state"><i class="ti ti-car-off"></i>Aucun véhicule trouvé</div>';
      return;
    }

    list.innerHTML = this.filtered.map(d => {
      const isImmob   = d.status === 'immobilized';
      const isOnline  = d.status === 'online';
      const isOffline = d.status === 'offline' || d.status === 'idle';
      const canSend   = isOnline || isImmob;

      return `
        <div style="background:var(--surface);border:1px solid ${isImmob?'var(--red)':isOnline?'rgba(22,163,74,0.3)':'var(--border)'};border-radius:var(--radius);padding:16px;display:flex;align-items:center;gap:14px;${isImmob?'background:var(--red-lt);':''}" id="immo-card-${d.id}">

          <!-- Statut -->
          <div style="width:10px;height:10px;border-radius:50%;background:${isImmob?'var(--red)':isOnline?'var(--green)':'var(--text3)'};flex-shrink:0;${isOnline?'box-shadow:0 0 0 3px rgba(22,163,74,0.2)':''}"></div>

          <!-- Icône véhicule -->
          <div style="width:44px;height:44px;border-radius:10px;background:${isImmob?'rgba(220,38,38,0.1)':'var(--bg)'};display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">${vehicleEmoji(d.vtype)}</div>

          <!-- Infos -->
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <div style="font-size:14px;font-weight:700">${d.name||d.imei}</div>
              ${isImmob ? '<span style="font-size:10px;font-weight:700;background:var(--red);color:#fff;padding:2px 8px;border-radius:99px">IMMOBILISÉ</span>' : ''}
              ${isOnline && !isImmob ? '<span style="font-size:10px;font-weight:500;background:var(--green-lt);color:var(--green);padding:2px 8px;border-radius:99px">En ligne</span>' : ''}
              ${isOffline ? '<span style="font-size:10px;color:var(--text3);padding:2px 8px;border-radius:99px;border:0.5px solid var(--border)">Hors ligne</span>' : ''}
            </div>
            <div style="display:flex;gap:12px;flex-wrap:wrap">
              ${d.plate ? `<span style="font-size:12px;color:var(--blue);font-family:var(--mono);font-weight:600">${d.plate}</span>` : ''}
              ${d.driver_name ? `<span style="font-size:12px;color:var(--text2)"><i class="ti ti-user" style="font-size:12px"></i> ${d.driver_name}</span>` : ''}
              <span style="font-size:12px;color:var(--text3);font-family:var(--mono)">${d.protocol} :${d.port}</span>
              ${d.speed > 0 ? `<span style="font-size:12px;color:var(--amber);font-weight:600"><i class="ti ti-gauge" style="font-size:12px"></i> ${d.speed} km/h</span>` : ''}
              <span style="font-size:11px;color:var(--text3)">${fmtAgo(d.last_seen)}</span>
            </div>
          </div>

          <!-- Actions -->
          <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;min-width:160px">
            ${isImmob ? `
              <button onclick="Pages.immobilization.confirm(${d.id},'engine_restore','${d.name||d.imei}')" style="background:var(--green);color:#fff;border:none;border-radius:var(--radius-sm);padding:9px 14px;font-size:12px;font-weight:700;font-family:var(--font);cursor:pointer;display:flex;align-items:center;gap:6px;justify-content:center">
                <i class="ti ti-engine"></i> Réactiver le moteur
              </button>
            ` : `
              <button onclick="Pages.immobilization.confirm(${d.id},'engine_cut','${d.name||d.imei}')" ${!canSend?'disabled title="Traceur hors ligne"':''} style="background:${canSend?'var(--red)':'var(--border)'};color:${canSend?'#fff':'var(--text3)'};border:none;border-radius:var(--radius-sm);padding:9px 14px;font-size:12px;font-weight:700;font-family:var(--font);cursor:${canSend?'pointer':'not-allowed'};display:flex;align-items:center;gap:6px;justify-content:center">
                <i class="ti ti-engine-off"></i> Immobiliser
              </button>
            `}
            <div style="display:flex;gap:5px">
              <button onclick="Pages.immobilization.sendCmd(${d.id},'get_location','${d.name||d.imei}')" ${!canSend?'disabled':''} style="flex:1;padding:6px;border:0.5px solid var(--border2);border-radius:var(--radius-sm);background:none;color:var(--text2);font-size:11px;cursor:${canSend?'pointer':'not-allowed'};font-family:var(--font);display:flex;align-items:center;justify-content:center;gap:4px">
                <i class="ti ti-map-pin"></i> Position
              </button>
              <button onclick="Pages.immobilization.showHistory(${d.id})" style="flex:1;padding:6px;border:0.5px solid var(--border2);border-radius:var(--radius-sm);background:none;color:var(--text2);font-size:11px;cursor:pointer;font-family:var(--font);display:flex;align-items:center;justify-content:center;gap:4px">
                <i class="ti ti-history"></i> Log
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  confirm(deviceId, command, deviceName) {
    const isCut = command === 'engine_cut';
    Modals.open(
      `<i class="ti ti-engine-off" style="color:${isCut?'var(--red)':'var(--green)'}"></i> ${isCut?'Immobiliser':'Réactiver'} — ${deviceName}`,
      `<div style="text-align:center;padding:8px 0">
        <div style="font-size:48px;margin-bottom:12px">${isCut?'🔴':'🟢'}</div>
        <div style="font-size:17px;font-weight:700;color:${isCut?'var(--red)':'var(--green)'};margin-bottom:8px">${isCut?'Couper le moteur':'Réactiver le moteur'}</div>
        <div style="font-size:13px;font-weight:700;background:var(--bg);border-radius:8px;padding:8px 16px;display:inline-block;margin-bottom:14px">${deviceName}</div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:16px">
          ${isCut
            ? 'La commande ENGINE CUT sera envoyée au traceur via TCP. Le relais moteur sera coupé — le véhicule ne pourra plus démarrer.'
            : 'La commande ENGINE RESTORE sera envoyée. Le relais moteur sera réactivé — le conducteur pourra redémarrer.'}
        </div>
        <div class="form-group" style="text-align:left">
          <label>Motif (optionnel)</label>
          <input id="cmd-reason" class="form-input" placeholder="${isCut?'Recette impayée, non conformité...':'Régularisation effectuée...'}">
        </div>
      </div>`,
      `<button class="btn-secondary" onclick="Modals.close()">Annuler</button>
       <button style="background:${isCut?'var(--red)':'var(--green)'};color:#fff;border:none;border-radius:6px;padding:9px 20px;font-size:13px;font-weight:700;font-family:var(--font);cursor:pointer" onclick="Pages.immobilization.sendCmd(${deviceId},'${command}','${deviceName}')">
         <i class="ti ti-send"></i> Envoyer la commande
       </button>`
    );
  },

  async sendCmd(deviceId, command, deviceName) {
    Modals.close();
    const reason = document.getElementById('cmd-reason')?.value || null;

    // Feedback visuel immédiat
    const card = document.getElementById(`immo-card-${deviceId}`);
    if (card) {
      const btn = card.querySelector('button');
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader"></i> Envoi...'; }
    }

    try {
      const res = await API.sendCommand(deviceId, command, reason);
      const msg = res.tcpConnected
        ? `✓ Commande envoyée au traceur`
        : `⏳ Commande enregistrée — traceur non connecté`;
      Toast.show(msg, res.tcpConnected ? 'success' : 'warning', 4000);
      // Recharger pour refléter le nouveau statut
      await this.load();
      await this.loadLog();
    } catch(e) {
      Toast.show('Erreur : ' + e.message, 'error');
      await this.load();
    }
  },

  async loadLog() {
    const el = document.getElementById('immo-log');
    if (!el) return;
    try {
      const log = await API.getCommandLog();
      if (!log.length) {
        el.innerHTML = '<div style="padding:16px;text-align:center;font-size:12px;color:var(--text3)">Aucune commande envoyée</div>';
        return;
      }
      const cmdLabels = {
        engine_cut:     '🔴 Immobilisation',
        engine_restore: '🟢 Réactivation',
        get_location:   '📍 Demande position',
        reboot:         '🔄 Redémarrage',
        get_status:     '📊 Statut',
      };
      el.innerHTML = log.map(c => `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 16px;border-bottom:0.5px solid var(--border);font-size:12px">
          <span style="font-weight:600;flex:1">${cmdLabels[c.command]||c.command}</span>
          <span style="color:var(--text3)">${c.device_name||c.device_id}</span>
          <span style="color:var(--text3);font-family:var(--mono);font-size:10px">${c.plate||''}</span>
          <span style="color:var(--text3)">par ${c.sent_by_name||'—'}</span>
          ${c.executed ? '<span style="color:var(--green);font-size:10px">✓ Exécuté</span>' : '<span style="color:var(--amber);font-size:10px">⏳ En attente</span>'}
          <span style="color:var(--text3);font-size:10px;font-family:var(--mono)">${fmtTime(c.created_at)}</span>
        </div>
      `).join('');
    } catch(e) {
      el.innerHTML = '<div style="padding:16px;text-align:center;font-size:12px;color:var(--text3)">Erreur de chargement</div>';
    }
  },

  async showHistory(deviceId) {
    try {
      const log = await API.getCommandLog(deviceId);
      const cmdLabels = { engine_cut:'🔴 Immobilisation', engine_restore:'🟢 Réactivation', get_location:'📍 Position', reboot:'🔄 Redémarrage' };
      Modals.open(
        '<i class="ti ti-history" style="color:var(--blue)"></i> Historique des commandes',
        log.length ? log.map(c => `
          <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:0.5px solid var(--border);font-size:12px">
            <span style="flex:1;font-weight:600">${cmdLabels[c.command]||c.command}</span>
            ${c.reason ? `<span style="color:var(--text3)">${c.reason}</span>` : ''}
            <span style="color:var(--text3)">par ${c.sent_by_name||'—'}</span>
            ${c.executed ? '<span style="color:var(--green);font-size:11px;font-weight:600">✓ Confirmé</span>' : '<span style="color:var(--amber);font-size:11px">⏳</span>'}
            <span style="font-size:11px;color:var(--text3);font-family:var(--mono)">${fmtDate(c.created_at)}</span>
          </div>`).join('') : '<div style="text-align:center;color:var(--text3);padding:20px">Aucune commande</div>',
        '<button class="btn-secondary" onclick="Modals.close()">Fermer</button>'
      );
    } catch(e) { Toast.show('Erreur : ' + e.message, 'error'); }
  }
};

/* ═══════════════════════════════════════════════════════════
   CENTRE D'ALERTES IA — Page principale
═══════════════════════════════════════════════════════════ */
Pages.aiAlerts = {
  all: [], charts: {},

  async init() {
    if (!document.getElementById('page-ai-alerts')) {
      const div = document.createElement('div');
      div.id = 'page-ai-alerts';
      div.className = 'page';
      div.innerHTML = `
        <!-- HEADER -->
        <div class="page-header">
          <div>
            <div class="page-title-h" style="display:flex;align-items:center;gap:10px">
              Centre d'alertes IA
              <span id="alert-live-badge" style="display:flex;align-items:center;gap:5px;font-size:11px;font-weight:500;background:rgba(22,163,74,0.1);color:var(--green);padding:3px 10px;border-radius:99px;border:0.5px solid rgba(22,163,74,0.2)">
                <div style="width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 1.5s infinite"></div>Analyse IA active
              </span>
            </div>
            <div class="page-subtitle">Priorisation intelligente · Corrélation d'événements · Zéro bruit</div>
          </div>
          <div class="page-actions" style="gap:8px">
            <button class="btn-secondary" onclick="Pages.aiAlerts.load()"><i class="ti ti-refresh"></i> Actualiser</button>
            <button class="btn-secondary" onclick="Pages.aiAlerts.acknowledgeAll()"><i class="ti ti-checks"></i> Tout acquitter</button>
          </div>
        </div>

        <!-- KPIs ALERTES -->
        <div id="alert-kpis" style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;padding:0 24px 14px;flex-shrink:0"></div>

        <!-- CONTENU PRINCIPAL -->
        <div style="flex:1;display:grid;grid-template-columns:1fr 320px;gap:16px;padding:0 24px 24px;min-height:0;overflow:hidden">

          <!-- COLONNE GAUCHE : liste alertes -->
          <div style="display:flex;flex-direction:column;gap:12px;min-height:0;overflow:hidden">

            <!-- Filtres -->
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:0;box-shadow:var(--shadow)">
              <div class="filter-chips" id="alert-severity-filter">
                <button class="chip active" onclick="Pages.aiAlerts.filterSeverity(null,this)">Toutes</button>
                <button class="chip" style="border-color:rgba(220,38,38,0.3);color:var(--red)" onclick="Pages.aiAlerts.filterSeverity('critical',this)">🔴 Critiques</button>
                <button class="chip" style="border-color:rgba(234,88,12,0.3);color:#EA580C" onclick="Pages.aiAlerts.filterSeverity('high',this)">🟠 Hautes</button>
                <button class="chip" onclick="Pages.aiAlerts.filterSeverity('medium',this)">🟡 Moyennes</button>
                <button class="chip" onclick="Pages.aiAlerts.filterSeverity('low',this)">⚪ Basses</button>
              </div>
              <input type="text" class="search-input" placeholder="Rechercher véhicule, type..." oninput="Pages.aiAlerts.filterText(this.value)" style="max-width:220px;margin-left:auto">
            </div>

            <!-- Liste -->
            <div id="ai-alerts-list" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px">
              <div class="loading-state"><i class="ti ti-loader"></i></div>
            </div>
          </div>

          <!-- COLONNE DROITE : analytics -->
          <div style="display:flex;flex-direction:column;gap:12px;overflow-y:auto">

            <!-- Score de risque flotte -->
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow)">
              <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:12px">Score de risque flotte</div>
              <div style="text-align:center;margin-bottom:14px">
                <div style="font-size:48px;font-weight:800;font-family:var(--mono)" id="fleet-risk-score">—</div>
                <div style="font-size:12px;color:var(--text3)" id="fleet-risk-label">Calcul en cours...</div>
              </div>
              <canvas id="chart-trends" height="120"></canvas>
            </div>

            <!-- Top véhicules à risque -->
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow)">
              <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:12px">Véhicules à risque élevé</div>
              <div id="risk-vehicles-list"></div>
            </div>

            <!-- Répartition par type -->
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow)">
              <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:12px">Répartition par type</div>
              <canvas id="chart-types" height="180"></canvas>
            </div>

            <!-- Déduplication stats -->
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;box-shadow:var(--shadow)">
              <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:10px">IA Performance</div>
              <div style="display:flex;flex-direction:column;gap:7px" id="ai-perf-stats">
                <div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--text3)">Alertes supprimées (dédupe)</span><span style="font-weight:600;color:var(--green)" id="stat-deduped">—</span></div>
                <div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--text3)">Patterns détectés</span><span style="font-weight:600;color:var(--purple)" id="stat-patterns">—</span></div>
                <div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--text3)">Alertes escaladées</span><span style="font-weight:600;color:var(--red)" id="stat-escalated">—</span></div>
                <div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--text3)">Score moyen</span><span style="font-weight:600" id="stat-avg-score">—</span></div>
              </div>
            </div>
          </div>
        </div>
      `;
      document.querySelector('.pages-container').appendChild(div);
    }

    if (!window.Chart) await loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js');
    await this.load();

    // Auto-refresh toutes les 30 secondes
    if (!this._refreshTimer) {
      this._refreshTimer = setInterval(() => {
        if (App.currentPage === 'ai-alerts') this.load();
      }, 30000);
    }
  },

  severityFilter: null, textFilter: '',

  async load() {
    try {
      const [alerts, stats, trends, riskVehicles] = await Promise.all([
        API.getAIAlerts({ acknowledged: false }),
        API.getAIAlertStats(),
        API.getAIAlertTrends(7),
        API.getHighRiskVehicles(10),
      ]);
      this.all = alerts;
      this.renderKPIs(stats);
      this.applyFilters();
      this.renderTrendsChart(trends);
      this.renderRiskVehicles(riskVehicles);
      this.renderTypesChart(alerts);
      this.renderAIStats(stats);
    } catch(e) {
      const list = document.getElementById('ai-alerts-list');
      if (list) list.innerHTML = '<div class="empty-state"><i class="ti ti-bell-off"></i>Aucune alerte active</div>';
    }
  },

  renderKPIs(stats) {
    const el = document.getElementById('alert-kpis'); if(!el) return;
    const kpis = [
      { val: stats.total||0,      lbl:'Total actives',    color:'var(--text)',    bg:'var(--surface)' },
      { val: stats.critical||0,   lbl:'Critiques',        color:'var(--red)',     bg:'var(--red-lt)' },
      { val: stats.high||0,       lbl:'Hautes',           color:'#EA580C',        bg:'rgba(234,88,12,0.08)' },
      { val: stats.medium||0,     lbl:'Moyennes',         color:'var(--amber)',   bg:'var(--amber-lt)' },
      { val: stats.last_hour||0,  lbl:'Dernière heure',   color:'var(--blue)',    bg:'var(--blue-lt)' },
      { val: stats.sos_24h||0,    lbl:'SOS aujourd\'hui', color:'var(--red)',     bg:'var(--red-lt)' },
    ];
    el.innerHTML = kpis.map(k => `
      <div style="background:${k.bg};border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;box-shadow:var(--shadow)">
        <div style="font-size:22px;font-weight:800;color:${k.color};font-family:var(--mono)">${k.val}</div>
        <div style="font-size:10px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;margin-top:2px">${k.lbl}</div>
      </div>`).join('');

    // Score global flotte
    const avgScore = parseInt(stats.avg_score)||0;
    const scoreEl = document.getElementById('fleet-risk-score');
    const labelEl = document.getElementById('fleet-risk-label');
    if (scoreEl) { scoreEl.textContent = avgScore||'—'; scoreEl.style.color = riskColor(avgScore); }
    if (labelEl) labelEl.textContent = avgScore>=80?'⚠️ Flotte à risque':avgScore>=50?'Attention requise':'Flotte en bon état';
    // Badges sidebar
    const badge = document.getElementById('badge-alerts');
    const dot   = document.getElementById('notif-dot');
    if (badge) { badge.textContent = stats.total||0; badge.style.display = stats.total ? '' : 'none'; }
    if (dot)   dot.style.display = (stats.critical||0) > 0 ? '' : 'none';
  },

  applyFilters() {
    const filtered = this.all.filter(a => {
      const ms = !this.severityFilter || a.severity === this.severityFilter;
      const mt = !this.textFilter ||
        (a.label||'').toLowerCase().includes(this.textFilter) ||
        (a.plate||'').toLowerCase().includes(this.textFilter) ||
        (a.device_name||'').toLowerCase().includes(this.textFilter) ||
        (a.imei||'').includes(this.textFilter);
      return ms && mt;
    });
    this.renderList(filtered);
  },

  filterSeverity(s, el) {
    this.severityFilter = s;
    document.querySelectorAll('#alert-severity-filter .chip').forEach(c => c.classList.remove('active'));
    el?.classList.add('active');
    this.applyFilters();
  },

  filterText(v) { this.textFilter = v.toLowerCase(); this.applyFilters(); },

  renderList(items) {
    const list = document.getElementById('ai-alerts-list'); if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div class="empty-state"><i class="ti ti-bell-off"></i>Aucune alerte correspondant aux filtres</div>';
      return;
    }
    list.innerHTML = items.map(a => {
      const svColors = { critical:'var(--red)', high:'#EA580C', medium:'var(--amber)', low:'var(--text3)' };
      const svBg     = { critical:'var(--red-lt)', high:'rgba(234,88,12,0.08)', medium:'var(--amber-lt)', low:'var(--bg)' };
      const color    = a.color || svColors[a.severity] || 'var(--text3)';
      const bg       = svBg[a.severity] || 'var(--bg)';
      return `
        <div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid ${color};border-radius:var(--radius);padding:14px 16px;box-shadow:var(--shadow);display:flex;gap:12px;align-items:flex-start" id="al-card-${a.id}">
          <!-- Icône -->
          <div style="width:38px;height:38px;border-radius:9px;background:${bg};display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">${a.icon||'⚠️'}</div>
          <!-- Body -->
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
              <div style="font-size:13px;font-weight:700">${a.label||a.alert_type}</div>
              <!-- Score de risque IA -->
              <div style="display:flex;align-items:center;gap:4px;background:${bg};border-radius:99px;padding:2px 8px">
                <div style="width:5px;height:5px;border-radius:50%;background:${color}"></div>
                <span style="font-size:10px;font-weight:700;color:${color}">Risque ${a.risk_score||0}/100</span>
              </div>
              ${a.pattern_detected ? `<span style="font-size:10px;font-weight:600;background:rgba(124,58,237,0.1);color:var(--purple);padding:2px 8px;border-radius:99px">⚡ Pattern: ${a.pattern_detected}</span>` : ''}
            </div>
            <div style="font-size:12px;color:var(--text2);margin-bottom:4px">
              ${a.plate||a.device_name||a.imei}
              ${a.driver_name ? ` · ${a.driver_name}` : ''}
            </div>
            <div style="display:flex;gap:12px;flex-wrap:wrap">
              ${a.data?.speed ? `<span style="font-size:11px;color:var(--amber);font-weight:600">⚡ ${a.data.speed} km/h</span>` : ''}
              ${a.data?.geofence ? `<span style="font-size:11px;color:var(--text3)">📍 ${a.data.geofence}</span>` : ''}
              ${a.data?.battery ? `<span style="font-size:11px;color:var(--red)">🔋 ${a.data.battery}%</span>` : ''}
              <span style="font-size:11px;color:var(--text3)">${fmtAgo(a.created_at)}</span>
            </div>
          </div>
          <!-- Actions -->
          <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0">
            <button onclick="Pages.aiAlerts.ack(${a.id})" style="background:var(--green);color:#fff;border:none;border-radius:5px;padding:6px 10px;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px;font-family:var(--font)">
              <i class="ti ti-check"></i> Acquitter
            </button>
            <button onclick="Pages.aiAlerts.snooze(${a.id})" style="background:none;border:1px solid var(--border2);border-radius:5px;padding:5px 10px;font-size:11px;color:var(--text2);cursor:pointer;display:flex;align-items:center;gap:4px;font-family:var(--font)">
              <i class="ti ti-clock-pause"></i> Snooze
            </button>
            ${a.data?.lat ? `<a href="https://maps.google.com/?q=${a.data.lat},${a.data.lon}" target="_blank" style="background:none;border:1px solid var(--border2);border-radius:5px;padding:5px 10px;font-size:11px;color:var(--blue);cursor:pointer;text-decoration:none;display:flex;align-items:center;gap:4px"><i class="ti ti-map-pin"></i> Carte</a>` : ''}
          </div>
        </div>`;
    }).join('');
  },

  renderTrendsChart(trends) {
    if (!window.Chart) return;
    const canvas = document.getElementById('chart-trends'); if(!canvas) return;
    if (this.charts.trends) this.charts.trends.destroy();
    const labels = trends.map(t => new Date(t.day).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}));
    this.charts.trends = new Chart(canvas, {
      type:'line',
      data:{ labels,
        datasets:[
          { label:'Total', data:trends.map(t=>t.total||0), borderColor:'var(--blue)', tension:0.4, fill:true, backgroundColor:'rgba(30,111,217,0.05)', pointRadius:3 },
          { label:'Critiques', data:trends.map(t=>t.critical||0), borderColor:'var(--red)', tension:0.4, fill:false, pointRadius:3 },
        ]
      },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ labels:{ font:{size:10} } } }, scales:{ x:{ticks:{font:{size:9}}}, y:{ticks:{font:{size:9}},beginAtZero:true} } }
    });
  },

  renderRiskVehicles(vehicles) {
    const el = document.getElementById('risk-vehicles-list'); if(!el) return;
    if (!vehicles.length) { el.innerHTML='<div style="font-size:12px;color:var(--text3);padding:8px 0">Aucune donnée disponible</div>'; return; }
    const max = vehicles[0]?.avg_risk || 100;
    el.innerHTML = vehicles.map((v,i)=>`
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:0.5px solid var(--border)">
        <span style="font-size:11px;font-weight:700;color:var(--text3);width:16px">${i+1}</span>
        <div style="flex:1">
          <div style="font-size:12px;font-weight:600">${v.plate||v.imei}</div>
          <div style="font-size:10px;color:var(--text3)">${v.alert_count} alertes · ${v.critical_count} critiques</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:14px;font-weight:800;color:${riskColor(v.avg_risk)};font-family:var(--mono)">${v.avg_risk}</div>
          <div style="width:50px;background:var(--bg);border-radius:99px;height:4px;margin-top:3px">
            <div style="width:${(v.avg_risk/max*100).toFixed(0)}%;height:4px;border-radius:99px;background:${riskColor(v.avg_risk)}"></div>
          </div>
        </div>
      </div>`).join('');
  },

  renderTypesChart(alerts) {
    if (!window.Chart) return;
    const canvas = document.getElementById('chart-types'); if(!canvas) return;
    if (this.charts.types) this.charts.types.destroy();
    const counts = {};
    alerts.forEach(a => { const l=a.label||a.alert_type; counts[l]=(counts[l]||0)+1; });
    const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,6);
    this.charts.types = new Chart(canvas,{
      type:'doughnut',
      data:{ labels:sorted.map(s=>s[0].length>20?s[0].slice(0,18)+'…':s[0]), datasets:[{ data:sorted.map(s=>s[1]), backgroundColor:['#DC2626','#EA580C','#D97706','#1E6FD9','#7C3AED','#16A34A'], borderWidth:2 }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ font:{size:10}, boxWidth:12, padding:8 } } } }
    });
  },

  renderAIStats(stats) {
    const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    set('stat-deduped',   '—');
    set('stat-patterns',  '—');
    set('stat-escalated', '—');
    set('stat-avg-score', stats.avg_score ? Math.round(stats.avg_score)+'/100' : '—');
  },

  async ack(id) {
    try {
      await API.ackAIAlert(id);
      document.getElementById(`al-card-${id}`)?.remove();
      this.all = this.all.filter(a => a.id !== id);
      Toast.show('Alerte acquittée','success',1500);
    } catch(e) { Toast.show('Erreur','error'); }
  },

  async acknowledgeAll() {
    if (!confirm('Acquitter toutes les alertes visibles ?')) return;
    try {
      await API.ackAllAIAlerts(this.severityFilter);
      await this.load();
      Toast.show('Toutes les alertes acquittées','success');
    } catch(e) { Toast.show('Erreur','error'); }
  },

  snooze(id) {
    Modals.open(
      '<i class="ti ti-clock-pause" style="color:var(--blue)"></i> Mettre en silence',
      `<p style="font-size:13px;color:var(--text2);margin-bottom:14px">L'alerte sera masquée pendant la durée choisie, puis reviendra automatiquement si non résolue.</p>
      <div class="filter-chips" style="justify-content:center">
        <button class="chip" onclick="Pages.aiAlerts.confirmSnooze(${id},15)">15 min</button>
        <button class="chip active" onclick="Pages.aiAlerts.confirmSnooze(${id},30)">30 min</button>
        <button class="chip" onclick="Pages.aiAlerts.confirmSnooze(${id},60)">1 heure</button>
        <button class="chip" onclick="Pages.aiAlerts.confirmSnooze(${id},240)">4 heures</button>
      </div>`,
      `<button class="btn-secondary" onclick="Modals.close()">Annuler</button>`
    );
  },

  async confirmSnooze(id, minutes) {
    Modals.close();
    try {
      await API.snoozeAIAlert(id, minutes);
      document.getElementById(`al-card-${id}`)?.remove();
      this.all = this.all.filter(a => a.id !== id);
      Toast.show(`Alerte silencieuse pendant ${minutes} min`, 'info');
    } catch(e) { Toast.show('Erreur','error'); }
  },
};

// ── Couleur selon score de risque ──────────────────────────────────────
function riskColor(score) {
  if (score >= 80) return 'var(--red)';
  if (score >= 60) return '#EA580C';
  if (score >= 40) return 'var(--amber)';
  return 'var(--text3)';
}

/* ═══════════════════════════════════════════════════════════
   PAGE RADARS & ALERTES VOCALES
═══════════════════════════════════════════════════════════ */
Pages.radars = {

  async init() {
    if (!document.getElementById('page-radars')) {
      const div = document.createElement('div');
      div.id = 'page-radars';
      div.className = 'page';
      div.innerHTML = `
        <div class="page-header">
          <div>
            <div class="page-title-h" style="display:flex;align-items:center;gap:10px">
              Radars & Alertes vocales
              <span style="font-size:11px;font-weight:500;background:rgba(124,58,237,0.1);color:var(--purple);padding:3px 10px;border-radius:99px;border:0.5px solid rgba(124,58,237,0.2)">
                🔊 Web Speech API
              </span>
            </div>
            <div class="page-subtitle">Base de données radars · Alertes vocales temps réel pour les conducteurs</div>
          </div>
          <div class="page-actions">
            <button class="btn-secondary" onclick="Pages.radars.importOSM()"><i class="ti ti-cloud-download"></i> Import OSM</button>
            <button class="btn-primary" onclick="Pages.radars.addRadar()"><i class="ti ti-plus"></i> Ajouter radar</button>
          </div>
        </div>

        <!-- Panneau paramètres vocaux -->
        <div style="margin:0 24px 16px;background:linear-gradient(135deg,#0F1923,#1A3050);border-radius:var(--radius-lg);padding:20px 24px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;flex-shrink:0">
          <div style="font-size:32px">🔊</div>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:4px">Alertes vocales en temps réel</div>
            <div style="font-size:12px;color:#7A9DC0">Le système prononce automatiquement l'alerte à l'approche d'un radar · Synthèse vocale native du navigateur</div>
          </div>
          <!-- Contrôles vocaux -->
          <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
            <!-- Toggle ON/OFF -->
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="voice-enabled" onchange="Pages.radars.toggleVoice(this.checked)" style="display:none">
              <div id="voice-toggle" onclick="Pages.radars.toggleVoiceClick()" style="width:44px;height:24px;border-radius:99px;background:var(--green);cursor:pointer;position:relative;transition:background 0.2s">
                <div id="voice-knob" style="width:20px;height:20px;border-radius:50%;background:#fff;position:absolute;top:2px;left:22px;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>
              </div>
              <span style="font-size:12px;font-weight:600;color:#fff" id="voice-status-lbl">Activé</span>
            </label>
            <!-- Volume -->
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:12px;color:#7A9DC0">🔉</span>
              <input type="range" id="voice-volume" min="0" max="1" step="0.1" value="1" oninput="Pages.radars.setVolume(this.value)" style="width:80px;accent-color:var(--blue)">
              <span style="font-size:12px;color:#7A9DC0">🔊</span>
            </div>
            <!-- Vitesse voix -->
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:11px;color:#7A9DC0">Vitesse:</span>
              <select id="voice-rate" onchange="Pages.radars.setRate(this.value)" style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;padding:4px 8px;font-size:11px;cursor:pointer">
                <option value="0.8">Lente</option>
                <option value="0.95" selected>Normale</option>
                <option value="1.1">Rapide</option>
              </select>
            </div>
            <!-- Langue -->
            <select id="voice-lang" onchange="Pages.radars.setLang(this.value)" style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;padding:4px 8px;font-size:11px;cursor:pointer">
              <option value="fr-FR">🇫🇷 Français</option>
              <option value="en-US">🇬🇧 English</option>
            </select>
            <!-- Test -->
            <button onclick="Pages.radars.testVoice()" style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:7px;color:#fff;padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font);display:flex;align-items:center;gap:6px">
              <i class="ti ti-player-play" style="font-size:14px"></i> Tester
            </button>
          </div>
        </div>

        <!-- Support navigateur -->
        <div id="voice-support-warn" style="display:none;margin:0 24px 12px;background:var(--amber-lt);border:1px solid rgba(217,119,6,0.25);border-radius:var(--radius);padding:10px 16px;font-size:12px;color:var(--amber);flex-shrink:0">
          ⚠️ Votre navigateur ne supporte pas la synthèse vocale. Essayez Chrome ou Edge pour les alertes vocales.
        </div>

        <!-- Contenu principal -->
        <div style="flex:1;display:grid;grid-template-columns:1fr 340px;gap:16px;padding:0 24px 24px;min-height:0;overflow:hidden">

          <!-- Carte radars -->
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow)">
            <div class="card-header">
              <div class="card-title"><i class="ti ti-map-2"></i>Carte des radars</div>
              <div class="card-actions">
                <button class="card-action-btn active" id="rb-all"    onclick="Pages.radars.filterMap(null,this)">Tous</button>
                <button class="card-action-btn" id="rb-fixed"  onclick="Pages.radars.filterMap('fixed',this)">Fixes</button>
                <button class="card-action-btn" id="rb-mobile" onclick="Pages.radars.filterMap('mobile',this)">Mobiles</button>
                <button class="card-action-btn" id="rb-school" onclick="Pages.radars.filterMap('school',this)">Écoles</button>
              </div>
            </div>
            <div id="radars-map" style="height:calc(100% - 50px)"></div>
          </div>

          <!-- Liste radars -->
          <div style="display:flex;flex-direction:column;gap:12px;overflow-y:auto">
            <!-- Légende types -->
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;box-shadow:var(--shadow)">
              <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:10px">Types de radars</div>
              <div style="display:flex;flex-direction:column;gap:6px" id="radar-type-legend"></div>
            </div>
            <!-- Stats -->
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;box-shadow:var(--shadow)">
              <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:10px">Base de données</div>
              <div id="radar-stats" style="display:flex;flex-direction:column;gap:6px"></div>
            </div>
            <!-- Liste -->
            <div id="radars-list" style="display:flex;flex-direction:column;gap:8px">
              <div class="loading-state" style="padding:20px"><i class="ti ti-loader"></i></div>
            </div>
          </div>
        </div>
      `;
      document.querySelector('.pages-container').appendChild(div);
    }

    this.initMap();
    this.initVoiceControls();
    await this.load();
  },

  radarMap: null, radarLayer: null, typeFilter: null,

  initMap() {
    if (this.radarMap) { this.radarMap.invalidateSize(); return; }
    const el = document.getElementById('radars-map'); if(!el) return;
    this.radarMap  = L.map('radars-map', { center:[5.354,-4.007], zoom:12 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OSM'}).addTo(this.radarMap);
    this.radarLayer = L.featureGroup().addTo(this.radarMap);
  },

  initVoiceControls() {
    // Support check
    if (!VoiceAlerts.isSupported()) {
      document.getElementById('voice-support-warn').style.display = 'flex';
    }
    // Charger les préférences sauvegardées
    const enabled = VoiceAlerts.isEnabled();
    this.updateToggleUI(enabled);
    const volEl  = document.getElementById('voice-volume'); if(volEl) volEl.value = VoiceAlerts.getVolume();
    const rateEl = document.getElementById('voice-rate');   if(rateEl) rateEl.value = VoiceAlerts.getRate();
    const langEl = document.getElementById('voice-lang');   if(langEl) langEl.value = VoiceAlerts.getLang();

    // Légende des types
    const legendEl = document.getElementById('radar-type-legend');
    if (legendEl) {
      const types = { fixed:'📷 Fixe', mobile:'🚔 Mobile', section:'📏 Tronçon', red_light:'🚦 Feu rouge', school:'🏫 Zone scolaire', toll:'💳 Péage' };
      const colors = { fixed:'#DC2626', mobile:'#EA580C', section:'#7C3AED', red_light:'#D97706', school:'#16A34A', toll:'#0891B2' };
      legendEl.innerHTML = Object.entries(types).map(([k,v]) =>
        `<div style="display:flex;align-items:center;gap:8px;font-size:12px">
          <div style="width:10px;height:10px;border-radius:50%;background:${colors[k]||'#6B7280'};flex-shrink:0"></div>
          <span style="color:var(--text2)">${v}</span>
        </div>`).join('');
    }
  },

  toggleVoiceClick() {
    const newState = !VoiceAlerts.isEnabled();
    VoiceAlerts.setEnabled(newState);
    this.updateToggleUI(newState);
    Toast.show(newState ? '🔊 Alertes vocales activées' : '🔇 Alertes vocales désactivées', 'info');
  },

  updateToggleUI(enabled) {
    const toggle = document.getElementById('voice-toggle');
    const knob   = document.getElementById('voice-knob');
    const lbl    = document.getElementById('voice-status-lbl');
    if (toggle) toggle.style.background = enabled ? 'var(--green)' : '#4A5C80';
    if (knob)   knob.style.left         = enabled ? '22px' : '2px';
    if (lbl)    lbl.textContent          = enabled ? 'Activé' : 'Désactivé';
  },

  setVolume(v) { VoiceAlerts.setVolume(parseFloat(v)); },
  setRate(v)   { VoiceAlerts.setRate(parseFloat(v)); },
  setLang(v)   { VoiceAlerts.setLang(v); },

  testVoice() {
    VoiceAlerts.test();
    // Simuler aussi le toast visuel
    const mockAlert = {
      type:'radar_alert', radarLabel:'Radar fixe', radarIcon:'📷',
      radarType:'fixed', distance:400, speedLimit:50, currentSpeed:55,
      isOverSpeed:true, urgency:'medium', city:'Cocody', road:'Avenue Houphouët-Boigny',
      voice:{ message:'Test. Radar fixe dans 400 mètres à Cocody. Limite 50 kilomètres heure. Vous êtes à 55 kilomètres heure. Ralentissez.', lang:'fr-FR', rate:0.95 }
    };
    VoiceAlerts.onWebSocketMessage(mockAlert);
    Toast.show('🔊 Test vocal lancé', 'info');
  },

  filterMap(type, el) {
    this.typeFilter = type;
    document.querySelectorAll('[id^="rb-"]').forEach(b => b.classList.remove('active'));
    el?.classList.add('active');
    this.renderMap(this.all || []);
  },

  async load() {
    try {
      const radars = await API.getRadars();
      this.all = radars;
      this.renderMap(radars);
      this.renderList(radars);
      this.renderStats(radars);
    } catch(e) {
      const list = document.getElementById('radars-list');
      if(list) list.innerHTML = '<div class="empty-state" style="padding:20px"><i class="ti ti-alert-circle"></i>Erreur de chargement</div>';
    }
  },

  renderMap(radars) {
    if (!this.radarLayer) return;
    this.radarLayer.clearLayers();
    const colors = { fixed:'#DC2626', mobile:'#EA580C', section:'#7C3AED', red_light:'#D97706', school:'#16A34A', toll:'#0891B2' };
    const icons  = { fixed:'📷', mobile:'🚔', section:'📏', red_light:'🚦', school:'🏫', toll:'💳' };
    const filtered = this.typeFilter ? radars.filter(r => r.type === this.typeFilter) : radars;

    filtered.forEach(r => {
      const color  = colors[r.type] || '#6B7280';
      const icon   = icons[r.type]  || '⚠️';
      const circle = L.circle([r.lat, r.lon], {
        radius: r.type === 'section' ? 800 : r.type === 'mobile' ? 300 : 500,
        color, fillColor: color, fillOpacity: 0.08, weight: 1.5,
      }).addTo(this.radarLayer);

      const marker = L.divIcon({
        html: `<div style="width:30px;height:30px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:15px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3)">${icon}</div>`,
        className: '', iconSize:[30,30], iconAnchor:[15,15],
      });
      L.marker([r.lat, r.lon], { icon: marker })
        .addTo(this.radarLayer)
        .bindPopup(`<b>${r.label||icon+' Radar'}</b><br>${r.road||''}<br>${r.city||''}<br>${r.speed_limit?`Limite: <b>${r.speed_limit} km/h</b>`:'Limite inconnue'}`);
    });

    if (this.radarLayer.getBounds().isValid()) {
      this.radarMap?.fitBounds(this.radarLayer.getBounds().pad(0.1));
    }
  },

  renderList(radars) {
    const el = document.getElementById('radars-list'); if(!el) return;
    const icons  = { fixed:'📷', mobile:'🚔', section:'📏', red_light:'🚦', school:'🏫', toll:'💳' };
    const labels = { fixed:'Fixe', mobile:'Mobile', section:'Tronçon', red_light:'Feu rouge', school:'Zone scolaire', toll:'Péage' };
    el.innerHTML = radars.slice(0,15).map(r => `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:11px 14px;display:flex;align-items:center;gap:10px;box-shadow:var(--shadow)">
        <div style="font-size:20px;flex-shrink:0">${icons[r.type]||'⚠️'}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600">${r.label||labels[r.type]||'Radar'}</div>
          <div style="font-size:11px;color:var(--text3)">${r.road||''} ${r.city?'· '+r.city:''}</div>
          ${r.speed_limit?`<div style="font-size:11px;font-weight:600;color:var(--red);margin-top:2px">Limite: ${r.speed_limit} km/h</div>`:''}
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
          ${r.verified?'<span style="font-size:9px;background:var(--green-lt);color:var(--green);padding:1px 6px;border-radius:99px;font-weight:600">✓ Vérifié</span>':'<span style="font-size:9px;background:var(--bg);color:var(--text3);padding:1px 6px;border-radius:99px">Non vérifié</span>'}
          <button onclick="Pages.radars.deleteRadar(${r.id})" style="background:none;border:1px solid var(--border);border-radius:5px;color:var(--text3);font-size:11px;padding:3px 8px;cursor:pointer;font-family:var(--font)"><i class="ti ti-trash" style="font-size:11px"></i></button>
        </div>
      </div>`).join('');
    if (radars.length > 15) {
      el.innerHTML += `<div style="text-align:center;font-size:12px;color:var(--text3);padding:8px">et ${radars.length-15} autres radars...</div>`;
    }
  },

  renderStats(radars) {
    const el = document.getElementById('radar-stats'); if(!el) return;
    const byType = {};
    radars.forEach(r => { byType[r.type]=(byType[r.type]||0)+1; });
    const labels = { fixed:'Fixes', mobile:'Mobiles', section:'Tronçons', red_light:'Feux rouges', school:'Zones scolaires', toll:'Péages' };
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
        <span style="color:var(--text3)">Total radars</span>
        <span style="font-weight:700;color:var(--blue)">${radars.length}</span>
      </div>
      ${Object.entries(byType).map(([k,v])=>`
        <div style="display:flex;justify-content:space-between;font-size:11px">
          <span style="color:var(--text3)">${labels[k]||k}</span>
          <span style="font-weight:600">${v}</span>
        </div>`).join('')}
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-top:4px;padding-top:6px;border-top:0.5px solid var(--border)">
        <span style="color:var(--green)">✓ Vérifiés</span>
        <span style="font-weight:600;color:var(--green)">${radars.filter(r=>r.verified).length}</span>
      </div>`;
  },

  addRadar() {
    Modals.open(
      '<i class="ti ti-map-pin-plus" style="color:var(--blue)"></i> Ajouter un radar',
      `<div class="form-grid">
        <div class="form-group"><label>Type *</label>
          <select id="r-type" class="form-select">
            <option value="fixed">📷 Radar fixe</option>
            <option value="mobile">🚔 Radar mobile</option>
            <option value="section">📏 Radar de tronçon</option>
            <option value="red_light">🚦 Radar feu rouge</option>
            <option value="school">🏫 Zone scolaire</option>
            <option value="toll">💳 Péage</option>
          </select>
        </div>
        <div class="form-group"><label>Limite de vitesse (km/h)</label><input id="r-limit" class="form-input mono" type="number" placeholder="50"></div>
        <div class="form-group"><label>Latitude *</label><input id="r-lat" class="form-input mono" placeholder="5.3640"></div>
        <div class="form-group"><label>Longitude *</label><input id="r-lon" class="form-input mono" placeholder="-4.0070"></div>
        <div class="form-group"><label>Nom / Libellé</label><input id="r-label" class="form-input" placeholder="Radar Plateau Centre"></div>
        <div class="form-group"><label>Ville</label><input id="r-city" class="form-input" placeholder="Abidjan, Cocody..."></div>
        <div class="form-group full"><label>Route / Axe</label><input id="r-road" class="form-input" placeholder="Boulevard de la République"></div>
      </div>`,
      `<button class="btn-secondary" onclick="Modals.close()">Annuler</button>
       <button class="btn-primary" onclick="Pages.radars.saveRadar()"><i class="ti ti-device-floppy"></i> Enregistrer</button>`
    );
  },

  async saveRadar() {
    const lat = parseFloat(document.getElementById('r-lat')?.value);
    const lon = parseFloat(document.getElementById('r-lon')?.value);
    if (!lat || !lon) { Toast.show('Latitude et longitude obligatoires','warning'); return; }
    try {
      await API.addRadar({ lat, lon, type: document.getElementById('r-type')?.value, speedLimit: parseInt(document.getElementById('r-limit')?.value)||null, label: document.getElementById('r-label')?.value.trim(), city: document.getElementById('r-city')?.value.trim(), road: document.getElementById('r-road')?.value.trim() });
      Modals.close();
      await this.load();
      Toast.show('Radar ajouté','success');
    } catch(e) { Toast.show('Erreur: '+e.message,'error'); }
  },

  async deleteRadar(id) {
    if (!confirm('Supprimer ce radar ?')) return;
    try { await API.deleteRadar(id); await this.load(); Toast.show('Supprimé','success'); }
    catch(e) { Toast.show('Erreur','error'); }
  },

  async importOSM() {
    Toast.show('Import OSM en cours... (peut prendre 30s)','info',5000);
    try {
      const r = await API.importOSMRadars();
      await this.load();
      Toast.show(`${r.imported} radars importés depuis OpenStreetMap`,'success');
    } catch(e) { Toast.show('Erreur: '+e.message,'error'); }
  },
};

/* ═══════════════════════════════════════════════════════════
   PAGE PLANS & ABONNEMENTS
═══════════════════════════════════════════════════════════ */
Pages.plans = {

  async init() {
    if (!document.getElementById('page-plans')) {
      const div = document.createElement('div');
      div.id = 'page-plans';
      div.className = 'page';
      div.innerHTML = `
        <div class="page-header">
          <div>
            <div class="page-title-h">Plans & Abonnements</div>
            <div class="page-subtitle">Gérer les offres, organisations et accès utilisateurs</div>
          </div>
          <div class="page-actions">
            <button class="btn-primary" onclick="Pages.plans.newOrg()"><i class="ti ti-building-plus"></i> Nouvelle organisation</button>
          </div>
        </div>
        <div style="flex:1;overflow-y:auto;padding:0 24px 24px">

          <!-- Comparatif des plans -->
          <div id="plans-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px"></div>

          <!-- Organisations -->
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);margin-bottom:16px">
            <div class="card-header">
              <div class="card-title"><i class="ti ti-building"></i>Organisations</div>
              <button class="card-action-btn" onclick="Pages.plans.loadOrgs()"><i class="ti ti-refresh"></i> Actualiser</button>
            </div>
            <div id="orgs-list" style="padding:14px 16px">
              <div class="loading-state" style="padding:20px"><i class="ti ti-loader"></i></div>
            </div>
          </div>

          <!-- Utilisateurs & overrides -->
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow)">
            <div class="card-header">
              <div class="card-title"><i class="ti ti-shield-lock"></i>Accès utilisateurs individuels</div>
            </div>
            <div id="users-access-list" style="padding:14px 16px">
              <div class="loading-state" style="padding:20px"><i class="ti ti-loader"></i></div>
            </div>
          </div>
        </div>
      `;
      document.querySelector('.pages-container').appendChild(div);
    }
    await this.load();
  },

  async load() {
    try {
      const [plansData, users] = await Promise.all([
        API.getPlans(),
        API.getUsers().catch(()=>[]),
      ]);
      this.renderPlansGrid(plansData);
      this.renderUsersAccess(users, plansData);
      await this.loadOrgs();
    } catch(e) { Toast.show('Erreur: '+e.message,'error'); }
  },

  renderPlansGrid(data) {
    const el = document.getElementById('plans-grid'); if(!el) return;
    const p = data.plans || [];
    el.innerHTML = p.map(plan => {
      const groups = data.featureGroups || [];
      const color  = plan.color || 'var(--blue)';
      return `
        <div style="background:var(--surface);border:2px solid ${color};border-radius:var(--radius-lg);overflow:hidden;box-shadow:var(--shadow-md)">
          <!-- Header -->
          <div style="background:${color};padding:20px 24px;color:#fff">
            ${plan.badge ? `<div style="background:rgba(255,255,255,0.2);display:inline-block;padding:2px 10px;border-radius:99px;font-size:10px;font-weight:700;margin-bottom:10px">${plan.badge}</div><br>` : ''}
            <div style="font-size:22px;font-weight:800">${plan.name}</div>
            <div style="font-size:13px;opacity:0.85;margin:4px 0">${plan.tagline}</div>
            <div style="font-size:18px;font-weight:700;margin-top:12px">${fmtFCFA(plan.price_fcfa)}</div>
            <div style="font-size:11px;opacity:0.7">${plan.price_label.replace(/^[^\/]+\/ /,'').split('/ ').slice(1).join(' / ')}</div>
            <div style="font-size:12px;margin-top:8px;opacity:0.85">
              ${plan.max_vehicles ? `Max ${plan.max_vehicles} véhicules` : '✓ Illimité'} ·
              ${plan.max_users    ? `${plan.max_users} utilisateurs`     : '✓ Illimité'}
            </div>
          </div>
          <!-- Features par groupe -->
          <div style="padding:16px 20px;max-height:420px;overflow-y:auto">
            ${groups.map(g => {
              const featuresInGroup = g.features.filter(f => f[plan.id]);
              if (!featuresInGroup.length) return '';
              return `<div style="margin-bottom:12px">
                <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px">${g.icon} ${g.group}</div>
                ${featuresInGroup.map(f => `
                  <div style="display:flex;align-items:center;gap:7px;padding:3px 0;font-size:12px">
                    <i class="ti ti-check" style="color:${color};font-size:14px;flex-shrink:0"></i>
                    ${f.label}
                  </div>`).join('')}
              </div>`;
            }).join('')}
          </div>
        </div>`;
    }).join('');
  },

  async loadOrgs() {
    const el = document.getElementById('orgs-list'); if(!el) return;
    try {
      const orgs = await API.getOrganizations();
      if (!orgs.length) { el.innerHTML='<div style="color:var(--text3);font-size:13px">Aucune organisation</div>'; return; }
      const planColors = { starter:'#1E6FD9', business:'#7C3AED', pro:'#DC2626' };
      el.innerHTML = orgs.map(o => `
        <div style="display:flex;align-items:center;gap:14px;padding:13px 0;border-bottom:0.5px solid var(--border)">
          <div style="width:40px;height:40px;border-radius:10px;background:${planColors[o.plan]||'var(--blue)'}20;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">🏢</div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:700">${o.name}</div>
            <div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap">
              <span style="font-size:11px;font-weight:700;background:${planColors[o.plan]||'var(--blue)'}20;color:${planColors[o.plan]||'var(--blue)'};padding:2px 9px;border-radius:99px">${(o.plan||'starter').toUpperCase()}</span>
              ${o.plan_expires_at ? `<span style="font-size:10px;color:var(--text3)">Expire: ${fmtDay(o.plan_expires_at)}</span>` : '<span style="font-size:10px;color:var(--green)">✓ Actif</span>'}
              <span style="font-size:10px;color:var(--text3)">${o.user_count||0} utilisateurs</span>
            </div>
          </div>
          <button class="btn-sm" onclick="Pages.plans.editOrg(${o.id},'${o.name}','${o.plan}')">
            <i class="ti ti-edit"></i> Modifier
          </button>
        </div>`).join('');
    } catch(e) { el.innerHTML='<div style="color:var(--text3);font-size:13px">Erreur de chargement</div>'; }
  },

  renderUsersAccess(users, plansData) {
    const el = document.getElementById('users-access-list'); if(!el) return;
    const allFeatures = (plansData.featureGroups||[]).flatMap(g => g.features);
    if (!users.length) { el.innerHTML='<div style="color:var(--text3);font-size:13px">Aucun utilisateur</div>'; return; }
    el.innerHTML = users.map(u => `
      <div style="display:flex;align-items:center;gap:14px;padding:13px 0;border-bottom:0.5px solid var(--border)">
        <div style="width:38px;height:38px;border-radius:50%;background:var(--blue-lt);color:var(--blue);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;flex-shrink:0">${(u.name||u.email).charAt(0).toUpperCase()}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:700">${u.name||u.email}</div>
          <div style="font-size:11px;color:var(--text3)">${u.email} · <span style="color:var(--blue)">${u.role}</span></div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn-sm" onclick="Pages.plans.editUserOverrides(${u.id},'${u.name||u.email}')">
            <i class="ti ti-adjustments"></i> Accès custom
          </button>
        </div>
      </div>`).join('');
  },

  editOrg(id, name, currentPlan) {
    Modals.open(
      `<i class="ti ti-building" style="color:var(--blue)"></i> Organisation — ${name}`,
      `<div class="form-group" style="margin-bottom:14px">
        <label>Plan actuel : <strong>${currentPlan.toUpperCase()}</strong></label>
        <select id="org-plan" class="form-select" style="margin-top:8px">
          <option value="starter" ${currentPlan==='starter'?'selected':''}>🔵 Starter — 9 900 FCFA/mois/véhicule</option>
          <option value="business" ${currentPlan==='business'?'selected':''}>🟣 Business — 19 900 FCFA/mois/véhicule</option>
          <option value="pro" ${currentPlan==='pro'?'selected':''}>🔴 Pro — 39 900 FCFA/mois/véhicule</option>
        </select>
      </div>
      <div class="form-group">
        <label>Date d'expiration (vide = pas de limite)</label>
        <input type="date" id="org-expires" class="form-input">
      </div>
      <div class="form-hint" style="margin-top:10px"><i class="ti ti-info-circle"></i>Le changement de plan prend effet immédiatement pour tous les utilisateurs de cette organisation.</div>`,
      `<button class="btn-secondary" onclick="Modals.close()">Annuler</button>
       <button class="btn-primary" onclick="Pages.plans.saveOrgPlan(${id})"><i class="ti ti-device-floppy"></i> Appliquer</button>`
    );
  },

  async saveOrgPlan(id) {
    const plan      = document.getElementById('org-plan')?.value;
    const expiresAt = document.getElementById('org-expires')?.value || null;
    try {
      await API.updateOrgPlan(id, plan, expiresAt);
      Modals.close();
      await this.load();
      Toast.show(`Plan mis à jour → ${plan.toUpperCase()}`,'success');
    } catch(e) { Toast.show('Erreur: '+e.message,'error'); }
  },

  async editUserOverrides(userId, userName) {
    // Charger le profil actuel
    let profile = null;
    try { profile = await API.getUserAccess(userId); } catch(e) {}
    const currentOverrides = profile?.userOverrides || {};

    // Construire la liste des features toggleables
    const groups = (await API.getPlans().catch(()=>({featureGroups:[]}))).featureGroups || [];
    const overridesUI = groups.map(g => `
      <div style="margin-bottom:14px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px">${g.icon} ${g.group}</div>
        ${g.features.map(f => {
          const current = currentOverrides[f.id];
          const state   = current === true ? 'granted' : current === false ? 'denied' : 'plan';
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:0.5px solid var(--border)">
            <span style="font-size:12px">${f.label}</span>
            <select data-feat="${f.id}" class="form-select" style="width:130px;font-size:11px;padding:4px 8px">
              <option value="plan" ${state==='plan'?'selected':''}>Selon le plan</option>
              <option value="granted" ${state==='granted'?'selected':''}>✓ Toujours autorisé</option>
              <option value="denied" ${state==='denied'?'selected':''}>✗ Toujours bloqué</option>
            </select>
          </div>`;
        }).join('')}
      </div>`).join('');

    Modals.open(
      `<i class="ti ti-adjustments" style="color:var(--blue)"></i> Accès custom — ${userName}`,
      `<p style="font-size:12px;color:var(--text3);margin-bottom:14px">Personnalisez les accès de cet utilisateur indépendamment du plan de son organisation.</p>
      <div style="max-height:380px;overflow-y:auto">${overridesUI}</div>`,
      `<button class="btn-secondary" onclick="Modals.close()">Annuler</button>
       <button class="btn-primary" onclick="Pages.plans.saveUserOverrides(${userId})"><i class="ti ti-device-floppy"></i> Sauvegarder</button>`
    );
  },

  async saveUserOverrides(userId) {
    const selects  = document.querySelectorAll('[data-feat]');
    const overrides = {};
    selects.forEach(sel => {
      if (sel.value === 'granted') overrides[sel.dataset.feat] = true;
      else if (sel.value === 'denied') overrides[sel.dataset.feat] = false;
      // 'plan' = on supprime l'override
    });
    try {
      await API.updateUserOverrides(userId, overrides);
      Modals.close();
      Toast.show('Accès personnalisés sauvegardés','success');
    } catch(e) { Toast.show('Erreur: '+e.message,'error'); }
  },

  newOrg() {
    Modals.open(
      '<i class="ti ti-building-plus" style="color:var(--blue)"></i> Nouvelle organisation',
      `<div class="form-group"><label>Nom de la société *</label><input id="new-org-name" class="form-input" placeholder="GEOTRACK, Flotte ABC..."></div>
      <div class="form-group" style="margin-top:12px"><label>Plan initial</label>
        <select id="new-org-plan" class="form-select">
          <option value="starter">🔵 Starter</option>
          <option value="business" selected>🟣 Business</option>
          <option value="pro">🔴 Pro</option>
        </select>
      </div>`,
      `<button class="btn-secondary" onclick="Modals.close()">Annuler</button>
       <button class="btn-primary" onclick="Pages.plans.saveNewOrg()"><i class="ti ti-plus"></i> Créer</button>`
    );
  },

  async saveNewOrg() {
    const name = document.getElementById('new-org-name')?.value.trim();
    const plan = document.getElementById('new-org-plan')?.value;
    if (!name) { Toast.show('Nom requis','warning'); return; }
    try {
      await API.createOrganization({ name, plan });
      Modals.close();
      await this.loadOrgs();
      Toast.show('Organisation créée','success');
    } catch(e) { Toast.show('Erreur: '+e.message,'error'); }
  },
};

/* ═══════════════════════════════════════════════════════════
   GATE — Composant de verrouillage côté UI
   Affiche un cadenas + bouton upgrade si feature non dispo
═══════════════════════════════════════════════════════════ */
const FeatureGate = {
  // Features autorisées pour l'utilisateur courant (chargé au login)
  _allowed: new Set(),
  _plan:    'starter',

  // Charger depuis /api/my-access au login
  async load() {
    try {
      const profile = await API.getMyAccess();
      if (profile) {
        this._allowed = new Set(profile.features || []);
        this._plan    = profile.plan || 'starter';
        this._profile = profile;
        // Injecter le badge plan dans la sidebar
        this.injectPlanBadge(profile);
        // Masquer les nav items selon le plan
        this.applyNavGating();
      }
    } catch(e) {}
  },

  can(featureId) {
    if (this._profile?.role === 'superadmin') return true;
    return this._allowed.has(featureId);
  },

  // Affiche un modal d'upgrade si la feature est bloquée
  // Retourne true si accès autorisé
  check(featureId, planRequired = 'business') {
    if (this.can(featureId)) return true;
    const planColors = { starter:'#1E6FD9', business:'#7C3AED', pro:'#DC2626' };
    const planLabels = { starter:'Starter', business:'Business', pro:'Pro' };
    const color = planColors[planRequired] || 'var(--blue)';
    Modals.open(
      `<i class="ti ti-lock" style="color:${color}"></i> Fonctionnalité non disponible`,
      `<div style="text-align:center;padding:12px 0">
        <div style="font-size:44px;margin-bottom:12px">🔒</div>
        <div style="font-size:17px;font-weight:700;margin-bottom:8px">Plan <span style="color:${color}">${planLabels[planRequired]}</span> requis</div>
        <div style="font-size:13px;color:var(--text2);margin-bottom:20px;line-height:1.6">Cette fonctionnalité n'est pas incluse dans votre abonnement actuel.<br>Passez au plan ${planLabels[planRequired]} pour y accéder.</div>
        <button onclick="App.navigate('plans');Modals.close()" style="background:${color};color:#fff;border:none;border-radius:8px;padding:11px 28px;font-size:14px;font-weight:700;cursor:pointer;font-family:var(--font)">
          Voir les plans →
        </button>
      </div>`,
      `<button class="btn-secondary" onclick="Modals.close()">Fermer</button>`
    );
    return false;
  },

  injectPlanBadge(profile) {
    const planColors = { starter:'#1E6FD9', business:'#7C3AED', pro:'#DC2626' };
    const color = planColors[profile.plan] || 'var(--blue)';
    const badge = document.createElement('div');
    badge.style.cssText = `padding:6px 14px;margin:0 8px 4px;background:${color}18;border:0.5px solid ${color}30;border-radius:7px;display:flex;align-items:center;justify-content:space-between`;
    badge.innerHTML = `<span style="font-size:10px;font-weight:700;color:${color}">${profile.planName?.toUpperCase()} PLAN</span><span style="font-size:10px;color:var(--sb-text)">${profile.orgName||''}</span>`;
    const nav = document.querySelector('.sb-nav');
    if (nav) nav.insertBefore(badge, nav.firstChild);
  },

  applyNavGating() {
    // Griser les items nav des features non disponibles
    const gatedItems = {
      'ai-alerts':          'ai_alerts',
      'auto-immobilization':'auto_immobilization',
      'radars':             'radar_voice_alerts',
      'auto-immo-live':     'auto_immobilization',
      'driver-score':       'driver_score',
      'analytics':          'analytics_basic',
      'route-optimizer':    'route_optimization',
    };
    for (const [page, feat] of Object.entries(gatedItems)) {
      if (!this.can(feat)) {
        const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
        if (navItem) {
          navItem.style.opacity = '0.45';
          navItem.title = 'Upgrade requis';
          navItem.setAttribute('onclick', `FeatureGate.check('${feat}')`);
        }
      }
    }
  },
};
