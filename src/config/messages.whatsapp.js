/**
 * messages.whatsapp.js
 * ─────────────────────────────────────────────────────────────────
 * Templates de messages WhatsApp configurables.
 *
 * Variables disponibles (interpolées automatiquement) :
 *   {{prenom}}     → premier mot du nom client
 *   {{service}}    → nom du service (Netflix, Spotify…)
 *   {{date}}       → date d'expiration formatée (DD/MM/YYYY)
 *   {{montant}}    → montant en FCFA
 *   {{numero}}     → numéro de paiement Wave/Orange Money
 *
 * Pour modifier un message : éditez simplement le texte entre backticks.
 * Ne pas supprimer les balises {{…}}, elles sont remplacées dynamiquement.
 * ─────────────────────────────────────────────────────────────────
 */

const WHATSAPP_MESSAGES = {

  // Rappel avant expiration (envoyé ~7j avant)
  reminder: `Bonjour {{prenom}} 👋

Votre abonnement *{{service}}* expire le *{{date}}*.
💰 Montant du renouvellement : *{{montant}} FCFA*

Renouvelez maintenant pour ne pas perdre l'accès ! ✅
Paiement via Wave / Orange Money au *{{numero}}*`,

  // Abonnement expiré (statut overdue)
  expired: `Bonjour {{prenom}},

Votre abonnement *{{service}}* a expiré le *{{date}}*.
💰 Pour le renouveler : *{{montant}} FCFA*

Contactez-nous dès que possible 🙏
Paiement via Wave / Orange Money au *{{numero}}*`,

  // Confirmation de renouvellement
  renewal: `Bonjour {{prenom}} ✅

Votre abonnement *{{service}}* a été renouvelé avec succès !
📅 Valable jusqu'au : *{{date}}*

Merci pour votre confiance 🎉`,

  // Demande de paiement / preuve
  payment_request: `Bonjour {{prenom}} 👋

Votre abonnement *{{service}}* est prêt.
💰 Montant : *{{montant}} FCFA*

Merci d'effectuer le paiement via Wave ou Orange Money au *{{numero}}* puis de nous envoyer la capture d'écran de confirmation. 📲`,

  // Confirmation de réception du paiement
  payment_confirmed: `Bonjour {{prenom}} ✅

Votre paiement de *{{montant}} FCFA* pour *{{service}}* a bien été reçu.
🎉 Votre accès est activé — bonne lecture !`,
};

// Numéro de paiement par défaut (Wave / Orange Money)
const PAYMENT_NUMBER = '+223 93 68 59 78';

module.exports = { WHATSAPP_MESSAGES, PAYMENT_NUMBER };
