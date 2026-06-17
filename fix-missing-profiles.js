/**
 * fix-missing-profiles.js
 * Vérifie que chaque compte a bien le bon nombre de profils
 * et crée les profils manquants si nécessaire.
 *
 * Usage : node fix-missing-profiles.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const dns = require('dns');
dns.setServers(['1.1.1.1', '8.8.8.8']);

const Account = require('./src/models/Account');
const Profile = require('./src/models/Profile');

function generateProfileNames(service, count) {
  const names = [];
  for (let i = 1; i <= count; i++) {
    names.push(`Profil ${i}`);
  }
  return names;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'digiresell' });
  console.log('✅ Connecté à MongoDB\n');

  const accounts = await Account.find({ deletedAt: null }).lean();
  console.log(`🔍 ${accounts.length} comptes trouvés\n`);

  let fixed = 0;

  for (const account of accounts) {
    const profiles = await Profile.find({ accountId: account._id, deletedAt: null }).lean();
    const currentCount = profiles.length;
    const expectedCount = account.maxSlots || 0;

    console.log(`📦 ${account.service} ${account.type} (${account.email}) — ${currentCount}/${expectedCount} profils`);

    if (currentCount < expectedCount) {
      const toCreate = expectedCount - currentCount;
      const allNames = generateProfileNames(account.service, expectedCount);
      const newNames = allNames.slice(currentCount);

      await Profile.insertMany(
        newNames.slice(0, toCreate).map(name => ({
          accountId: account._id,
          name,
          isActive: true,
          assignedClients: [],
        }))
      );

      console.log(`  ✅ ${toCreate} profil(s) manquant(s) créé(s)\n`);
      fixed++;
    } else {
      console.log(`  ✓ OK\n`);
    }
  }

  console.log(`🎉 Terminé — ${fixed} compte(s) corrigé(s)`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Erreur:', err.message);
  process.exit(1);
});
