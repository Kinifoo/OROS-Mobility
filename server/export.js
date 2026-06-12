/**
 * OROS — Export PDF et Excel natif
 * Sans dépendances externes lourdes
 * PDF: HTML → données structurées (le navigateur imprime)
 * Excel: CSV + format XLS manuel (compatible Excel/LibreOffice)
 */
'use strict';

const { pool } = require('./database');
const logger   = require('./utils/logger');

// ── HELPERS GÉNÉRIQUES ────────────────────────────────────────────────
function fmtDate(d)  { return d ? new Date(d).toLocaleDateString('fr-FR') : '—'; }
function fmtTime(d)  { return d ? new Date(d).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : '—'; }
function fmtNum(n,d=2) { return n!=null ? Number(n).toFixed(d) : '—'; }
function fmtFCFA(n) { return n!=null ? new Intl.NumberFormat('fr-FR').format(n)+' FCFA' : '—'; }

// Score → couleur HTML
function scoreColor(s) {
  if (s>=90) return '#16A34A'; if (s>=75) return '#1E6FD9';
  if (s>=60) return '#D97706'; return '#DC2626';
}
function scoreGrade(s) {
  if(s>=90)return'A'; if(s>=75)return'B'; if(s>=60)return'C'; if(s>=40)return'D'; return'F';
}

// ── CSS commun pour tous les PDF ──────────────────────────────────────
const PDF_CSS = `
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family: 'Segoe UI',Arial,sans-serif; font-size:12px; color:#1F2937; background:#fff; }
    .header { background:#0F1923; color:#fff; padding:24px 32px; display:flex; justify-content:space-between; align-items:center; }
    .brand { font-size:22px; font-weight:800; letter-spacing:-0.5px; }
    .brand span { color:#22D3EE; }
    .header-info { text-align:right; font-size:11px; color:#7AA0C0; }
    .header-info strong { color:#fff; font-size:13px; display:block; }
    .section { padding:20px 32px; }
    .section-title { font-size:14px; font-weight:700; color:#0F1923; border-bottom:2px solid #1E6FD9; padding-bottom:6px; margin-bottom:14px; }
    .kpi-row { display:flex; gap:12px; margin-bottom:20px; flex-wrap:wrap; }
    .kpi { flex:1; min-width:120px; background:#F8FAFD; border:1px solid #E8ECF2; border-radius:8px; padding:12px 16px; }
    .kpi-val { font-size:22px; font-weight:800; color:#1E6FD9; }
    .kpi-lbl { font-size:10px; color:#6B7280; text-transform:uppercase; letter-spacing:0.06em; margin-top:2px; }
    table { width:100%; border-collapse:collapse; font-size:11px; }
    th { background:#0F1923; color:#fff; padding:8px 10px; text-align:left; font-weight:600; font-size:10px; letter-spacing:0.05em; text-transform:uppercase; }
    td { padding:7px 10px; border-bottom:1px solid #E8ECF2; }
    tr:nth-child(even) td { background:#F8FAFD; }
    .badge { display:inline-block; padding:2px 8px; border-radius:99px; font-size:10px; font-weight:700; }
    .badge-green  { background:#ECFDF5; color:#16A34A; }
    .badge-red    { background:#FEF2F2; color:#DC2626; }
    .badge-amber  { background:#FFFBEB; color:#D97706; }
    .badge-blue   { background:#EBF3FF; color:#1E6FD9; }
    .footer { background:#F8FAFD; border-top:1px solid #E8ECF2; padding:12px 32px; display:flex; justify-content:space-between; font-size:10px; color:#9CA3AF; }
    .score-bar { height:6px; border-radius:99px; background:#E8ECF2; margin-top:3px; }
    .score-fill { height:6px; border-radius:99px; }
    @media print { body { -webkit-print-color-adjust:exact; } }
  </style>
`;

