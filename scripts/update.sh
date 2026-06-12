#!/bin/bash
# Script de mise à jour Oros GPS Server
set -e
GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'

cd /opt/oros-gps
echo -e "${CYAN}Mise à jour Oros GPS Server...${NC}"
docker compose down
docker compose build --no-cache --quiet
docker compose up -d
echo -e "${GREEN}[✓] Mise à jour terminée${NC}"
docker compose ps
