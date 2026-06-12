/** OROS MOBILITY — Gestionnaire de carte Leaflet */
const MapManager = (() => {
  const maps={}, markers=new Map();
  let followTarget=null, activeMapId='map', historyMap=null, historyLine=null, historyMarker=null, geofenceLayer=null, geofenceMap=null;
  const osm='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const sat='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const ABIDJAN=[5.354,-4.007];

  function makeIcon(status,vehicleType='car'){
    const colors={online:'#16A34A',offline:'#9CA3AF',idle:'#D97706',alarm:'#DC2626',immobilized:'#DC2626'};
    const c=colors[status]||'#9CA3AF';
    const emojis={car:'🚗',moto:'🏍️',truck:'🚛',bus:'🚌',van:'🚐',taxi:'🚕'};
    const e=emojis[vehicleType]||'🚗';
    const anim=(status==='online'||status==='alarm')?`<circle cx="20" cy="20" r="14" fill="${c}" fill-opacity="0.12"><animate attributeName="r" from="12" to="20" dur="2s" repeatCount="indefinite"/><animate attributeName="fill-opacity" from="0.12" to="0" dur="2s" repeatCount="indefinite"/></circle>`:'';
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">${anim}<circle cx="20" cy="20" r="13" fill="white" stroke="${c}" stroke-width="2.5"/><text x="20" y="25" text-anchor="middle" font-size="13">${e}</text></svg>`;
    return L.divIcon({html:svg,className:'',iconSize:[40,40],iconAnchor:[20,20],popupAnchor:[0,-22]});
  }

  function createTileLayer(type){
    if(type==='satellite') return L.tileLayer(sat,{attribution:'© Esri',maxZoom:18});
    return L.tileLayer(osm,{attribution:'© OpenStreetMap',maxZoom:19});
  }

  return {
    initMap(id='map'){
      if(maps[id]){ maps[id].invalidateSize(); return; }
      const el=document.getElementById(id); if(!el) return;
      const m=L.map(id,{center:ABIDJAN,zoom:12,zoomControl:false});
      L.control.zoom({position:'bottomright'}).addTo(m);
      createTileLayer('osm').addTo(m);
      maps[id]=m;
      activeMapId=id;
      // Partager les marqueurs entre map et live-map
      if(id==='map'||id==='live-map'){ markers.forEach((mk,imei)=>{ if(!maps[id].hasLayer(mk)) mk.addTo(maps[id]); }); }
    },

    initHistoryMap(){
      if(historyMap){ historyMap.invalidateSize(); return; }
      const el=document.getElementById('history-map'); if(!el) return;
      historyMap=L.map('history-map',{center:ABIDJAN,zoom:12});
      createTileLayer('osm').addTo(historyMap);
    },

    initGeofenceMap(){
      if(geofenceMap){ geofenceMap.invalidateSize(); return geofenceMap; }
      const el=document.getElementById('geofences-map'); if(!el) return null;
      geofenceMap=L.map('geofences-map',{center:ABIDJAN,zoom:12});
      createTileLayer('osm').addTo(geofenceMap);
      geofenceLayer=L.featureGroup().addTo(geofenceMap);
      return geofenceMap;
    },

    setLayer(type){
      Object.values(maps).forEach(m=>{ m.eachLayer(l=>{ if(l._url) m.removeLayer(l); }); createTileLayer(type).addTo(m); });
    },

    updateDevice(device){
      const {imei,lat,lon,speed,status,name,vtype}=device;
      if(!lat||!lon||lat===0) return;
      const icon=makeIcon(status||'offline',vtype||'car');
      Object.values(maps).forEach(m=>{
        if(markers.has(imei)){
          const mk=markers.get(imei); mk.setLatLng([lat,lon]); mk.setIcon(icon);
          if(!m.hasLayer(mk)) mk.addTo(m);
        } else {
          const mk=L.marker([lat,lon],{icon}).addTo(m).bindTooltip(name||imei,{permanent:false,direction:'top',className:'leaflet-tooltip'});
          mk.on('click',()=>window.Pages?.dashboard?.selectDevice?.(imei));
          markers.set(imei,mk);
        }
      });
      if(followTarget===imei) Object.values(maps).forEach(m=>m.setView([lat,lon]));
    },

    fitAll(){
      if(!markers.size) return;
      const group=L.featureGroup([...markers.values()]);
      Object.values(maps).forEach(m=>{ try{ m.fitBounds(group.getBounds().pad(0.15)); }catch(e){} });
    },

    panTo(imei){
      const mk=markers.get(imei);
      if(mk) Object.values(maps).forEach(m=>m.panTo(mk.getLatLng()));
    },

    toggleFollow(imei){ followTarget=(followTarget===imei)?null:imei; return followTarget!==null; },

    drawHistory(positions){
      if(!historyMap) return;
      if(historyLine){ historyMap.removeLayer(historyLine); historyLine=null; }
      if(historyMarker){ historyMap.removeLayer(historyMarker); historyMarker=null; }
      if(!positions.length) return;
      const coords=positions.map(p=>[p.lat,p.lon]);
      historyLine=L.polyline(coords,{color:'#1E6FD9',weight:3,opacity:0.85}).addTo(historyMap);
      L.circleMarker(coords[coords.length-1],{radius:7,color:'#16A34A',fillColor:'#16A34A',fillOpacity:1}).addTo(historyMap).bindTooltip('Départ');
      L.circleMarker(coords[0],{radius:7,color:'#DC2626',fillColor:'#DC2626',fillOpacity:1}).addTo(historyMap).bindTooltip('Arrivée');
      historyMap.fitBounds(historyLine.getBounds().pad(0.1));
      historyMarker=L.marker(coords[coords.length-1],{icon:makeIcon('online','car')}).addTo(historyMap);
    },

    moveReplayMarker(pos){ if(historyMarker&&pos){ historyMarker.setLatLng([pos.lat,pos.lon]); historyMap?.panTo([pos.lat,pos.lon]); } },

    drawGeofences(geofences){
      if(!geofenceLayer) return;
      geofenceLayer.clearLayers();
      geofences.forEach(gf=>{
        let layer;
        if(gf.type==='circle') layer=L.circle([gf.lat,gf.lon],{radius:gf.radius,color:'#1E6FD9',fillColor:'#1E6FD9',fillOpacity:0.08,weight:2});
        else if(gf.coordinates?.length) layer=L.polygon(gf.coordinates.map(c=>[c.lat,c.lon]),{color:'#7C3AED',fillColor:'#7C3AED',fillOpacity:0.08,weight:2});
        if(layer) layer.bindTooltip(gf.name).addTo(geofenceLayer);
      });
      if(geofenceLayer.getBounds().isValid()) geofenceMap?.fitBounds(geofenceLayer.getBounds().pad(0.2));
    },

    invalidate(){ setTimeout(()=>{ Object.values(maps).forEach(m=>m.invalidateSize()); historyMap?.invalidateSize(); },100); }
  };
})();
