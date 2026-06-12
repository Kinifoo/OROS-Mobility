# OROS Mobility — Plateforme GPS Fleet Management

**Version 2.0** | GEOTRACK CI | Développé pour le marché Côte d'Ivoire

---

## Présentation

Oros Mobility est une plateforme complète de tracking GPS et de gestion de flotte, conçue sans dépendance à Traccar ou tout autre middleware. Le serveur TCP reçoit directement les trames des traceurs GPS et les traite en temps réel.

---

## Fonctionnalités

### Tracking GPS
- Serveur TCP multi-protocoles simultanés (GT06/Sinotrack :8090, Teltonika :5027, H02/Seeworld :5013/:8000, TK103 :5002)
- Carte live Leaflet avec marqueurs animés
- Historique des positions avec replay animé
- Géofences circulaires et polygonales
- Heatmap des zones fréquentées
- Optimisation d'itinéraires (OSRM — gratuit)
- Partage de position public (lien URL sans login)

### Gestion de flotte
- Véhicules, conducteurs, affectations
- Maintenance avec alertes d'échéance
- Documents & alertes d'expiration (assurance, visite technique...)
- Gestion carburant + détection siphonnage

### Alertes IA
- 28 types d'alertes avec scoring 0-100
- Déduplication intelligente (zéro spam)
- Corrélation de patterns (vol, fatigue...)
- Escalade automatique si non acquitté
- Notifications SMS (Orange CI, Infobip, Twilio) + Email

### Radars & Voix
- Base de données radars (OpenStreetMap + CI manuels)
- Alertes vocales Web Speech API (aucune dépendance)
- Messages adaptés à la distance

### Performance conducteur
- Score de conduite (0-100, mention A→F)
- Coaching IA SMS temps réel
- Gamification : badges, leaderboard, défis hebdo

### Finance
- Recettes Mobile Money (Orange, Wave, MTN, Moov)
- Immobilisation automatique si recette impayée (Plan PRO)
- Workflow : notification 07h45 → rappels 30min → ENGINE CUT 10h

### Plans & Accès
- 3 offres : Starter / Business / Pro
- Gating dynamique par fonctionnalité
- Overrides individuels par utilisateur
- Gestion multi-organisations

---

## Démarrage rapide

### Prérequis
- Docker + Docker Compose
- Un VPS Ubuntu 22.04 (Hetzner CX22 recommandé ~5 500 FCFA/mois)

### Installation en une commande
```bash
git clone https://github.com/votre-repo/oros-gps.git
cd oros-gps
cp .env.example .env
# Éditer .env avec vos valeurs
nano .env
# Lancer
docker compose up -d
```

### Accès
- Dashboard : `http://votre-ip:3000`
- Login par défaut : `admin@oros-gps.com` / `Admin2024!`

### Configurer votre traceur Sinotrack
```
Serveur IP : votre-ip-vps
Port       : 8090
Protocole  : GT06
```

---

## Architecture

```
Sinotrack / Teltonika / H02 / TK103
        │
        ▼ TCP (ports 8090, 5027, 5013, 5002)
  tcp-manager.js
        │
        ├── alert-engine.js     → Alertes temps réel
        ├── ai-alert-engine.js  → Scoring IA + patterns
        ├── trip-detector.js    → Détection trajets auto
        ├── radar-alerts.js     → Alertes radars
        ├── driver-coaching.js  → SMS coaching
        └── database.js         → PostgreSQL + TimescaleDB
              │
              ▼
        api.js (Express + WebSocket)
              │
              ▼
        web/ (HTML/CSS/JS pur — Leaflet)
```

---

## Structure des fichiers

```
oros-gps/
├── server/
│   ├── index.js                 Point d'entrée
│   ├── api.js                   API REST + WebSocket (1152 lignes)
│   ├── database.js              Schéma PostgreSQL + TimescaleDB
│   ├── tcp-manager.js           Serveur TCP multi-protocoles
│   ├── alert-engine.js          Moteur d'alertes de base
│   ├── ai-alert-engine.js       Moteur d'alertes IA (766 lignes)
│   ├── trip-detector.js         Détection automatique trajets
│   ├── driver-score.js          Score et classement conducteurs
│   ├── driver-coaching.js       Coaching SMS temps réel
│   ├── gamification.js          Badges, leaderboard, défis
│   ├── radar-alerts.js          Base radars + alertes proximité
│   ├── fuel-manager.js          Carburant + détection siphonnage
│   ├── documents.js             Gestion documentaire + expirations
│   ├── live-share.js            Partage position public
│   ├── sos-workflow.js          Workflow urgence SOS
│   ├── heatmap.js               Zones fréquentées
│   ├── predictive-maintenance.js Maintenance prédictive IA
│   ├── route-optimizer.js       Optimisation itinéraires OSRM
│   ├── scheduler.js             Tâches planifiées (immob. auto...)
│   ├── notification.js          SMS + Email multi-canaux
│   ├── export.js                PDF + CSV exports
│   ├── plans.js                 Plans Starter/Business/Pro
│   ├── websocket.js             Broadcaster WebSocket
│   ├── protocols/
│   │   ├── gt06.js              GT06 — Sinotrack (port 8090)
│   │   ├── teltonika.js         Teltonika CODEC8/8E (port 5027)
│   │   ├── h02.js               H02 / Seeworld (port 5013/8000)
│   │   └── tk103.js             TK103 / Coban (port 5002)
│   └── utils/logger.js
│
├── web/
│   ├── index.html               SPA complète (785 lignes)
│   ├── css/app.css              Design system light theme (942 lignes)
│   ├── js/
│   │   ├── api.js               Client API REST
│   │   ├── app.js               Router + WS client
│   │   ├── map.js               Gestionnaire Leaflet
│   │   ├── pages.js             Toutes les pages (2604 lignes)
│   │   └── voice-alerts.js      Alertes vocales Web Speech API
│   ├── manifest.json            PWA
│   └── sw.js                    Service Worker
│
├── scripts/
│   ├── install.sh               Installation VPS one-command
│   ├── backup.sh                Backup PostgreSQL quotidien
│   └── update.sh                Mise à jour
│
├── docker-compose.yml
├── Dockerfile
├── nginx.conf
├── package.json
├── .env.example
└── README.md
```

---

## Plans tarifaires

| | Starter | Business | Pro |
|---|---|---|---|
| Prix | 9 900 FCFA/mois/véhicule | 19 900 FCFA/mois/véhicule | 39 900 FCFA/mois/véhicule |
| Véhicules | 10 max | 50 max | Illimité |
| Tracking live | ✓ | ✓ | ✓ |
| Gestion flotte | — | ✓ | ✓ |
| Score conducteur | — | ✓ | ✓ |
| Alertes IA | — | — | ✓ |
| Immobilisation auto | — | — | ✓ |
| Radars vocaux | — | — | ✓ |
| Multi-tenant | — | — | ✓ |

---

## Variables d'environnement importantes

| Variable | Description | Exemple |
|---|---|---|
| `PORT_GT06` | Port Sinotrack | `8090` |
| `DB_PASSWORD` | Mot de passe PostgreSQL | Changer en prod |
| `JWT_SECRET` | Clé secrète JWT | Min 32 caractères |
| `ORANGE_SMS_API` | Clé API Orange CI | Depuis portail Orange |
| `ADMIN_EMAIL` | Email admin initial | admin@votre-domaine.com |

---

*OROS Mobility v2.0 — GEOTRACK CI © 2026*
