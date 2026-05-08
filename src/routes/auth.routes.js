const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const authService = require('../services/auth.service');

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email et mot de passe requis' });
    }
    const result = await authService.login({
      email, password,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    const tokens = await authService.refreshTokens(refreshToken);
    res.json({ success: true, data: tokens });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', protect, async (req, res, next) => {
  try {
    await authService.logout(req.user._id);
    res.json({ success: true, message: 'Déconnecté avec succès' });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', protect, (req, res) => {
  res.json({ success: true, data: req.user });
});

// PUT /api/auth/profile — modifier son propre profil
router.put('/profile', protect, async (req, res, next) => {
  try {
    const { name, email, phone } = req.body;
    const User = require('../models/User');
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { name, email, phone } },
      { new: true, runValidators: true }
    ).select('-password');
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
});

// PUT /api/auth/password — changer son propre mot de passe
router.put('/password', protect, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const User = require('../models/User');
    const user = await User.findById(req.user._id).select('+password');
    const isValid = await user.comparePassword(currentPassword);
    if (!isValid) return res.status(401).json({ success: false, message: 'Mot de passe actuel incorrect' });
    if (!newPassword || newPassword.length < 8)
      return res.status(400).json({ success: false, message: 'Minimum 8 caractères' });
    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: 'Mot de passe changé avec succès' });
  } catch (err) { next(err); }
});
module.exports = router;
