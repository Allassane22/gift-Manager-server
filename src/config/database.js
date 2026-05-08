const dns = require('dns');
const mongoose = require('mongoose');

// Force Node to use public DNS servers for SRV resolution
// MongoDB Atlas requires SRV lookups for mongodb+srv URIs.
dns.setServers(['1.1.1.1', '8.8.8.8']);

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      dbName: 'digiresell',
    });
    console.log(`✅ MongoDB connecté: ${conn.connection.host}`);
  } catch (error) {
    console.error('❌ Erreur connexion MongoDB:', error.message);
    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB déconnecté');
});

module.exports = { connectDB };
