const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const authService = require('../services/auth.service');

// ─── Helpers cookie ───────────────────────────────────────────────────────────
const REFRESH_COOKIE = 'refreshToken';
const cookieOptions = {
  httpOnly: true,                                      // inaccessible via JS — protège contre XSS
  secure: process.env.NODE_ENV === 'production',       // HTTPS uniquement en prod
  sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax', // 'None' requis pour cross-origin Vercel→Render
  maxAge: 30 * 24 * 60 * 60 * 1000,                  // 30 jours en ms
  path: '/',
};

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

    // refreshToken → cookie HttpOnly (jamais exposé au JS)
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);

    // accessToken → body JSON (stocké en mémoire React uniquement)
    res.json({ success: true, data: { accessToken: result.accessToken, user: result.user } });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    // Lire depuis le cookie HttpOnly (prioritaire) ou fallback body pour compatibilité
    const refreshToken = req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;
    const tokens = await authService.refreshTokens(refreshToken);

    // Réémettre le cookie refreshToken avec les nouvelles valeurs
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, cookieOptions);
    res.json({ success: true, data: { accessToken: tokens.accessToken } });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
router.post('/logout', protect, async (req, res, next) => {
  try {
    await authService.logout(req.user._id);
    // Effacer le cookie refreshToken
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, maxAge: 0 });
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
// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email requis' });
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    await authService.forgotPassword(email, frontendUrl);
    // Réponse identique qu'il existe ou non (anti-énumération)
    res.json({ success: true, message: 'Si cet email existe, un lien de réinitialisation a été envoyé.' });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    await authService.resetPassword(token, newPassword);
    res.json({ success: true, message: 'Mot de passe réinitialisé avec succès. Vous pouvez vous connecter.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
