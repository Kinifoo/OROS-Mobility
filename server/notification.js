/**
 * OROS — Module de notifications multi-canaux
 * Canaux: Email (SMTP), SMS simulé (Orange CI / Wave / MTN)
 * En production: brancher l'API Orange Business ou infobip
 */
'use strict';

const nodemailer = require('nodemailer');
const axios      = require('axios');
const logger     = require('./utils/logger');

// ── Config SMTP ───────────────────────────────────────────────────────
let transporter = null;
function getMailer() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;
  transporter = nodemailer.createTransporter({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

// ── Email ─────────────────────────────────────────────────────────────
async function sendEmail({ to, subject, html, text }) {
  const mailer = getMailer();
  if (!mailer) {
    logger.info(`[EMAIL] (non configuré) → ${to}: ${subject}`);
    return false;
  }
  try {
    await mailer.sendMail({
      from:    `"Oros Mobility" <${process.env.SMTP_USER}>`,
      to, subject, html,
      text: text || html.replace(/<[^>]+>/g, ''),
    });
    logger.info(`[EMAIL] Envoyé → ${to}: ${subject}`);
    return true;
  } catch (e) {
    logger.error('[EMAIL] Erreur: ' + e.message);
    return false;
  }
}

// ── SMS ───────────────────────────────────────────────────────────────
// Adaptateur multi-opérateurs CI
// En production, remplacer par l'API de ton agrégateur SMS
async function sendSMS({ to, message }) {
  const phone = normalizePhone(to);
  if (!phone) { logger.warn(`[SMS] Numéro invalide: ${to}`); return false; }

  // Priorité: Orange Business API
  if (process.env.ORANGE_SMS_API) {
    return sendOrangeSMS(phone, message);
  }
  // Fallback: Infobip
  if (process.env.INFOBIP_API_KEY) {
    return sendInfobipSMS(phone, message);
  }
  // Fallback: Twilio
  if (process.env.TWILIO_SID && process.env.TWILIO_TOKEN) {
    return sendTwilioSMS(phone, message);
  }

  // Mode simulation (développement)
  logger.info(`[SMS] SIMULATION → ${phone}: ${message}`);
  return true;
}

async function sendOrangeSMS(to, message) {
  try {
    // Orange Business Services API
    const resp = await axios.post('https://api.orange.com/smsmessaging/v1/outbound/tel%3A%2B225000000000/requests', {
      outboundSMSMessageRequest: {
        address: [`tel:${to}`],
        senderAddress: `tel:+${process.env.ORANGE_SMS_SENDER || '225000000000'}`,
        outboundSMSTextMessage: { message },
        senderName: process.env.ORANGE_SMS_SENDER_NAME || 'OrosMobility',
      }
    }, {
      headers: {
        Authorization: `Bearer ${process.env.ORANGE_SMS_API}`,
        'Content-Type': 'application/json',
      }
    });
    logger.info(`[SMS] Orange → ${to}: OK`);
    return true;
  } catch (e) {
    logger.error('[SMS] Orange erreur: ' + (e.response?.data?.message || e.message));
    return false;
  }
}

async function sendInfobipSMS(to, message) {
  try {
    await axios.post('https://api.infobip.com/sms/2/text/single', {
      from: process.env.INFOBIP_SENDER || 'OrosMobility',
      to, text: message
    }, {
      headers: {
        Authorization: `App ${process.env.INFOBIP_API_KEY}`,
        'Content-Type': 'application/json',
      }
    });
    logger.info(`[SMS] Infobip → ${to}: OK`);
    return true;
  } catch (e) {
    logger.error('[SMS] Infobip erreur: ' + e.message);
    return false;
  }
}

async function sendTwilioSMS(to, message) {
  try {
    const auth = Buffer.from(`${process.env.TWILIO_SID}:${process.env.TWILIO_TOKEN}`).toString('base64');
    await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`,
      new URLSearchParams({ To: to, From: process.env.TWILIO_FROM, Body: message }),
      { headers: { Authorization: `Basic ${auth}` } }
    );
    logger.info(`[SMS] Twilio → ${to}: OK`);
    return true;
  } catch (e) {
    logger.error('[SMS] Twilio erreur: ' + e.message);
    return false;
  }
}

function normalizePhone(phone) {
  if (!phone) return null;
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (/^\+\d{10,15}$/.test(cleaned)) return cleaned;
  if (/^0\d{9}$/.test(cleaned)) return '+225' + cleaned.slice(1);
  if (/^\d{10}$/.test(cleaned)) return '+225' + cleaned;
  return cleaned.startsWith('+') ? cleaned : null;
}

// ── Templates ─────────────────────────────────────────────────────────
const templates = {
  alertOverspeed: (device, speed, limit) => ({
    subject: `⚠️ Survitesse — ${device}`,
    html: `<h2>Survitesse détectée</h2><p>Le véhicule <strong>${device}</strong> roule à <strong>${speed} km/h</strong> (limite: ${limit} km/h).</p><p>Connectez-vous à votre dashboard Oros Mobility pour plus de détails.</p>`,
    sms: `OROS: Survitesse ${device} - ${speed}km/h (limite ${limit}km/h). Vérifiez votre dashboard.`
  }),

  alertGeofence: (device, zone, action) => ({
    subject: `📍 ${action === 'exit' ? 'Sortie' : 'Entrée'} zone — ${device}`,
    html: `<h2>Alerte géofence</h2><p>Le véhicule <strong>${device}</strong> a ${action === 'exit' ? 'quitté' : 'pénétré dans'} la zone <strong>${zone}</strong>.</p>`,
    sms: `OROS: ${device} ${action === 'exit' ? 'sort de' : 'entre dans'} "${zone}"`
  }),

  alertOffline: (device) => ({
    subject: `🔴 Traceur hors ligne — ${device}`,
    html: `<h2>Traceur hors ligne</h2><p>Le traceur <strong>${device}</strong> n'envoie plus de données depuis 5 minutes.</p>`,
    sms: `OROS: Traceur ${device} hors ligne depuis 5 min.`
  }),

  revenueCheck: (vehicle, driver, date) => ({
    subject: `💰 Vérification recette — ${vehicle}`,
    html: `<h2>Recette J-1</h2><p>Avez-vous reçu la recette du <strong>${date}</strong> pour le véhicule <strong>${vehicle}</strong> (conducteur: ${driver}) ?</p><p>Répondez via l'application Oros Mobility.</p>`,
    sms: `OROS Mobility: Avez-vous reçu la recette J-1 de ${vehicle} (${driver}) ? Validez sur l'app avant 08h00.`
  }),

  driverWarning: (driver, vehicle, countdowns) => ({
    subject: `⚠️ Recette non versée — ${vehicle}`,
    html: `<h2>Avertissement recette</h2><p>Conducteur <strong>${driver}</strong>, la recette du véhicule <strong>${vehicle}</strong> n'a pas été validée.</p><p>Vous avez <strong>${countdowns}</strong> pour régulariser avant immobilisation automatique à 10h00.</p>`,
    sms: `OROS: ${driver}, recette ${vehicle} non reçue. Régularisez dans ${countdowns} ou immobilisation à 10h00.`
  }),

  immobilizationWarning: (driver, vehicle) => ({
    sms: `OROS URGENT: ${driver}, recette ${vehicle} impayée. IMMOBILISATION dans 30 min si non régularisée. Contactez votre gestionnaire.`
  }),

  immobilizationDone: (vehicle, driver) => ({
    subject: `🚫 Véhicule immobilisé — ${vehicle}`,
    html: `<h2>Immobilisation exécutée</h2><p>Le véhicule <strong>${vehicle}</strong> a été immobilisé automatiquement à 10h00 (recette non versée).</p><p>Conducteur: ${driver}</p>`,
    sms: `OROS: Véhicule ${vehicle} IMMOBILISÉ. Contactez votre gestionnaire pour régulariser.`
  }),

  extensionGranted: (driver, vehicle, until) => ({
    sms: `OROS: Prorogation accordée pour ${vehicle}. Vous pouvez circuler jusqu'à ${until}. Régularisez la recette.`
  }),
};

module.exports = { sendEmail, sendSMS, templates };
