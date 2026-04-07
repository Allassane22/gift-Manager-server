const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const { connectDB } = require("./config/database");
const { startCronJobs } = require("./services/cron.service");

// Routes
const authRoutes = require("./routes/auth.routes");
const clientRoutes = require("./routes/client.routes");
const accountRoutes = require("./routes/account.routes");
const profileRoutes = require("./routes/profile.routes");
const subscriptionRoutes = require("./routes/subscription.routes");
const partnerRoutes = require("./routes/partner.routes");
const dashboardRoutes = require("./routes/dashboard.routes");

const app = express();
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  process.env.FRONTEND_URL,
]
  .filter(Boolean);

// ─── Sécurité ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
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

// Health check
app.get("/api/health", (req, res) => {
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
    });
  })
  .catch((err) => {
    console.error("Impossible de démarrer:", err);
    process.exit(1);
  });
console.log("Ma chaine de connexion :", process.env.MONGODB_URI);

module.exports = app;
