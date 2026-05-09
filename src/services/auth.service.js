const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

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

module.exports = { login, refreshTokens, logout };