#!/bin/bash
# ╔══════════════════════════════════════════════════════════════╗
# ║         OROS GPS SERVER — Script d'installation             ║
# ║         GEOTRACK CI — Abidjan, Côte d'Ivoire                ║
# ╚══════════════════════════════════════════════════════════════╝
# Usage: curl -sSL https://ton-serveur/install.sh | bash
# Ou:    bash install.sh

set -e  # Arrêter si une commande échoue

# ── Couleurs ────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()     { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗] ERREUR: $1${NC}"; exit 1; }
section() { echo -e "\n${CYAN}${BOLD}══ $1 ══${NC}"; }

# ── Vérifications ───────────────────────────────────────────────
section "Vérifications initiales"

[ "$EUID" -ne 0 ] && error "Lance ce script en root: sudo bash install.sh"
[ "$(uname -s)" != "Linux" ] && error "Ce script est pour Linux Ubuntu uniquement"

UBUNTU_VER=$(lsb_release -rs 2>/dev/null || echo "0")
log "Ubuntu $UBUNTU_VER détecté"

section "Mise à jour du système"
apt-get update -qq
apt-get upgrade -y -qq
log "Système à jour"

section "Installation Docker"
if command -v docker &>/dev/null; then
    log "Docker déjà installé ($(docker --version | cut -d' ' -f3 | tr -d ','))"
else
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    log "Docker installé"
fi

if command -v docker &>/dev/null && docker compose version &>/dev/null; then
    log "Docker Compose déjà disponible"
else
    apt-get install -y docker-compose-plugin
    log "Docker Compose installé"
fi

section "Configuration du pare-feu"
apt-get install -y -qq ufw

ufw --force reset
ufw default deny incoming
ufw default allow outgoing

# Ports essentiels
ufw allow 22/tcp    comment "SSH"
ufw allow 80/tcp    comment "HTTP"
ufw allow 443/tcp   comment "HTTPS"
ufw allow 3000/tcp  comment "Oros Web (direct)"

# Ports GPS traceurs
ufw allow 8090/tcp  comment "GT06 Sinotrack"
ufw allow 5027/tcp  comment "Teltonika"
ufw allow 5013/tcp  comment "H02 Seeworld"
ufw allow 8000/tcp  comment "Seeworld alt"
ufw allow 5002/tcp  comment "TK103 Coban"

ufw --force enable
log "Pare-feu configuré — ports GPS ouverts"
ufw status numbered

section "Création du dossier de l'application"
APP_DIR="/opt/oros-gps"
mkdir -p "$APP_DIR"
cd "$APP_DIR"
log "Dossier: $APP_DIR"

# ── Générer un mot de passe aléatoire sécurisé ──────────────────
DB_PASS=$(openssl rand -base64 16 | tr -d '/+=' | head -c 20)
JWT_SEC=$(openssl rand -base64 32 | tr -d '/+=' | head -c 40)
ADMIN_PASS=$(openssl rand -base64 8 | tr -d '/+=' | head -c 12)
ADMIN_PASS="${ADMIN_PASS}1!" # Ajouter chiffre + spécial pour la complexité

section "Configuration de l'application"

# Demander l'IP publique ou le domaine
SERVER_IP=$(curl -s https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
echo ""
echo -e "${BOLD}Adresse IP publique de ce serveur: ${CYAN}$SERVER_IP${NC}"
echo -e "${YELLOW}Si tu as un nom de domaine (ex: gps.geotrack-ci.com), entre-le maintenant."
echo -e "Sinon, appuie sur ENTRÉE pour utiliser l'adresse IP.${NC}"
read -p "Domaine ou IP [${SERVER_IP}]: " USER_DOMAIN
DOMAIN="${USER_DOMAIN:-$SERVER_IP}"

echo ""
echo -e "${BOLD}Email administrateur (pour te connecter):${NC}"
read -p "Email admin [admin@geotrack-ci.com]: " ADMIN_EMAIL
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@geotrack-ci.com}"

# Créer le fichier .env
cat > .env << EOF
# ═══════════════════════════════════════════════════════════
# OROS GPS SERVER — Configuration
# Généré automatiquement le $(date '+%d/%m/%Y %H:%M')
# ═══════════════════════════════════════════════════════════

NODE_ENV=production
PORT=3000

# Ports TCP GPS
PORT_GT06=8090
PORT_TELTONIKA=5027
PORT_H02=5013
PORT_SEEWORLD=8000
PORT_TK103=5002

# Base de données
DB_HOST=postgres
DB_PORT=5432
DB_NAME=oros_gps
DB_USER=oros
DB_PASSWORD=${DB_PASS}

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# Sécurité
JWT_SECRET=${JWT_SEC}
JWT_EXPIRES=24h

