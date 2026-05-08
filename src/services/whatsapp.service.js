const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Génère un lien WhatsApp avec message pré-rempli
 * @param {Object} params
 * @param {string} params.phone - Numéro international (ex: +212612345678)
 * @param {string} params.clientName - Prénom du client
 * @param {string} params.service - Nom du service (Netflix, etc.)
 * @param {Date}   params.endDate - Date d'expiration UTC
 * @param {number} params.amount - Montant à payer
 * @param {string} params.type - Type de message: 'reminder' | 'expired' | 'renewal'
 */
const generateWhatsAppLink = ({ phone, clientName, service, endDate, amount, type = 'reminder' }) => {
  const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
  const dateFormatted = dayjs.utc(endDate).format('DD/MM/YYYY');
  const firstName = clientName.split(' ')[0];

  const messages = {
    reminder: `Bonjour ${firstName} 👋\n\nVotre abonnement *${service}* expire le *${dateFormatted}*.\n💰 Montant : *${amount} DH*\n\nRenouvelez maintenant pour ne pas perdre l'accès ! ✅`,
    expired: `Bonjour ${firstName},\n\nVotre abonnement *${service}* a expiré le *${dateFormatted}*.\n💰 Pour le renouveler : *${amount} DH*\n\nContactez-nous dès que possible 🙏`,
    renewal: `Bonjour ${firstName} ✅\n\nVotre abonnement *${service}* a été renouvelé avec succès !\n📅 Nouvelle date d'expiration : *${dateFormatted}*\n\nMerci pour votre confiance 🎉`,
  };

  const message = messages[type] || messages.reminder;
  const encodedMessage = encodeURIComponent(message);

  return `https://wa.me/${cleanPhone}?text=${encodedMessage}`;
};

/**
 * Génère les liens pour tous les abonnements expirant bientôt
 */
const generateBatchReminderLinks = (subscriptions) => {
  return subscriptions.map(sub => ({
    subscriptionId: sub._id,
    clientName: sub.clientId?.name,
    service: sub.accountId?.service,
    link: generateWhatsAppLink({
      phone: sub.clientId?.phone,
      clientName: sub.clientId?.name,
      service: sub.accountId?.service,
      endDate: sub.endDate,
      amount: sub.pricePaid,
      type: 'reminder',
    }),
  }));
};

module.exports = { generateWhatsAppLink, generateBatchReminderLinks };
