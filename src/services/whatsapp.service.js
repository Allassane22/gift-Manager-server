// services/whatsapp.service.js

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const WhatsAppTemplate = require('../models/WhatsAppTemplate');

// ─── Constantes ──────────────────────────────────────────────────────────────
const PAYMENT_NUMBER = '+223 93 68 59 78';

// Message de fallback si le template est absent en base
const FALLBACK_BODY = `Bonjour {{prenom}} 👋

Votre abonnement *{{service}}* — *{{date}}* — *{{montant}} FCFA*

Contactez-nous pour plus d'informations.
Paiement via Wave / Orange Money au *{{numero}}*`;

// ─── Interpolation des variables {{…}} ───────────────────────────────────────
/**
 * Remplace toutes les occurrences de {{variable}} dans un template string.
 * @param {string} body     - Texte brut avec {{…}}
 * @param {Object} vars     - Dictionnaire { prenom, service, date, montant, numero }
 * @returns {string}
 */
const interpolate = (body, vars) => {
  return body
    .replace(/{{prenom}}/g,  vars.prenom  ?? '')
    .replace(/{{service}}/g, vars.service ?? '')
    .replace(/{{date}}/g,    vars.date    ?? '')
    .replace(/{{montant}}/g, vars.montant ?? '')
    .replace(/{{numero}}/g,  vars.numero  ?? PAYMENT_NUMBER);
};

// ─── Génération d'un lien WhatsApp ───────────────────────────────────────────
/**
 * Génère un lien WhatsApp avec message pré-rempli.
 * Cherche le template en base ; fallback sur FALLBACK_BODY si absent.
 *
 * @param {Object} params
 * @param {string} params.phone        - Numéro international (ex: +22393685978)
 * @param {string} params.clientName   - Nom complet du client
 * @param {string} params.service      - Nom du service (Netflix, Spotify…)
 * @param {Date}   params.endDate      - Date d'expiration (UTC)
 * @param {number} params.amount       - Montant en FCFA
 * @param {string} [params.type]       - Type de template (défaut: 'reminder')
 * @param {string} [params.numero]     - Numéro Wave/OM (défaut: PAYMENT_NUMBER)
 * @returns {Promise<string>}          - URL wa.me/…
 */
const generateWhatsAppLink = async ({
  phone,
  clientName,
  service,
  endDate,
  amount,
  type = 'reminder',
  numero = PAYMENT_NUMBER,
}) => {
  // 1. Récupération du template en base
  let body = FALLBACK_BODY;

  try {
    const template = await WhatsAppTemplate.findOne({
      type,
      isActive: true,
      deletedAt: null,
    });

    if (template?.body) {
      body = template.body;
    } else {
      console.warn(`[whatsapp.service] Template "${type}" introuvable en base — fallback utilisé`);
    }
  } catch (err) {
    console.error('[whatsapp.service] Erreur lors du lookup du template:', err.message);
    // On continue avec le fallback, on ne plante pas
  }

  // 2. Préparation des variables
  const vars = {
    prenom:  clientName ? clientName.split(' ')[0] : '',
    service: service ?? '',
    date:    endDate ? dayjs.utc(endDate).format('DD/MM/YYYY') : '',
    montant: amount != null ? String(amount) : '',
    numero,
  };

  // 3. Interpolation + encodage
  const cleanPhone    = phone.replace(/[\s\-\(\)]/g, '');
  const message       = interpolate(body, vars);
  const encodedMessage = encodeURIComponent(message);

  return `https://wa.me/${cleanPhone}?text=${encodedMessage}`;
};

// ─── Génération en batch (rappels) ───────────────────────────────────────────
/**
 * Génère les liens WhatsApp pour une liste d'abonnements expirant bientôt.
 * @param {Array}  subscriptions
 * @returns {Promise<Array>}
 */
const generateBatchReminderLinks = async (subscriptions) => {
  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => ({
      subscriptionId: sub._id,
      clientName: sub.clientId?.name,
      service: sub.accountId?.service,
      link: await generateWhatsAppLink({
        phone:      sub.clientId?.phone,
        clientName: sub.clientId?.name,
        service:    sub.accountId?.service,
        endDate:    sub.endDate,
        amount:     sub.pricePaid,
        type:       'reminder',
      }),
    }))
  );

  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
};

module.exports = { generateWhatsAppLink, generateBatchReminderLinks, PAYMENT_NUMBER };