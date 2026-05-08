const mongoose = require('mongoose');
const Account = require('../models/Account');
const Profile = require('../models/Profile');
const Subscription = require('../models/Subscription');
const Client = require('../models/Client');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

/**
 * Trouve automatiquement le meilleur compte + profil disponible
 * pour un service donné (load balancing)
 */
const findAvailableSlot = async (service, preferredAccountId = null) => {
  // 1. Trouver tous les comptes actifs du service
  const accounts = await Account.find({
    service,
    isActive: true,
    ...(preferredAccountId && { _id: preferredAccountId }),
  }).populate({
    path: 'profiles',
    match: { deletedAt: null, isActive: true },
  });

  if (!accounts.length) {
    throw { status: 404, message: `Aucun compte ${service} disponible` };
  }

  // 2. Pour chaque compte, trouver les profils libres
  let bestAccount = null;
  let bestProfile = null;
  let bestLoadRatio = Infinity;

  for (const account of accounts) {
    const profiles = await Profile.find({
      accountId: account._id,
      isActive: true,
      deletedAt: null,
    });

    const usedSlots = profiles.filter(p => !p.isFreeTrial && p.assignedClients.length > 0).length;
    const loadRatio = usedSlots / account.maxSlots;

    const freeProfile = profiles.find(p => p.isAvailable && !p.isFreeTrial);

    if (freeProfile && loadRatio < bestLoadRatio) {
      bestLoadRatio = loadRatio;
      bestAccount = account;
      bestProfile = freeProfile;
    }
  }

  if (!bestAccount || !bestProfile) {
    throw { status: 409, message: `Tous les profils ${service} sont occupés` };
  }

  return { account: bestAccount, profile: bestProfile };
};

/**
 * Création d'un abonnement avec transaction atomique
 * profit + commission calculés automatiquement
 */
const createSubscription = async ({
  clientId,
  service,
  accountId,         // optionnel : forcer un compte précis
  profileId,         // optionnel : forcer un profil précis
  partnerId,
  startDate,
  endDate,
  purchasePrice,
  pricePaid,
  commissionType = 'none',
  commissionValue = 0,
  doneBy,
}) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // A. Trouver le slot si non précisé
    let account, profile;
    if (profileId && accountId) {
      account = await Account.findById(accountId).session(session);
      profile = await Profile.findById(profileId).session(session);
      if (!profile || profile.assignedClients.length > 0) {
        throw { status: 409, message: 'Ce profil est déjà occupé' };
      }
    } else {
      const slot = await findAvailableSlot(service, accountId);
      account = slot.account;
      profile = slot.profile;
    }

    // B. Créer l'abonnement (profit auto-calculé dans le pre-save)
    const [subscription] = await Subscription.create([{
      clientId,
      accountId: account._id,
      profileId: profile._id,
      partnerId: partnerId || null,
      startDate,
      endDate,
      purchasePrice,
      pricePaid,
      commissionType,
      commissionValue,
      status: 'active',
    }], { session });

    // C. Assigner le client au profil
    profile.assignedClients.push(clientId);
    await profile.save({ session });

    // D. Mettre à jour stats client (atomique)
    await Client.findByIdAndUpdate(
      clientId,
      {
        $inc: { totalPaid: pricePaid, totalSubscriptions: 1 },
      },
      { session }
    );

    // E. Mettre à jour stats partenaire si applicable
    if (partnerId) {
      await User.findByIdAndUpdate(
        partnerId,
        {
          $inc: {
            totalRevenue: pricePaid,
            totalCommission: subscription.commissionAmount,
            totalSubscriptions: 1,
          },
        },
        { session }
      );
    }

    // F. Audit log
    await AuditLog.create([{
      userId: doneBy,
      action: 'CREATE_SUBSCRIPTION',
      targetModel: 'Subscription',
      targetId: subscription._id,
      details: {
        service,
        accountId: account._id,
        profileId: profile._id,
        profit: subscription.profit,
      },
    }], { session });

    await session.commitTransaction();

    return subscription;

  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Renouveler un abonnement existant
 */
const renewSubscription = async ({ subscriptionId, newEndDate, newPricePaid, doneBy }) => {
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) throw { status: 404, message: 'Abonnement introuvable' };

  subscription.history.push({
    action: 'renewed',
    note: `Renouvellement: ${subscription.endDate} → ${newEndDate}`,
    doneBy,
    at: new Date(),
  });

  subscription.endDate = newEndDate;
  if (newPricePaid !== undefined) subscription.pricePaid = newPricePaid;
  subscription.status = 'active';

  await subscription.save();
  return subscription;
};

/**
 * Migrer un client vers un autre compte/profil
 */
const migrateSubscription = async ({ subscriptionId, newAccountId, newProfileId, reason, doneBy }) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const subscription = await Subscription.findById(subscriptionId).session(session);
    if (!subscription) throw { status: 404, message: 'Abonnement introuvable' };

    const newProfile = await Profile.findById(newProfileId).session(session);
    if (!newProfile || !newProfile.isAvailable) {
      throw { status: 409, message: 'Nouveau profil indisponible' };
    }

    // Libérer l'ancien profil
    await Profile.findByIdAndUpdate(
      subscription.profileId,
      { $pull: { assignedClients: subscription.clientId } },
      { session }
    );

    // Assigner au nouveau
    newProfile.assignedClients.push(subscription.clientId);
    await newProfile.save({ session });

    // Historique
    subscription.history.push({
      action: 'migrated',
      fromAccountId: subscription.accountId,
      fromProfileId: subscription.profileId,
      note: reason || 'Migration de compte',
      doneBy,
    });

    subscription.accountId = newAccountId;
    subscription.profileId = newProfileId;
    await subscription.save({ session });

    await session.commitTransaction();
    return subscription;

  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

module.exports = { findAvailableSlot, createSubscription, renewSubscription, migrateSubscription };