// ── RAPPORT TRAJETS (PDF HTML) ─────────────────────────────────────────
async function generateTripsReport(params = {}) {
  const { from, to, imei, vehicleId } = params;
  try {
    let q = `
      SELECT t.*, d.name AS device_name, d.imei,
             v.plate, v.brand, v.model,
             dr.name AS driver_name, t.driving_score
      FROM trips t
      JOIN devices d ON d.id=t.device_id
      LEFT JOIN vehicles v ON v.device_id=d.id AND v.active=true
      LEFT JOIN assignments a ON a.vehicle_id=v.id
        AND t.start_time BETWEEN a.started_at AND COALESCE(a.ended_at,NOW())
      LEFT JOIN drivers dr ON dr.id=a.driver_id
      WHERE t.end_time IS NOT NULL
    `;
    const p = [];
    if (from) { p.push(from); q += ` AND t.start_time >= $${p.length}`; }
    if (to)   { p.push(to);   q += ` AND t.end_time   <= $${p.length}`; }
    if (imei) { p.push(imei); q += ` AND d.imei = $${p.length}`; }
    q += ' ORDER BY t.start_time DESC LIMIT 500';
    const r = await pool.query(q, p);
    const trips = r.rows;

    const totalKm   = trips.reduce((s,t) => s+(t.distance||0), 0);
    const totalMin  = trips.reduce((s,t) => s+(t.duration_minutes||0), 0);
    const avgScore  = trips.filter(t=>t.driving_score).reduce((s,t,_,a) => s+t.driving_score/a.length, 0);
    const maxSpeed  = trips.reduce((m,t) => Math.max(m,t.max_speed||0), 0);

    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Rapport Trajets</title>${PDF_CSS}</head><body>
      <div class="header">
        <div><div class="brand">OROS <span>Mobility</span></div><div style="font-size:11px;color:#7AA0C0;margin-top:4px">Rapport de trajets</div></div>
        <div class="header-info"><strong>Période: ${fmtDate(from)} → ${fmtDate(to)||'Aujourd\'hui'}</strong>Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}</div>
      </div>
      <div class="section">
        <div class="kpi-row">
          <div class="kpi"><div class="kpi-val">${trips.length}</div><div class="kpi-lbl">Trajets</div></div>
          <div class="kpi"><div class="kpi-val">${fmtNum(totalKm/1000,1)}</div><div class="kpi-lbl">Distance (km)</div></div>
          <div class="kpi"><div class="kpi-val">${Math.floor(totalMin/60)}h${totalMin%60}m</div><div class="kpi-lbl">Durée totale</div></div>
          <div class="kpi"><div class="kpi-val">${Math.round(maxSpeed)}</div><div class="kpi-lbl">Vitesse max (km/h)</div></div>
          <div class="kpi"><div class="kpi-val" style="color:${scoreColor(Math.round(avgScore))}">${Math.round(avgScore)||'—'}</div><div class="kpi-lbl">Score moyen</div></div>
        </div>
        <div class="section-title">Détail des trajets</div>
        <table>
          <tr><th>Date</th><th>Heure</th><th>Véhicule</th><th>Conducteur</th><th>Distance</th><th>Durée</th><th>Vit. moy</th><th>Vit. max</th><th>Score</th></tr>
          ${trips.map(t => `<tr>
            <td>${fmtDate(t.start_time)}</td>
            <td>${fmtTime(t.start_time)} → ${fmtTime(t.end_time)}</td>
            <td>${t.plate||t.device_name||t.imei}</td>
            <td>${t.driver_name||'—'}</td>
            <td>${fmtNum(t.distance,1)} km</td>
            <td>${t.duration_minutes||0} min</td>
            <td>${Math.round(t.avg_speed)||0} km/h</td>
            <td>${Math.round(t.max_speed)||0} km/h</td>
            <td><span class="badge" style="background:${scoreColor(t.driving_score)}20;color:${scoreColor(t.driving_score)}">${t.driving_score||'—'}</span></td>
          </tr>`).join('')}
        </table>
      </div>
      <div class="footer"><span>OROS Mobility — Confidentiel</span><span>Page 1/1 · ${trips.length} trajets</span></div>
    </body></html>`;
    return html;
  } catch(e) { throw new Error('Erreur rapport trajets: ' + e.message); }
}

// ── RAPPORT REVENUS (PDF HTML) ─────────────────────────────────────────
async function generateRevenueReport(params = {}) {
  const { from, to, vehicleId } = params;
  try {
    let q = `
      SELECT rv.*, v.plate, v.brand, v.model, dr.name AS driver_name
      FROM revenues rv
      LEFT JOIN vehicles v ON v.id=rv.vehicle_id
      LEFT JOIN drivers dr ON dr.id=rv.driver_id
      WHERE rv.active=true
    `;
    const p = [];
    if (from)      { p.push(from);      q += ` AND rv.date >= $${p.length}`; }
    if (to)        { p.push(to);        q += ` AND rv.date <= $${p.length}`; }
    if (vehicleId) { p.push(vehicleId); q += ` AND rv.vehicle_id=$${p.length}`; }
    q += ' ORDER BY rv.date DESC, rv.created_at DESC';
    const r = await pool.query(q, p);
    const items = r.rows;

    const total     = items.reduce((s,r) => s+(Number(r.amount)||0), 0);
    const validated = items.filter(r=>r.validated).reduce((s,r) => s+(Number(r.amount)||0), 0);
    const methods   = {};
    items.forEach(r => { methods[r.payment_method] = (methods[r.payment_method]||0) + Number(r.amount||0); });

    const mLabels = {orange_money:'Orange Money',mtn_momo:'MTN MoMo',wave:'Wave',moov:'Moov',cash:'Espèces'};

    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Rapport Revenus</title>${PDF_CSS}</head><body>
      <div class="header">
        <div><div class="brand">OROS <span>Mobility</span></div><div style="font-size:11px;color:#7AA0C0;margin-top:4px">Rapport financier — Recettes</div></div>
        <div class="header-info"><strong>Période: ${fmtDate(from)} → ${fmtDate(to)||'Aujourd\'hui'}</strong>Généré le ${new Date().toLocaleDateString('fr-FR')}</div>
      </div>
      <div class="section">
        <div class="kpi-row">
          <div class="kpi"><div class="kpi-val">${fmtFCFA(total)}</div><div class="kpi-lbl">Total recettes</div></div>
          <div class="kpi"><div class="kpi-val" style="color:#16A34A">${fmtFCFA(validated)}</div><div class="kpi-lbl">Validé</div></div>
          <div class="kpi"><div class="kpi-val" style="color:#D97706">${fmtFCFA(total-validated)}</div><div class="kpi-lbl">En attente</div></div>
          <div class="kpi"><div class="kpi-val">${items.length}</div><div class="kpi-lbl">Transactions</div></div>
        </div>
        <div class="section-title">Répartition par mode de paiement</div>
        <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
          ${Object.entries(methods).map(([m,v]) => `<div class="kpi" style="flex:none"><div class="kpi-val" style="font-size:16px">${fmtFCFA(v)}</div><div class="kpi-lbl">${mLabels[m]||m}</div></div>`).join('')}
        </div>
        <div class="section-title">Détail des transactions</div>
        <table>
          <tr><th>Date</th><th>Véhicule</th><th>Conducteur</th><th>Mode paiement</th><th>Référence</th><th>Montant</th><th>Statut</th></tr>
          ${items.map(r => `<tr>
            <td>${fmtDate(r.date)}</td>
            <td>${r.plate||'—'}</td>
            <td>${r.driver_name||'—'}</td>
            <td>${mLabels[r.payment_method]||r.payment_method||'—'}</td>
            <td style="font-family:monospace;font-size:10px">${r.reference||'—'}</td>
            <td style="font-weight:700">${fmtFCFA(r.amount)}</td>
            <td><span class="badge ${r.validated?'badge-green':'badge-amber'}">${r.validated?'Validé':'En attente'}</span></td>
          </tr>`).join('')}
        </table>
      </div>
      <div class="footer"><span>OROS Mobility — Confidentiel</span><span>${items.length} transactions · Total: ${fmtFCFA(total)}</span></div>
    </body></html>`;
    return html;
  } catch(e) { throw new Error('Erreur rapport revenus: ' + e.message); }
}

