const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
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

const app = express();
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  process.env.FRONTEND_URL,
].filter(Boolean);

// ─── Sécurité ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      // Accepte toutes les URLs Vercel du projet
      if (
        allowedOrigins.includes(origin) ||
        /https:\/\/gift-manager-frontend.*\.vercel\.app$/.test(origin)
      ) {
        return callback(null, true);
      }
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
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: "Trop de tentatives de connexion." },
});

app.use(limiter);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use("/api/auth", authLimiter, authRoutes);
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