# Compte administrateur
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASS}

# URL publique
PUBLIC_URL=http://${DOMAIN}:3000
EOF

log "Fichier .env créé"

section "Téléchargement du code source"

# Si le code est dans le dossier courant (déploiement local)
if [ -f "/tmp/oros-gps.tar.gz" ]; then
    tar -xzf /tmp/oros-gps.tar.gz -C "$APP_DIR" --strip-components=1
    log "Code extrait depuis /tmp/oros-gps.tar.gz"
elif [ -d "/root/oros-gps" ]; then
    cp -r /root/oros-gps/* "$APP_DIR/"
    log "Code copié depuis /root/oros-gps"
else
    warn "Copie manuelle requise — dépose tes fichiers dans $APP_DIR"
fi

section "Démarrage de l'application"
cd "$APP_DIR"

# Vérifier que docker-compose.yml existe
[ ! -f "docker-compose.yml" ] && error "docker-compose.yml manquant dans $APP_DIR"

# Construire et démarrer
docker compose pull --quiet 2>/dev/null || true
docker compose build --quiet
docker compose up -d

log "Conteneurs démarrés"

# Attendre que l'app soit prête
echo -n "  Attente démarrage"
for i in $(seq 1 30); do
    sleep 2
    echo -n "."
    if curl -sf "http://localhost:3000/api/stats" &>/dev/null; then
        echo ""
        log "Application opérationnelle ✓"
        break
    fi
    if [ $i -eq 30 ]; then
        echo ""
        warn "L'application met du temps à démarrer. Vérifie avec: docker compose logs app"
    fi
done

section "Service systemd (démarrage automatique)"
cat > /etc/systemd/system/oros-gps.service << 'EOF'
[Unit]
Description=Oros GPS Server
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/oros-gps
ExecStart=docker compose up -d
ExecStop=docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable oros-gps
log "Service systemd activé — démarrage automatique au reboot"

section "Sauvegarde automatique quotidienne"
cat > /etc/cron.daily/oros-backup << 'CRON'
#!/bin/bash
BACKUP_DIR="/opt/oros-backups"
DATE=$(date +%Y%m%d_%H%M)
mkdir -p "$BACKUP_DIR"
docker exec oros_postgres pg_dump -U oros oros_gps | gzip > "$BACKUP_DIR/db_${DATE}.sql.gz"
# Garder seulement les 7 derniers backups
ls -t "$BACKUP_DIR"/db_*.sql.gz 2>/dev/null | tail -n +8 | xargs -r rm
CRON
chmod +x /etc/cron.daily/oros-backup
log "Sauvegarde automatique configurée (quotidienne, 7 jours)"

# ── Résumé final ────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════════════════╗"
echo -e "║          OROS GPS SERVER — INSTALLATION TERMINÉE            ║"
echo -e "╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Interface web:${NC}    ${GREEN}http://${DOMAIN}:3000${NC}"
echo -e "  ${BOLD}Email admin:${NC}      ${CYAN}${ADMIN_EMAIL}${NC}"
echo -e "  ${BOLD}Mot de passe:${NC}     ${CYAN}${ADMIN_PASS}${NC}"
echo ""
echo -e "  ${BOLD}Ports GPS ouverts:${NC}"
echo -e "    ${CYAN}:8090${NC} Sinotrack GT06    ${CYAN}:5027${NC} Teltonika"
echo -e "    ${CYAN}:5013${NC} H02/Seeworld      ${CYAN}:8000${NC} Seeworld alt"
echo -e "    ${CYAN}:5002${NC} TK103/Coban"
echo ""
echo -e "  ${YELLOW}${BOLD}⚠ Note le mot de passe admin — il ne sera plus affiché !${NC}"
echo ""
echo -e "  ${BOLD}Commandes utiles:${NC}"
echo -e "    Voir les logs:     ${CYAN}cd /opt/oros-gps && docker compose logs -f app${NC}"
echo -e "    Redémarrer:        ${CYAN}docker compose restart app${NC}"
echo -e "    Arrêter tout:      ${CYAN}docker compose down${NC}"
echo -e "    Mettre à jour:     ${CYAN}docker compose pull && docker compose up -d${NC}"
echo ""

# Sauvegarder les infos dans un fichier
cat > /root/OROS_CREDENTIALS.txt << CREDS
OROS GPS SERVER — Informations de connexion
Généré le: $(date)
=============================================
URL:            http://${DOMAIN}:3000
Email admin:    ${ADMIN_EMAIL}
Mot de passe:   ${ADMIN_PASS}
Dossier app:    /opt/oros-gps
=============================================
CREDS
chmod 600 /root/OROS_CREDENTIALS.txt
log "Identifiants sauvegardés dans /root/OROS_CREDENTIALS.txt"
