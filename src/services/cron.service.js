const cron = require('node-cron');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);
const Subscription = require('../models/Subscription');

const SUSPEND_AFTER_DAYS = 5; // Suspension après 5 jours de retard

const startCronJobs = () => {
  console.log('⏱️  Cron jobs démarrés');

  // Toutes les heures : mettre à jour les statuts
  cron.schedule('0 * * * *', async () => {
    try {
      const now = dayjs.utc().toDate();
      const suspendThreshold = dayjs.utc().subtract(SUSPEND_AFTER_DAYS, 'day').toDate();

      // 1. Actifs → En retard (date dépassée)
      const overdueResult = await Subscription.updateMany(
        { status: 'active', endDate: { $lt: now } },
        { $set: { status: 'overdue' } }
      );

      // 2. En retard → Suspendu (après X jours)
      const suspendedResult = await Subscription.updateMany(
        { status: 'overdue', endDate: { $lt: suspendThreshold } },
        { $set: { status: 'suspended' } }
      );

      if (overdueResult.modifiedCount > 0 || suspendedResult.modifiedCount > 0) {
        console.log(`🔄 Cron: ${overdueResult.modifiedCount} → overdue, ${suspendedResult.modifiedCount} → suspended`);
      }
    } catch (err) {
      console.error('❌ Erreur cron statuts:', err.message);
    }
  });

  // Chaque jour à 8h UTC : log des abonnements expirant dans 3 jours
  cron.schedule('0 8 * * *', async () => {
    try {
      const in3Days = dayjs.utc().add(3, 'day').toDate();
      const now = dayjs.utc().toDate();
      const expiringSoon = await Subscription.find({
        status: 'active',
        endDate: { $gte: now, $lte: in3Days },
      }).populate('clientId', 'name phone').populate('accountId', 'service');

      if (expiringSoon.length) {
        console.log(`📲 ${expiringSoon.length} abonnements expirent dans 3 jours`);
      }
    } catch (err) {
      console.error('❌ Erreur cron rappels:', err.message);
    }
  });
};

module.exports = { startCronJobs };
