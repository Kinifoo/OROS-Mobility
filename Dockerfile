FROM node:20-alpine

# Dépendances système
RUN apk add --no-cache wget curl

WORKDIR /app

# Installer les dépendances npm en premier (cache Docker optimisé)
COPY package*.json ./
RUN npm ci --only=production

# Copier le code source
COPY server/ ./server/
COPY web/    ./web/

# Créer les dossiers nécessaires
RUN mkdir -p uploads logs

# Port API/Web (les ports TCP sont gérés par le code Node)
EXPOSE 3000

# Démarrer le serveur
CMD ["node", "server/index.js"]
