const path = require('path');
const fs   = require('fs');
const multer = require('multer');

// ─── Détection Cloudinary ─────────────────────────────────────────────────────
const cloudinaryConfigured =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_CLOUD_NAME !== 'your_cloud_name' &&
  process.env.CLOUDINARY_API_KEY    &&
  process.env.CLOUDINARY_API_KEY    !== 'your_api_key' &&
  process.env.CLOUDINARY_API_SECRET &&
  process.env.CLOUDINARY_API_SECRET !== 'your_api_secret';

// ─── Fallback : stockage local ────────────────────────────────────────────────
const makeLocalStorage = (folder) => {
  const dest = path.join(__dirname, '..', '..', 'uploads', folder);
  fs.mkdirSync(dest, { recursive: true });
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dest),
    filename: (_req, file, cb) => {
      const ext  = path.extname(file.originalname);
      const name = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
      cb(null, name);
    },
  });
};

// ─── Factory multer (Cloudinary si configuré, disk sinon) ─────────────────────
const makeUploader = (folder) => {
  if (cloudinaryConfigured) {
    const cloudinary = require('cloudinary').v2;
    const { CloudinaryStorage } = require('multer-storage-cloudinary');

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key:    process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    return multer({
      storage: new CloudinaryStorage({
        cloudinary,
        params: {
          folder: `digiresell/${folder}`,
          allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
          transformation: [{ quality: 'auto', fetch_format: 'auto' }],
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
    }).single('proof');
  }

  // Fallback local
  return multer({
    storage: makeLocalStorage(folder),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = /jpeg|jpg|png|webp|pdf/;
      if (allowed.test(path.extname(file.originalname).toLowerCase())) {
        return cb(null, true);
      }
      cb(new Error('Format non autorisé (jpg, png, webp, pdf uniquement)'));
    },
  }).single('proof');
};

const uploadSubscriptionProof = makeUploader('proofs/subscriptions');
const uploadPurchaseProof      = makeUploader('proofs/purchases');

// ─── Wrapper : erreurs multer → réponses JSON propres ─────────────────────────
const handleUpload = (uploader) => (req, res, next) => {
  uploader(req, res, (err) => {
    if (!err) {
      // En mode local, normaliser req.file.path pour qu'il soit exploitable
      if (req.file && !req.file.path && req.file.filename) {
        req.file.path = req.file.filename;
      }
      // Signaler le mode de stockage pour les logs
      if (req.file && !cloudinaryConfigured) {
        req.file.isLocal = true;
      }
      return next();
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'Fichier trop volumineux (max 5 Mo)' });
    }
    return res.status(400).json({ success: false, message: err.message || "Erreur d'upload" });
  });
};

module.exports = {
  handleUpload,
  uploadSubscriptionProof,
  uploadPurchaseProof,
  cloudinaryConfigured, // exporté pour le warning au démarrage
};
