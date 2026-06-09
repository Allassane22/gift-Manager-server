/**
 * fix-activation-template.js
 * Corrige le template "activation" avec les bons emojis
 *
 * Usage : node fix-activation-template.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const dns = require('dns');
dns.setServers(['1.1.1.1', '8.8.8.8']);

const WhatsAppTemplate = require('./src/models/WhatsAppTemplate');

const e = {
  check:   '\u2705',   // ✅
  person:  '\uD83D\uDC64', // 👤
  lock:    '\uD83D\uDD12', // 🔒
  email:   '\uD83D\uDCE7', // 📧
  key:     '\uD83D\uDD11', // 🔑
  cal:     '\uD83D\uDCC5', // 📅
  info:    '\u2139\uFE0F', // ℹ️
  pray:    '\uD83D\uDE4F', // 🙏
  party:   '\uD83C\uDF89', // 🎉
};

const newBody =
  `Votre compte {{service}} a bien \u00e9t\u00e9 activ\u00e9 ${e.check}\n\n` +
  `Voici vos informations de connexion :\n` +
  `${e.person} Nom du profil : {{profil}}\n` +
  `${e.lock} Code PIN : {{pin}}\n` +
  `${e.email} Email : {{email}}\n` +
  `${e.key} Mot de passe : {{motdepasse}}\n` +
  `${e.cal} Le r\u00e9abonnement est pr\u00e9vu pour le {{date}}, avec une remise anticip\u00e9e d\u00e9j\u00e0 prise en compte.\n\n` +
  `${e.info} Pour toute question, ce num\u00e9ro est disponible 24h/24.\n` +
  `Merci pour votre confiance ${e.pray}\n` +
  `\u2014 \u0272\u025bnaj\u025b ${e.party}`;

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'digiresell' });
  console.log('\u2705 Connect\u00e9 \u00e0 MongoDB\n');

  // Afficher ce qui est actuellement en base
  const current = await WhatsAppTemplate.findOne({ type: 'activation', deletedAt: null }).lean();
  if (!current) {
    console.log('\u26a0\ufe0f Template "activation" introuvable en base');
    await mongoose.disconnect();
    return;
  }

  console.log('Body actuel en base :');
  console.log(current.body);
  console.log('\n--- Codes des 3 premiers caractères spéciaux ---');
  for (const char of current.body) {
    const code = char.codePointAt(0);
    if (code > 127) console.log(`  '${char}' = U+${code.toString(16).toUpperCase()}`);
    if ([...current.body].filter(c => c.codePointAt(0) > 127).indexOf(char) > 5) break;
  }

  // Mettre à jour avec les bons emojis
  await WhatsAppTemplate.findOneAndUpdate(
    { type: 'activation', deletedAt: null },
    { $set: { body: newBody } }
  );

  console.log('\n\u2705 Template "activation" mis \u00e0 jour avec les bons emojis');
  console.log('\nNouveau body :');
  console.log(newBody);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('\u274c Erreur:', err.message);
  process.exit(1);
});
