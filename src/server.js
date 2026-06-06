const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const { connectDB } = require("./config/database");
const { startCronJobs } = require("./services/cron.service");
const { refreshExpiredStatuses } = require("./services/status.service"); // ← B4/F3

// Routes
const authRoutes = require("./routes/auth.routes");
const clientRoutes = require("./routes/client.routes");
const accountRoutes = require("./routes/account.routes");
const profileRoutes = require("./routes/profile.routes");
const subscriptionRoutes = require("./routes/subscription.routes");
const partnerRoutes = require("./routes/partner.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const serviceConfigRoutes = require("./routes/serviceConfig.routes"); // ← Conv. A
const whatsappTemplateRoutes = require("./routes/whatsappTemplate.routes"); // ← Conv. B

// ─── Validation des secrets JWT au démarrage ──────────────────────────────────
const WEAK_SECRETS = [
  'digiresell_jwt_access_super_secret_2024',
  'digiresell_jwt_refresh_super_secret_2024',
  'secret',
  'changeme',
];
const jwtAccessSecret  = process.env.JWT_ACCESS_SECRET  || '';
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || '';

if (!jwtAccessSecret || jwtAccessSecret.length < 32 || WEAK_SECRETS.includes(jwtAccessSecret)) {
  console.error('❌ FATAL: JWT_ACCESS_SECRET est absent, trop court ou utilise une valeur par défaut non sécurisée.');
  console.error('   Générez un secret fort : node -e "require(\'crypto\').randomBytes(64).toString(\'base64\') |> console.log"');
  process.exit(1);
}
if (!jwtRefreshSecret || jwtRefreshSecret.length < 32 || WEAK_SECRETS.includes(jwtRefreshSecret)) {
  console.error('❌ FATAL: JWT_REFRESH_SECRET est absent, trop court ou utilise une valeur par défaut non sécurisée.');
  process.exit(1);
}

const app = express();
// ─── CORS ─────────────────────────────────────────────────────────────────────
// Origines fixes autorisées (localhost dev + domaine de production via FRONTEND_URL)
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  process.env.FRONTEND_URL, // ex: https://digiresell.com
].filter(Boolean);

// Pattern pour les preview/branch deployments Vercel (ex: digiresell-abc123-team.vercel.app)
// Extrait le nom de base du projet depuis FRONTEND_URL si disponible
const vercelProjectPattern = (() => {
  if (!process.env.FRONTEND_URL) return null;
  try {
    const host = new URL(process.env.FRONTEND_URL).hostname; // ex: digiresell.vercel.app
    const projectSlug = host.split('.')[0];                  // ex: digiresell
    // Autorise toutes les URLs du projet : digiresell-*.vercel.app + digiresell.vercel.app
    return new RegExp(`^https://${projectSlug}(-[a-z0-9-]+)?\\.vercel\\.app$`);
  } catch {
    return null;
  }
})();

const isOriginAllowed = (origin) => {
  if (allowedOrigins.includes(origin)) return true;
  if (vercelProjectPattern && vercelProjectPattern.test(origin)) return true;
  return false;
};

// ─── Sécurité ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: function (origin, callback) {
      // Pas d'origine = requête server-to-server ou curl → autorisé
      if (!origin) return callback(null, true);
      if (isOriginAllowed(origin)) return callback(null, true);
      console.warn(`[CORS] Origine bloquée: ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Trop de requêtes, réessayez dans 15 minutes.",
  },
});

// Limiter strict sur /login et /forgot-password uniquement
// 5 tentatives / 15 min par IP — bloque les bots brute-force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // les connexions réussies ne comptent pas
  message: {
    success: false,
    message: "Trop de tentatives. Réessayez dans 15 minutes.",
  },
});

// Limiter souple pour les autres routes auth (refresh, logout, me, profile…)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Trop de requêtes auth, réessayez dans 15 minutes." },
});

app.use(limiter);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // lecture des cookies HttpOnly (refreshToken)

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// ─── Routes ──────────────────────────────────────────────────────────────────
// #20 : Servir les fichiers uploadés localement (fallback si Cloudinary non configuré).
// En production avec Cloudinary, ce middleware est ignoré (dossier vide).
// Accès : GET /uploads/proofs/subscriptions/<filename>
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.use("/api/auth", authLimiter, authRoutes);
// Limiter strict sur les routes sensibles d'authentification
app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/forgot-password", loginLimiter);
app.use("/api/clients", clientRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/profiles", profileRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/partners", partnerRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/service-configs", serviceConfigRoutes); // ← Conv. A
app.use("/api/whatsapp-templates", whatsappTemplateRoutes); // ← Conv. B

// ─── Health check (B4/F3) ─────────────────────────────────────────────────────
// À chaque hit (ex: self-ping toutes les 14 min), on recalcule les statuts expirés.
// refreshExpiredStatuses() a son propre garde MIN_INTERVAL_MS=5min, pas de risque d'abus.
app.get("/api/health", async (req, res) => {
  await refreshExpiredStatuses(); // fire-and-forget sécurisé (la fn gère ses erreurs)
  res.json({
    success: true,
    message: "DigiResell API opérationnelle",
    timestamp: new Date(),
  });
});

// ─── Gestion erreurs globales ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Erreur globale:", err);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || "Erreur serveur interne",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route introuvable" });
});

// ─── Démarrage ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀 DigiResell API démarrée sur le port ${PORT}`);

      // ─── Warning Cloudinary ──────────────────────────────────────────────────
      const { cloudinaryConfigured } = require('./middleware/upload.middleware');
      if (!cloudinaryConfigured) {
        console.warn('\n⚠️  CLOUDINARY non configuré : les uploads seront stockés localement dans /uploads/');
        console.warn('   Configurez CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY et CLOUDINARY_API_SECRET dans .env\n');
      } else {
        console.log('☁️  Cloudinary configuré — uploads activés');
      }
      console.log(`📊 Environnement: ${process.env.NODE_ENV}`);
      console.log(`🔗 URL: http://localhost:${PORT}/api/health\n`);
      startCronJobs();

      // ─── Self-ping anti-sleep (B4/F3) ──────────────────────────────────────
      // Render free tier endort le serveur après ~15 min d'inactivité.
      // On se ping toutes les 14 min pour rester éveillé ET déclencher
      // refreshExpiredStatuses() via /api/health.
      if (
        process.env.NODE_ENV === "production" &&
        process.env.RENDER_EXTERNAL_URL
      ) {
        const https = require("https");
        const PING_URL = `${process.env.RENDER_EXTERNAL_URL}/api/health`;

        setInterval(
          () => {
            https
              .get(PING_URL, (res) => {
                console.log(`[self-ping] ${PING_URL} → ${res.statusCode}`);
              })
              .on("error", (err) => {
                console.error("[self-ping] Erreur:", err.message);
              });
          },
          14 * 60 * 1000,
        ); // toutes les 14 minutes

        console.log(`🏓 Self-ping actif → ${PING_URL} (toutes les 14 min)`);
      }
    });
  })
  .catch((err) => {
    console.error("Impossible de démarrer:", err);
    process.exit(1);
  });

module.exports = app;
