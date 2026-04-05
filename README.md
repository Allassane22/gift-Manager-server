# DigiResell — Plateforme SaaS de revente de services numériques

## 🏗️ Structure du projet

```
digiresell/          ← Backend (Node.js + Express + MongoDB)
digiresell-frontend/ ← Frontend (React + Vite + Tailwind)
```

---

## ⚡ Démarrage rapide

### Prérequis
- Node.js v18+ → https://nodejs.org
- Un compte MongoDB Atlas (gratuit) → https://cloud.mongodb.com

---

### 1. Backend

```bash
cd digiresell
npm install

# Copier et remplir le fichier d'environnement
cp .env.example .env
```

Ouvre `.env` et remplis :
```
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster.mongodb.net/digiresell
JWT_ACCESS_SECRET=une_chaine_aleatoire_longue_ici
JWT_REFRESH_SECRET=une_autre_chaine_aleatoire_ici
```

```bash
# Créer l'admin + données de test
npm run seed

# Lancer le serveur
npm run dev
```

✅ API disponible sur : http://localhost:5000/api/health

---

### 2. Frontend

```bash
cd digiresell-frontend
npm install

cp .env.example .env

# Lancer l'interface
npm run dev
```

✅ Interface disponible sur : http://localhost:5173

---

## 🔑 Connexion par défaut

| Champ    | Valeur                  |
|----------|-------------------------|
| Email    | admin@digiresell.com    |
| Password | Admin@123456            |

---

## 📡 Routes API principales

### Auth
| Méthode | Route              | Description              |
|---------|--------------------|--------------------------|
| POST    | /api/auth/login    | Connexion                |
| POST    | /api/auth/refresh  | Rafraîchir le token      |
| POST    | /api/auth/logout   | Déconnexion              |
| GET     | /api/auth/me       | Profil connecté          |

### Abonnements
| Méthode | Route                            | Description                    |
|---------|----------------------------------|--------------------------------|
| GET     | /api/subscriptions               | Liste (filtres: status, J-7)   |
| POST    | /api/subscriptions               | Créer (allocation automatique) |
| PATCH   | /api/subscriptions/:id/renew     | Renouveler en 1 clic           |
| PATCH   | /api/subscriptions/:id/migrate   | Migrer vers un autre compte    |
| PATCH   | /api/subscriptions/:id/status    | Changer le statut              |

### Dashboard
| Méthode | Route                          | Description              |
|---------|--------------------------------|--------------------------|
| GET     | /api/dashboard/stats           | KPIs (MRR, profit, ...)  |
| GET     | /api/dashboard/revenue-by-service | Revenus par service   |
| GET     | /api/dashboard/monthly-revenue | Historique mensuel       |
| GET     | /api/dashboard/expiring-soon   | Abonnements J-7          |
| GET     | /api/dashboard/top-partners    | Classement partenaires   |

---

## 🔄 Logique d'allocation automatique

Quand tu crées un abonnement sans préciser de compte :

1. Le système trouve tous les comptes actifs du service demandé
2. Il sélectionne celui avec le meilleur ratio `slots_libres/max` (load balancing)
3. Il prend le premier profil libre (non essai gratuit)
4. Il crée l'abonnement dans une **transaction atomique** (MongoDB Session)
5. Il met à jour les stats client + partenaire en même temps

---

## ⏱️ Automatisation (Cron)

| Fréquence   | Action                                         |
|-------------|------------------------------------------------|
| Toutes les heures | `active → overdue` si date dépassée    |
| Toutes les heures | `overdue → suspended` après 5 jours   |
| Chaque jour 8h    | Log des abonnements expirant dans 3j  |

---

## 🚀 Déploiement en production

### Backend → Railway.app (recommandé)

```bash
# Installer Railway CLI
npm install -g @railway/cli

railway login
railway new
railway add mongodb   # Ajoute MongoDB automatiquement
railway up
```

Variables d'environnement à configurer dans Railway :
- `MONGODB_URI` (fourni automatiquement si tu utilises Railway MongoDB)
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `NODE_ENV=production`
- `FRONTEND_URL=https://ton-frontend.vercel.app`

### Frontend → Vercel

```bash
npm install -g vercel
cd digiresell-frontend
vercel
```

Variable d'environnement dans Vercel :
- `VITE_API_URL=https://ton-api.railway.app/api`

---

## 🔐 Sécurité en production

- [ ] Changer `JWT_ACCESS_SECRET` et `JWT_REFRESH_SECRET` (min 32 chars aléatoires)
- [ ] Changer le mot de passe admin après le premier login
- [ ] Activer HTTPS (automatique sur Railway/Vercel)
- [ ] Configurer `FRONTEND_URL` correctement dans le backend (CORS)

---

## 🧩 Stack technique

| Couche      | Technologie                              |
|-------------|------------------------------------------|
| Backend     | Node.js, Express.js                      |
| Base de données | MongoDB + Mongoose                   |
| Auth        | JWT (Access 15min + Refresh 30j)         |
| Dates       | dayjs (UTC pour stockage)                |
| Transactions | Mongoose Sessions (atomique)            |
| Cron        | node-cron                                |
| Frontend    | React 18 + Vite                          |
| Style       | Tailwind CSS                             |
| Data fetching | React Query v5 + Axios                 |
| Routing     | React Router v6                          |