// ── RAPPORT SCORES CONDUCTEURS (PDF HTML) ─────────────────────────────
async function generateDriverScoreReport(params = {}) {
  const { from, to } = params;
  try {
    const r = await pool.query(`
      SELECT dr.id, dr.name, dr.phone,
             ROUND(AVG(COALESCE(t.driving_score,70))) AS score,
             COUNT(t.id) AS trip_count,
             COALESCE(SUM(t.distance),0) AS total_km,
             COALESCE(SUM(t.harsh_brakes),0) AS brakes,
             COALESCE(SUM(t.harsh_accels),0) AS accels,
             COALESCE(SUM(t.over_speed_count),0) AS overspeeds,
             COALESCE(MAX(t.max_speed),0) AS peak_speed
      FROM drivers dr
      LEFT JOIN assignments a ON a.driver_id=dr.id
      LEFT JOIN vehicles v ON v.id=a.vehicle_id AND v.active=true
      LEFT JOIN trips t ON t.device_id=v.device_id
        AND ($1::date IS NULL OR t.start_time >= $1)
        AND ($2::date IS NULL OR t.end_time   <= $2)
        AND t.end_time IS NOT NULL
      WHERE dr.active=true
      GROUP BY dr.id, dr.name, dr.phone
      ORDER BY score DESC NULLS LAST
    `, [from||null, to||null]);

    const drivers = r.rows;

    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Scores Conducteurs</title>${PDF_CSS}</head><body>
      <div class="header">
        <div><div class="brand">OROS <span>Mobility</span></div><div style="font-size:11px;color:#7AA0C0;margin-top:4px">Rapport scores de conduite</div></div>
        <div class="header-info"><strong>Période: ${fmtDate(from)||'30 derniers jours'} → ${fmtDate(to)||'Aujourd\'hui'}</strong>Généré le ${new Date().toLocaleDateString('fr-FR')}</div>
      </div>
      <div class="section">
        <div class="section-title">Classement conducteurs</div>
        <table>
          <tr><th>#</th><th>Conducteur</th><th>Score</th><th>Mention</th><th>Trajets</th><th>Distance</th><th>Frein. brusques</th><th>Excès vitesse</th><th>Vit. max</th></tr>
          ${drivers.map((d,i) => `<tr>
            <td style="font-weight:700">${i+1}</td>
            <td>${d.name}</td>
            <td>
              <span style="font-size:16px;font-weight:800;color:${scoreColor(d.score)}">${d.score||'—'}</span>
              <div class="score-bar"><div class="score-fill" style="width:${d.score||0}%;background:${scoreColor(d.score)}"></div></div>
            </td>
            <td><span class="badge" style="background:${scoreColor(d.score)}20;color:${scoreColor(d.score)};font-size:12px;font-weight:800">${scoreGrade(d.score||0)}</span></td>
            <td>${d.trip_count}</td>
            <td>${fmtNum(d.total_km/1000,1)} km</td>
            <td><span class="${d.brakes>5?'badge badge-red':''}">${d.brakes}</span></td>
            <td><span class="${d.overspeeds>3?'badge badge-amber':''}">${d.overspeeds}</span></td>
            <td>${Math.round(d.peak_speed)} km/h</td>
          </tr>`).join('')}
        </table>
        <div style="margin-top:20px;padding:14px;background:#F8FAFD;border-radius:8px;font-size:11px;color:#6B7280">
          <strong style="color:#0F1923">Grille de notation:</strong>
          A (90-100) · B (75-89) · C (60-74) · D (40-59) · F (&lt;40) ·
          Score = Vitesse×35% + Freinage×25% + Accélérations×25% + Vitesse max×15%
        </div>
      </div>
      <div class="footer"><span>OROS Mobility — Confidentiel</span><span>${drivers.length} conducteurs analysés</span></div>
    </body></html>`;
    return html;
  } catch(e) { throw new Error('Erreur rapport scores: ' + e.message); }
}

// ── EXPORT CSV/EXCEL ──────────────────────────────────────────────────
function toCSV(headers, rows) {
  const escape = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const lines = [headers.map(escape).join(',')];
  rows.forEach(row => lines.push(row.map(escape).join(',')));
  return '\uFEFF' + lines.join('\r\n'); // BOM pour Excel
}

async function exportTripsCSV(params = {}) {
  const { from, to, imei } = params;
  const p = []; let cond = '';
  if (from) { p.push(from); cond += ` AND t.start_time>=$${p.length}`; }
  if (to)   { p.push(to);   cond += ` AND t.end_time<=$${p.length}`; }
  if (imei) { p.push(imei); cond += ` AND d.imei=$${p.length}`; }

  const r = await pool.query(`
    SELECT t.*, d.imei, d.name AS device_name,
           v.plate, v.brand, v.model, dr.name AS driver_name
    FROM trips t JOIN devices d ON d.id=t.device_id
    LEFT JOIN vehicles v ON v.device_id=d.id AND v.active=true
    LEFT JOIN assignments a ON a.vehicle_id=v.id AND t.start_time BETWEEN a.started_at AND COALESCE(a.ended_at,NOW())
    LEFT JOIN drivers dr ON dr.id=a.driver_id
    WHERE t.end_time IS NOT NULL ${cond} ORDER BY t.start_time DESC LIMIT 10000
  `, p);

  const headers = ['Date','Heure début','Heure fin','IMEI','Plaque','Véhicule','Conducteur','Distance (km)','Durée (min)','Vit. moy (km/h)','Vit. max (km/h)','Frein. brusques','Excès vitesse','Score'];
  const rows = r.rows.map(t => [
    fmtDate(t.start_time), fmtTime(t.start_time), fmtTime(t.end_time),
    t.imei, t.plate||'', `${t.brand||''} ${t.model||''}`.trim(),
    t.driver_name||'',
    fmtNum(t.distance,2), t.duration_minutes||0,
    Math.round(t.avg_speed||0), Math.round(t.max_speed||0),
    t.harsh_brakes||0, t.over_speed_count||0, t.driving_score||'',
  ]);
  return toCSV(headers, rows);
}

async function exportRevenuesCSV(params = {}) {
  const { from, to, vehicleId } = params;
  const p = []; let cond = '';
  if (from)      { p.push(from);      cond += ` AND rv.date>=$${p.length}`; }
  if (to)        { p.push(to);        cond += ` AND rv.date<=$${p.length}`; }
  if (vehicleId) { p.push(vehicleId); cond += ` AND rv.vehicle_id=$${p.length}`; }

  const r = await pool.query(`
    SELECT rv.*, v.plate, v.brand, v.model, dr.name AS driver_name
    FROM revenues rv LEFT JOIN vehicles v ON v.id=rv.vehicle_id LEFT JOIN drivers dr ON dr.id=rv.driver_id
    WHERE rv.active=true ${cond} ORDER BY rv.date DESC
  `, p);

  const mLabels = {orange_money:'Orange Money',mtn_momo:'MTN MoMo',wave:'Wave',moov:'Moov',cash:'Espèces'};
  const headers = ['Date','Plaque','Véhicule','Conducteur','Mode paiement','Référence','Montant (FCFA)','Validé'];
  const rows = r.rows.map(rv => [
    fmtDate(rv.date), rv.plate||'', `${rv.brand||''} ${rv.model||''}`.trim(),
    rv.driver_name||'', mLabels[rv.payment_method]||rv.payment_method||'',
    rv.reference||'', rv.amount||0, rv.validated?'Oui':'Non',
  ]);
  return toCSV(headers, rows);
}

module.exports = {
  generateTripsReport, generateRevenueReport, generateDriverScoreReport,
  exportTripsCSV, exportRevenuesCSV,
};
