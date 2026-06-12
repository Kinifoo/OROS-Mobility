/**
 * OROS MOBILITY — Alertes vocales (Web Speech API)
 * ════════════════════════════════════════════════════════
 *
 * Synthèse vocale navigateur native (0 dépendance, 0 coût)
 * Compatible: Chrome, Firefox, Safari, Edge
 * Langues: Français (fr-FR), Anglais (en-US)
 *
 * Fonctionnement:
 * - Reçoit les alertes radar depuis le WebSocket
 * - Synthétise le message en voix selon les préférences
 * - File d'attente pour ne pas interrompre un message en cours
 * - Volume, vitesse, voix configurables dans les paramètres
 * ════════════════════════════════════════════════════════
 */

const VoiceAlerts = (() => {
  // ── État ─────────────────────────────────────────────────
  let enabled        = localStorage.getItem('oros_voice') !== 'false'; // Activé par défaut
  let volume         = parseFloat(localStorage.getItem('oros_voice_vol')  || '1.0');
  let rate           = parseFloat(localStorage.getItem('oros_voice_rate') || '0.95');
  let lang           = localStorage.getItem('oros_voice_lang') || 'fr-FR';
  let selectedVoice  = null;
  let queue          = [];
  let isSpeaking     = false;
  const synth        = window.speechSynthesis;

  // ── Sons d'alerte (beeps) avant la voix ─────────────────
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playBeep(frequency = 880, duration = 0.15, urgency = 'medium') {
    try {
      const ctx  = getAudioCtx();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.frequency.value = frequency;
      osc.type = urgency === 'high' ? 'square' : 'sine';
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(volume * 0.4, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch(e) {}
  }

  function playRadarSound(urgency) {
    if (!enabled) return;
    if (urgency === 'high') {
      // 3 bips rapides urgents
      playBeep(1200, 0.12, 'high');
      setTimeout(() => playBeep(1200, 0.12, 'high'), 150);
      setTimeout(() => playBeep(1200, 0.12, 'high'), 300);
    } else if (urgency === 'medium') {
      // 2 bips moyens
      playBeep(880, 0.2, 'sine');
      setTimeout(() => playBeep(880, 0.2, 'sine'), 280);
    } else {
      // 1 bip doux
      playBeep(660, 0.3, 'sine');
    }
  }

  // ── Charger les voix disponibles ─────────────────────────
  function loadVoices() {
    if (!synth) return [];
    const voices = synth.getVoices();
    // Préférer une voix française féminine
    const prefs = ['Google French', 'Microsoft Julie', 'Amélie', 'Thomas', 'fr-FR'];
    for (const pref of prefs) {
      const v = voices.find(v => v.name.includes(pref) || v.lang === pref);
      if (v) { selectedVoice = v; break; }
    }
    // Fallback : première voix française disponible
    if (!selectedVoice) {
      selectedVoice = voices.find(v => v.lang.startsWith('fr')) || voices[0];
    }
    return voices;
  }

  // Charger les voix au bon moment
  if (synth) {
    loadVoices();
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = loadVoices;
    }
  }

  // ── Synthèse vocale ───────────────────────────────────────
  function speak(text, options = {}) {
    if (!enabled || !synth || !text) return;
    // Ajouter à la file
    queue.push({ text, options });
    if (!isSpeaking) processQueue();
  }

  function processQueue() {
    if (!queue.length) { isSpeaking = false; return; }
    isSpeaking = true;
    const { text, options } = queue.shift();

    // Annuler toute lecture en cours
    synth.cancel();

    const utterance       = new SpeechSynthesisUtterance(text);
    utterance.voice       = selectedVoice;
    utterance.lang        = options.lang  || lang;
    utterance.rate        = options.rate  || rate;
    utterance.pitch       = options.pitch || 1.0;
    utterance.volume      = options.volume !== undefined ? options.volume : volume;

    utterance.onend = () => setTimeout(processQueue, 300);
    utterance.onerror = () => { isSpeaking = false; processQueue(); };

    synth.speak(utterance);
  }

  // ── Traitement d'une alerte radar (depuis WebSocket) ─────
  function handleRadarAlert(alert) {
    if (!enabled) return;

    // Son d'alerte d'abord
    playRadarSound(alert.urgency || 'medium');

    // Puis voix après le son
    const delay = alert.urgency === 'high' ? 500 : 350;
    setTimeout(() => {
      speak(alert.voice?.message || buildDefaultMessage(alert), {
        lang:   alert.voice?.lang   || lang,
        rate:   alert.voice?.rate   || rate,
        pitch:  alert.voice?.pitch  || 1.0,
        volume: alert.voice?.volume || volume,
      });
    }, delay);

    // Afficher le toast visuel
    showRadarToast(alert);
  }

  function buildDefaultMessage(alert) {
    const dist = alert.distance || '?';
    const lim  = alert.speedLimit ? `Limite ${alert.speedLimit} kilomètres heure.` : '';
    return `${alert.radarLabel || 'Radar'} dans ${dist} mètres. ${lim}`;
  }

  // ── Toast visuel de radar ─────────────────────────────────
  function showRadarToast(alert) {
    // Supprimer le toast radar précédent s'il existe
    document.getElementById('radar-toast')?.remove();

    const urgencyColors = { high: '#DC2626', medium: '#D97706', low: '#1E6FD9' };
    const color = alert.isOverSpeed ? '#DC2626' : (urgencyColors[alert.urgency] || '#D97706');

    const toast = document.createElement('div');
    toast.id = 'radar-toast';
    toast.style.cssText = `
      position:fixed; top:70px; left:50%; transform:translateX(-50%);
      background:${color}; color:#fff; border-radius:12px;
      padding:12px 20px; min-width:300px; max-width:420px;
      display:flex; align-items:center; gap:12px;
      box-shadow:0 8px 24px rgba(0,0,0,0.3); z-index:9999;
      animation:radarToastIn 0.3s cubic-bezier(0.34,1.56,0.64,1);
      font-family:'Figtree',sans-serif;
    `;

    const distBar = Math.min(100, Math.max(5, 100 - (alert.distance / 5)));

    toast.innerHTML = `
      <div style="font-size:28px;flex-shrink:0">${alert.radarIcon || '📷'}</div>
      <div style="flex:1">
        <div style="font-size:14px;font-weight:700">${alert.radarLabel || 'Radar'}</div>
        <div style="font-size:12px;opacity:0.9;margin:2px 0">
          ${alert.city ? alert.city + ' · ' : ''}${alert.road || ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
          <div style="font-size:20px;font-weight:800">${alert.distance}m</div>
          ${alert.speedLimit ? `<div style="background:rgba(255,255,255,0.2);border-radius:6px;padding:2px 8px;font-size:12px;font-weight:600">Limite: ${alert.speedLimit} km/h</div>` : ''}
          ${alert.isOverSpeed ? `<div style="background:rgba(255,255,255,0.3);border-radius:6px;padding:2px 8px;font-size:12px;font-weight:700">⚠️ ${alert.currentSpeed} km/h</div>` : ''}
        </div>
        <!-- Barre de proximité -->
        <div style="background:rgba(255,255,255,0.2);border-radius:99px;height:4px;margin-top:8px">
          <div style="width:${distBar}%;height:4px;background:#fff;border-radius:99px;transition:width 0.5s"></div>
        </div>
      </div>
      <button onclick="document.getElementById('radar-toast').remove()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:14px;flex-shrink:0">✕</button>
    `;

    document.body.appendChild(toast);

    // Auto-dismiss selon la distance
    const dismissMs = alert.distance < 200 ? 6000 : alert.distance < 400 ? 8000 : 10000;
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(-10px)';
      toast.style.transition = '0.4s';
      setTimeout(() => toast.remove(), 400);
    }, dismissMs);
  }

  // ── API publique ──────────────────────────────────────────
  return {
    // Gestion des alertes reçues depuis WebSocket
    onWebSocketMessage(msg) {
      if (msg.type === 'radar_alert') handleRadarAlert(msg);
    },

    // Lecture test
    test(text) {
      playRadarSound('medium');
      setTimeout(() => speak(text || 'Test alerte radar. Radar fixe dans 400 mètres. Limite 50 kilomètres heure.'), 400);
    },

    // Paramètres
    setEnabled(v)  { enabled = v;        localStorage.setItem('oros_voice', String(v)); },
    setVolume(v)   { volume = v;         localStorage.setItem('oros_voice_vol', String(v)); },
    setRate(v)     { rate = v;           localStorage.setItem('oros_voice_rate', String(v)); },
    setLang(v)     { lang = v;           localStorage.setItem('oros_voice_lang', v); loadVoices(); },
    isEnabled()    { return enabled; },
    getVolume()    { return volume; },
    getRate()      { return rate; },
    getLang()      { return lang; },
    getVoices()    { return synth ? synth.getVoices() : []; },
    isSupported()  { return 'speechSynthesis' in window; },

    // Stop tout
    stop() { synth?.cancel(); queue = []; isSpeaking = false; },
  };
})();

// ── Intégrer dans le WebSocket handler ────────────────────────────────
// Appelé depuis app.js quand un message WS arrive
if (typeof WS_HOOKS === 'undefined') window.WS_HOOKS = [];
window.WS_HOOKS.push(msg => VoiceAlerts.onWebSocketMessage(msg));
