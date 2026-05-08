const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

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

  // Sauvegarder refresh token hashé
  user.refreshToken = refreshToken;
  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  // Audit log
  await AuditLog.create({
    userId: user._id,
    action: 'LOGIN',
    targetModel: 'System',
    ip,
    userAgent,
  });

  return {
    accessToken,
    refreshToken,
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
  if (!user || user.refreshToken !== token) {
    throw { status: 401, message: 'Refresh token révoqué' };
  }

  const { accessToken, refreshToken } = generateTokens(user._id);
  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });

  return { accessToken, refreshToken };
};

const logout = async (userId) => {
  await User.findByIdAndUpdate(userId, { refreshToken: null });
};

module.exports = { login, refreshTokens, logout };
