const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { sendPasswordResetEmail } = require('./email.service');

const BCRYPT_ROUNDS = 10;

const generateTokens = (userId) => {
  const accessToken = jwt.sign({ id: userId }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
  });
  const refreshToken = jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES || '30d',
  });
  return { accessToken, refreshToken };
};

const login = async ({ email, password, ip, userAgent }) => {
  const user = await User.findOne({ email }).select('+password');

  if (!user || !user.isActive) {
    throw { status: 401, message: 'Email ou mot de passe incorrect' };
  }

  const isValid = await user.comparePassword(password);
  if (!isValid) {
    throw { status: 401, message: 'Email ou mot de passe incorrect' };
  }

  const { accessToken, refreshToken } = generateTokens(user._id);

  // ✅ Stocker le hash du refreshToken, jamais le token brut
  user.refreshToken = await bcrypt.hash(refreshToken, BCRYPT_ROUNDS);
  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  await AuditLog.create({
    userId: user._id,
    action: 'LOGIN',
    targetModel: 'System',
    ip,
    userAgent,
  });

  return {
    accessToken,
    refreshToken, // on retourne le token brut au client (cookie/mémoire), jamais le hash
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      is2FAEnabled: user.is2FAEnabled,
    },
  };
};

const refreshTokens = async (token) => {
  if (!token) throw { status: 401, message: 'Refresh token manquant' };

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  } catch {
    throw { status: 401, message: 'Refresh token invalide ou expiré' };
  }

  const user = await User.findById(decoded.id).select('+refreshToken');
  if (!user || !user.refreshToken) {
    throw { status: 401, message: 'Refresh token révoqué' };
  }

  // ✅ Comparer le token brut avec le hash stocké en base
  const isMatch = await bcrypt.compare(token, user.refreshToken);
  if (!isMatch) {
    throw { status: 401, message: 'Refresh token révoqué' };
  }

  const { accessToken, refreshToken } = generateTokens(user._id);

  // ✅ Rotation : on hash et on stocke le nouveau token
  user.refreshToken = await bcrypt.hash(refreshToken, BCRYPT_ROUNDS);
  await user.save({ validateBeforeSave: false });

  return { accessToken, refreshToken };
};

const logout = async (userId) => {
  await User.findByIdAndUpdate(userId, { refreshToken: null });
};

/**
 * Demande de réinitialisation : génère un token, l'envoie par email.
 * On renvoie toujours un succès même si l'email n'existe pas (anti-énumération).
 */
const forgotPassword = async (email, frontendUrl) => {
  const user = await User.findOne({ email: email.toLowerCase().trim() })
    .select('+resetPasswordToken +resetPasswordExpires');

  // Réponse identique qu'il existe ou non (anti-énumération)
  if (!user) return;

  // Générer un token aléatoire brut (envoyé par email) + son hash (stocké en BDD)
  const rawToken   = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  user.resetPasswordToken   = hashedToken;
  user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 min
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

  try {
    await sendPasswordResetEmail(user.email, user.name, resetUrl);
  } catch (emailErr) {
    // En cas d'échec d'envoi, on annule le token pour ne pas laisser un token orphelin
    user.resetPasswordToken   = undefined;
    user.resetPasswordExpires = undefined;
    await user.save({ validateBeforeSave: false });
    throw { status: 500, message: "Impossible d'envoyer l'email. Vérifiez la configuration SMTP." };
  }
};

/**
 * Réinitialisation effective : vérifie le token, met à jour le mot de passe.
 */
const resetPassword = async (rawToken, newPassword) => {
  if (!rawToken) throw { status: 400, message: 'Token manquant' };
  if (!newPassword || newPassword.length < 8) {
    throw { status: 400, message: 'Le mot de passe doit contenir au moins 8 caractères' };
  }

  // Retrouver l'utilisateur par hash du token + token non expiré
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  const user = await User.findOne({
    resetPasswordToken:   hashedToken,
    resetPasswordExpires: { $gt: new Date() }, // pas encore expiré
  }).select('+resetPasswordToken +resetPasswordExpires +password');

  if (!user) {
    throw { status: 400, message: 'Lien invalide ou expiré. Faites une nouvelle demande.' };
  }

  // Mettre à jour le mot de passe et invalider le token
  user.password             = newPassword; // le pre-save hook bcrypt s'en charge
  user.resetPasswordToken   = undefined;
  user.resetPasswordExpires = undefined;
  user.refreshToken         = null; // invalider toutes les sessions actives
  await user.save();
};

module.exports = { login, refreshTokens, logout, forgotPassword, resetPassword };