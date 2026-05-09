const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const { restrict } = require('../middleware/rbac.middleware');
const Subscription = require('../models/Subscription');
const Purchase = require('../models/Purchase');
const Client = require('../models/Client');
const Account = require('../models/Account');
const User = require('../models/User');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);

router.use(protect, restrict('admin'));

// GET /api/dashboard/stats - KPIs principaux
router.get('/stats', async (req, res, next) => {
  try {
    const now = dayjs.utc().toDate();
    const startOfMonth = dayjs.utc().startOf('month').toDate();
    const in7Days = dayjs.utc().add(7, 'day').toDate();

    const [
      totalSubs,
      activeSubs,
      overdueSubs,
      suspendedSubs,
      expiringSoon,
      monthlyRevenue,
      monthlyProfit,
      totalClients,
      totalAccounts,
    ] = await Promise.all([
      Subscription.countDocuments(),
      Subscription.countDocuments({ status: 'active' }),
      Subscription.countDocuments({ status: 'overdue' }),
      Subscription.countDocuments({ status: 'suspended' }),
      Subscription.countDocuments({ status: 'active', endDate: { $lte: in7Days, $gte: now } }),
      Subscription.aggregate([
        { $match: { createdAt: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: '$pricePaid' } } },
      ]),
      Subscription.aggregate([
        { $match: { createdAt: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: '$profit' } } },
      ]),
      Client.countDocuments(),
      Account.countDocuments({ isActive: true }),
    ]);

    const mrr = monthlyRevenue[0]?.total || 0;
    const netProfit = monthlyProfit[0]?.total || 0;
    const overdueRate = totalSubs > 0
      ? parseFloat(((overdueSubs / totalSubs) * 100).toFixed(1))
      : 0;

    res.json({
      success: true,
      data: {
        mrr,
        netProfit,
        profitMargin: mrr > 0 ? parseFloat(((netProfit / mrr) * 100).toFixed(1)) : 0,
        totalSubs,
        activeSubs,
        overdueSubs,
        suspendedSubs,
        expiringSoon,
        overdueRate,
        totalClients,
        totalAccounts,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/revenue-by-service
router.get('/revenue-by-service', async (req, res, next) => {
  try {
    const result = await Subscription.aggregate([
      {
        $lookup: {
          from: 'accounts',
          localField: 'accountId',
          foreignField: '_id',
          as: 'account',
        },
      },
      { $unwind: '$account' },
      {
        $group: {
          _id: '$account.service',
          revenue: { $sum: '$pricePaid' },
          profit: { $sum: '$profit' },
          count: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1 } },
    ]);

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/monthly-revenue?months=6
router.get('/monthly-revenue', async (req, res, next) => {
  try {
    const months = parseInt(req.query.months) || 6;
    const startDate = dayjs.utc().subtract(months - 1, 'month').startOf('month').toDate();

    const result = await Subscription.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
          },
          revenue: { $sum: '$pricePaid' },
          profit: { $sum: '$profit' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/expiring-soon
router.get('/expiring-soon', async (req, res, next) => {
  try {
    const in7Days = dayjs.utc().add(7, 'day').toDate();
    const now = dayjs.utc().toDate();

    const subs = await Subscription.find({
      status: 'active',
      endDate: { $gte: now, $lte: in7Days },
    })
      .populate('clientId', 'name phone')
      .populate('accountId', 'service type')
      .sort({ endDate: 1 });

    res.json({ success: true, data: subs });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/top-partners
router.get('/top-partners', async (req, res, next) => {
  try {
    const partners = await User.find({ role: 'partner' })
      .select('name email totalRevenue totalCommission totalSubscriptions')
      .sort({ totalRevenue: -1 })
      .limit(10);

    res.json({ success: true, data: partners });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/pending-proof
// Retourne les abonnements et achats en attente de preuve de paiement
router.get('/pending-proof', async (req, res, next) => {
  try {
    const [subscriptions, purchases] = await Promise.all([
      Subscription.find({ status: 'pending_payment' })
        .populate('clientId', 'name phone')
        .populate('accountId', 'service type')
        .sort({ createdAt: -1 }),
      Purchase.find({ status: 'pending_payment' })
        .populate('clientId', 'name phone')
        .sort({ createdAt: -1 }),
    ]);

    res.json({
      success: true,
      data: {
        subscriptions,
        purchases,
        total: subscriptions.length + purchases.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;