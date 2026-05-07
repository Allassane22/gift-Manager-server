const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Stockage Cloudinary — dossier séparé par type
const makeStorage = (folder) =>
  new CloudinaryStorage({
    cloudinary,
    params: {
      folder: `digiresell/${folder}`,
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
      transformation: [{ quality: 'auto', fetch_format: 'auto' }],
    },
  });

const uploadSubscriptionProof = multer({
  storage: makeStorage('proofs/subscriptions'),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
}).single('proof');

const uploadPurchaseProof = multer({
  storage: makeStorage('proofs/purchases'),
  limits: { fileSize: 5 * 1024 * 1024 },
}).single('proof');

// Wrapper pour transformer les erreurs multer en réponses JSON propres
const handleUpload = (uploader) => (req, res, next) => {
  uploader(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'Fichier trop volumineux (max 5 Mo)' });
    }
    return res.status(400).json({ success: false, message: err.message || "Erreur d'upload" });
  });
};

module.exports = { handleUpload, uploadSubscriptionProof, uploadPurchaseProof };
