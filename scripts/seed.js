require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Account = require('../src/models/Account');
const Profile = require('../src/models/Profile');
const Client = require('../src/models/Client');

const seed = async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'digiresell' });
  console.log('✅ Connecté à MongoDB');

  // Nettoyer
  await Promise.all([
    User.deleteMany({}),
    Account.deleteMany({}),
    Profile.deleteMany({}),
    Client.deleteMany({}),
  ]);

  // Admin
  const admin = await User.create({
    name: 'Admin DigiResell',
    email: process.env.ADMIN_EMAIL || 'admin@digiresell.com',
    password: process.env.ADMIN_PASSWORD || 'Admin@123456',
    role: 'admin',
  });
  console.log(`👤 Admin créé: ${admin.email}`);

  // Partenaire
  const partner = await User.create({
    name: 'Rachid Distribution',
    email: 'rachid@digiresell.com',
    password: 'Partner@123456',
    role: 'partner',
    phone: '+212612345678',
  });
  console.log(`🤝 Partenaire créé: ${partner.email}`);

  // Comptes Netflix Essentiel (5 slots)
  const nfEss = await Account.create({
    service: 'Netflix', type: 'Essentiel',
    email: 'netflix.ess1@gmail.com', password: 'Pass@123',
    purchasePrice: 4,
  });

  // Netflix Premium
  const nfPrem = await Account.create({
    service: 'Netflix', type: 'Premium',
    email: 'netflix.prem1@gmail.com', password: 'Pass@456',
    purchasePrice: 10,
  });

  // Prime Video
  const pv = await Account.create({
    service: 'Prime Video', type: 'Essentiel',
    email: 'prime.ess1@gmail.com', password: 'Pass@789',
    purchasePrice: 3,
  });

  // PlayStation
  const ps = await Account.create({
    service: 'PlayStation', type: 'Standard',
    email: 'ps1@gmail.com', password: 'Pass@101',
    purchasePrice: 8,
  });

  console.log(`📺 ${4} comptes créés`);

  // Profils Netflix Essentiel (5 profils)
  const nfProfiles = await Profile.insertMany([1,2,3,4,5].map(i => ({
    accountId: nfEss._id, name: `Profil ${i}`,
  })));

  // Profils Netflix Premium (1)
  await Profile.create({ accountId: nfPrem._id, name: 'Profil 1' });

  // Profils Prime Video (6)
  await Profile.insertMany([1,2,3,4,5,6].map(i => ({
    accountId: pv._id, name: `Profil ${i}`,
  })));

  // Profils PlayStation (2)
  await Profile.insertMany([
    { accountId: ps._id, name: 'Profil A' },
    { accountId: ps._id, name: 'Profil B' },
  ]);

  console.log('🎭 Profils créés');

  // Clients de test
  await Client.insertMany([
    { name: 'Karim Benali', phone: '+212612345678', referredBy: partner._id },
    { name: 'Sara Mouhssine', phone: '+212698765432' },
    { name: 'Youssef Tahiri', phone: '+212655443322' },
  ]);

  console.log('👥 Clients créés');
  console.log('\n✅ Seed terminé avec succès !');
  console.log(`\n🔑 Connexion admin:\n   Email: ${admin.email}\n   Password: Admin@123456`);

  await mongoose.disconnect();
};

seed().catch(err => {
  console.error('❌ Erreur seed:', err);
  process.exit(1);
});
