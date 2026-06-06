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
  const accounts = await Account.find({
    service,
    isActive: true,
    ...(preferredAccountId && { _id: preferredAccountId }),
  });

  if (!accounts.length) {
    throw { status: 404, message: `Aucun compte ${service} disponible` };
  }

  let bestAccount = null;
  let bestProfile = null;
  let bestLoadRatio = Infinity;

  for (const account of accounts) {
    // FIX B7 : populate('assignedClients') pour que le virtual isAvailable
    // calcule assignedClients.length === 0 sur des documents réels et non des ObjectIds bruts
    const profiles = await Profile.find({
      accountId: account._id,
      isActive: true,
      deletedAt: null,
    }).populate('assignedClients');

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
 * Création d'un abonnement SANS transaction (Atlas M0 incompatible).
 * Rollback manuel en cas d'erreur à mi-chemin.
 * Ordre des opérations :
 *   1. Trouver le slot
 *   2. Créer l'abonnement
 *   3. Assigner le client au profil  → rollback: supprimer l'abonnement
 *   4. Màj stats client              → rollback: désassigner + supprimer
 *   5. Màj stats partenaire          → rollback: décrémenter + désassigner + supprimer
 *   6. Audit log (best-effort, pas de rollback)
 */
const createSubscription = async ({
  clientId,
  service,
  accountId,
  profileId,
  partnerId,
  startDate,
  endDate,
  purchasePrice,
  pricePaid,
  commissionType = 'none',
  commissionValue = 0,
  doneBy,
  initialStatus = 'active', // 'pending_payment' si le client n'a pas encore payé
}) => {
  // ── 1. Trouver le slot ────────────────────────────────────────────────────
  let account, profile;

  if (profileId && accountId) {
    account = await Account.findById(accountId);
    profile = await Profile.findById(profileId).populate('assignedClients');
    if (!account) throw { status: 404, message: 'Compte introuvable' };
    if (!profile || profile.assignedClients.length > 0) {
      throw { status: 409, message: 'Ce profil est déjà occupé' };
    }
  } else {
    const slot = await findAvailableSlot(service, accountId);
    account = slot.account;
    profile = slot.profile;
  }

  // ── 2. Créer l'abonnement ─────────────────────────────────────────────────
  let subscription;
  try {
    subscription = await Subscription.create({
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
      status: initialStatus,
    });
  } catch (err) {
    throw err; // rien à annuler
  }

  // ── 3. Assigner le client au profil (opération atomique) ─────────────────
  // findOneAndUpdate avec filtre { assignedClients: { $size: 0 } } garantit
  // qu'aucune requête concurrente n'a pris ce profil entre l'étape 1 et ici.
  let updatedProfile;
  try {
    updatedProfile = await Profile.findOneAndUpdate(
      {
        _id: profile._id,
        isActive: true,
        deletedAt: null,
        assignedClients: { $size: 0 },
      },
      { $push: { assignedClients: clientId } },
      { new: true },
    );
  } catch (err) {
    await Subscription.findByIdAndDelete(subscription._id).catch(() => {});
    throw { status: 500, message: 'Erreur assignation profil, abonnement annulé', detail: err.message };
  }

  if (!updatedProfile) {
    // Profil pris par une requête concurrente juste avant nous
    await Subscription.findByIdAndDelete(subscription._id).catch(() => {});
    throw { status: 409, message: "Ce profil vient d'être assigné à un autre client. Veuillez réessayer." };
  }

  // ── 4. Màj stats client ───────────────────────────────────────────────────
  try {
    await Client.findByIdAndUpdate(clientId, {
      $inc: { totalPaid: pricePaid, totalSubscriptions: 1 },
    });
  } catch (err) {
    // Rollback : désassigner le profil + supprimer l'abonnement
    await Profile.findByIdAndUpdate(profile._id, {
      $pull: { assignedClients: clientId },
    }).catch(() => {});
    await Subscription.findByIdAndDelete(subscription._id).catch(() => {});
    throw { status: 500, message: 'Erreur màj stats client, abonnement annulé', detail: err.message };
  }

  // ── 5. Màj stats partenaire ───────────────────────────────────────────────
  if (partnerId) {
    try {
      await User.findByIdAndUpdate(partnerId, {
        $inc: {
          totalRevenue: pricePaid,
          totalCommission: subscription.commissionAmount,
          totalSubscriptions: 1,
        },
      });
    } catch (err) {
      // Rollback : décrémenter stats client + désassigner profil + supprimer abonnement
      await Client.findByIdAndUpdate(clientId, {
        $inc: { totalPaid: -pricePaid, totalSubscriptions: -1 },
      }).catch(() => {});
      await Profile.findByIdAndUpdate(profile._id, {
        $pull: { assignedClients: clientId },
      }).catch(() => {});
      await Subscription.findByIdAndDelete(subscription._id).catch(() => {});
      throw { status: 500, message: 'Erreur màj stats partenaire, abonnement annulé', detail: err.message };
    }
  }

  // ── 6. Audit log (best-effort) ────────────────────────────────────────────
  await AuditLog.create({
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
  }).catch((err) => {
    console.error('[allocation] ⚠️ AuditLog CREATE_SUBSCRIPTION non enregistré:', err.message);
  });

  return subscription;
};

/**
 * Renouveler un abonnement existant.
 * FIX B8 : met à jour Client.totalPaid et les stats partenaire.
 */
const renewSubscription = async ({ subscriptionId, newEndDate, newPricePaid, doneBy }) => {
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) throw { status: 404, message: 'Abonnement introuvable' };

  const oldPricePaid = subscription.pricePaid;

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

  // ── Audit log (best-effort) ───────────────────────────────────────────────
  await AuditLog.create({
    userId: doneBy,
    action: 'RENEW_SUBSCRIPTION',
    targetModel: 'Subscription',
    targetId: subscription._id,
    details: { newEndDate, newPricePaid },
  }).catch((err) => {
    console.error('[allocation] ⚠️ AuditLog RENEW_SUBSCRIPTION non enregistré:', err.message);
  });

  // ── Màj stats client ──────────────────────────────────────────────────────
  const amountToAdd = newPricePaid !== undefined ? newPricePaid : oldPricePaid;
  await Client.findByIdAndUpdate(subscription.clientId, {
    $inc: { totalPaid: amountToAdd },
  }).catch((err) => {
    console.error('[allocation] ⚠️ Stats client non mises à jour (renew) — dérive possible:', err.message, { subscriptionId, clientId: subscription.clientId });
  });

  // ── Màj stats partenaire ──────────────────────────────────────────────────
  if (subscription.partnerId) {
    await User.findByIdAndUpdate(subscription.partnerId, {
      $inc: {
        totalRevenue: amountToAdd,
        totalCommission: subscription.commissionAmount,
      },
    }).catch((err) => {
      console.error('[allocation] ⚠️ Stats partenaire non mises à jour (renew) — dérive possible:', err.message, { subscriptionId, partnerId: subscription.partnerId });
    });
  }

  return subscription;
};

