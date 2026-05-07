/**
 * status.service.js
 *
 * Deux mécanismes complémentaires de recalcul de statuts :
 *
 * 1. refreshExpiredStatuses() — batch via updateMany, appelée au wake-up sur /api/health
 *    (compatible Render free tier : recalcul global toutes les 5 min max)
 *
 * 2. computeStatus / refreshStatusIfStale / refreshStatusBatch — recalcul unitaire
 *    à la lecture, pour garantir la fraîcheur même si le cron était mort.
 */

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);

const Subscription = require('../models/Subscription');

const SUSPEND_AFTER_DAYS = 5;

// ─── Mécanisme 1 : batch au wake-up ──────────────────────────────────────────

let isRunning = false;
let lastRun = null;
const MIN_INTERVAL_MS = 5 * 60 * 1000; // ne relancer que si > 5 min depuis la dernière exécution

const refreshExpiredStatuses = async () => {
  if (isRunning) return;
  if (lastRun && Date.now() - lastRun < MIN_INTERVAL_MS) return;

  isRunning = true;
  try {
    const now = dayjs.utc().toDate();
    const suspendThreshold = dayjs.utc().subtract(SUSPEND_AFTER_DAYS, 'day').toDate();

    // 1. Actifs → En retard (endDate dépassée)
    const overdueResult = await Subscription.updateMany(
      { status: 'active', endDate: { $lt: now }, deletedAt: null },
      { $set: { status: 'overdue' } }
    );

    // 2. En retard → Suspendu (après SUSPEND_AFTER_DAYS jours)
    const suspendedResult = await Subscription.updateMany(
      { status: 'overdue', endDate: { $lt: suspendThreshold }, deletedAt: null },
      { $set: { status: 'suspended' } }
    );

    if (overdueResult.modifiedCount > 0 || suspendedResult.modifiedCount > 0) {
      console.log(
        `[status] ${overdueResult.modifiedCount} → overdue, ${suspendedResult.modifiedCount} → suspended`
      );
    }

    lastRun = Date.now();
  } catch (err) {
    console.error('[status] Erreur refreshExpiredStatuses:', err.message);
  } finally {
    isRunning = false;
  }
};

// ─── Mécanisme 2 : recalcul unitaire à la lecture ────────────────────────────

const computeStatus = (sub) => {
  if (sub.status === 'cancelled' || sub.status === 'suspended') return sub.status;

  const now             = dayjs.utc();
  const end             = dayjs.utc(sub.endDate);
  const daysSinceExpiry = now.diff(end, 'day');

  if (daysSinceExpiry < 0)                    return 'active';
  if (daysSinceExpiry < SUSPEND_AFTER_DAYS)   return 'overdue';
  return 'suspended';
};

const refreshStatusIfStale = async (sub) => {
  const expected = computeStatus(sub);
  if (expected !== sub.status) {
    sub.status = expected;
    await Subscription.findByIdAndUpdate(sub._id, { $set: { status: expected } });
  }
  return sub;
};

const refreshStatusBatch = async (subs) => {
  return Promise.all(subs.map(refreshStatusIfStale));
};

module.exports = { refreshExpiredStatuses, computeStatus, refreshStatusIfStale, refreshStatusBatch };
