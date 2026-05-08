// Middleware RBAC : restrict('admin') ou restrict('admin', 'partner')
const restrict = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Non authentifié' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Accès refusé. Rôle requis: ${roles.join(' ou ')}`,
      });
    }
    next();
  };
};

// Un partenaire ne voit que ses propres données
const ownDataOnly = (req, res, next) => {
  if (req.user.role === 'partner') {
    req.filterByPartner = req.user._id;
  }
  next();
};

module.exports = { restrict, ownDataOnly };