/**
 * Migrer un client vers un autre compte/profil SANS transaction (Atlas M0).
 * Rollback manuel en cas d'erreur.
 * Ordre :
 *   1. Vérifier subscription + nouveau profil
 *   2. Libérer l'ancien profil
 *   3. Assigner au nouveau profil  → rollback: réassigner l'ancien
 *   4. Màj subscription            → rollback: désassigner nouveau + réassigner ancien
 */
const migrateSubscription = async ({ subscriptionId, newAccountId, newProfileId, reason, doneBy }) => {
  // ── 1. Vérifications ──────────────────────────────────────────────────────
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) throw { status: 404, message: 'Abonnement introuvable' };

  // FIX B18 : populate('assignedClients') pour que le virtual isAvailable
  // calcule assignedClients.length === 0 sur des documents réels et non des ObjectIds bruts
  const newProfile = await Profile.findById(newProfileId).populate('assignedClients');
  if (!newProfile || !newProfile.isAvailable) {
    throw { status: 409, message: 'Nouveau profil indisponible' };
  }

  const oldProfileId = subscription.profileId;
  const oldAccountId = subscription.accountId;
  const clientId = subscription.clientId;

  // ── 2. Libérer l'ancien profil ────────────────────────────────────────────
  try {
    await Profile.findByIdAndUpdate(oldProfileId, {
      $pull: { assignedClients: clientId },
    });
  } catch (err) {
    throw { status: 500, message: 'Erreur libération ancien profil', detail: err.message };
  }

  // ── 3. Assigner au nouveau profil (opération atomique) ───────────────────
  let assignedNewProfile;
  try {
    assignedNewProfile = await Profile.findOneAndUpdate(
      {
        _id: newProfile._id,
        isActive: true,
        deletedAt: null,
        assignedClients: { $size: 0 },
      },
      { $push: { assignedClients: clientId } },
      { new: true },
    );
  } catch (err) {
    await Profile.findByIdAndUpdate(oldProfileId, {
      $push: { assignedClients: clientId },
    }).catch(() => {});
    throw { status: 500, message: 'Erreur assignation nouveau profil', detail: err.message };
  }

  if (!assignedNewProfile) {
    // Profil pris par une requête concurrente
    await Profile.findByIdAndUpdate(oldProfileId, {
      $push: { assignedClients: clientId },
    }).catch(() => {});
    throw { status: 409, message: "Le nouveau profil vient d'être assigné à un autre client. Veuillez réessayer." };
  }

  // ── 4. Màj subscription ───────────────────────────────────────────────────
  try {
    subscription.history.push({
      action: 'migrated',
      fromAccountId: oldAccountId,
      fromProfileId: oldProfileId,
      note: reason || 'Migration de compte',
      doneBy,
    });
    subscription.accountId = newAccountId;
    subscription.profileId = newProfileId;
    await subscription.save();
  } catch (err) {
    // Rollback : désassigner nouveau profil + réassigner ancien
    await Profile.findByIdAndUpdate(newProfileId, {
      $pull: { assignedClients: clientId },
    }).catch(() => {});
    await Profile.findByIdAndUpdate(oldProfileId, {
      $push: { assignedClients: clientId },
    }).catch(() => {});
    throw { status: 500, message: 'Erreur màj abonnement lors de la migration', detail: err.message };
  }

  // ── Audit log (best-effort) ───────────────────────────────────────────────
  await AuditLog.create({
    userId: doneBy,
    action: 'MIGRATE_SUBSCRIPTION',
    targetModel: 'Subscription',
    targetId: subscription._id,
    details: { oldAccountId, oldProfileId, newAccountId, newProfileId, reason },
  }).catch((err) => {
    console.error('[allocation] ⚠️ AuditLog MIGRATE_SUBSCRIPTION non enregistré:', err.message);
  });

  return subscription;
};

module.exports = { findAvailableSlot, createSubscription, renewSubscription, migrateSubscription };