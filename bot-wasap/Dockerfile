# Bot de WhatsApp (whatsapp-web.js + Chromium) para el servidor de pruebas.
# Un contenedor = UN negocio (BUSINESS_KEY). La sesión de WhatsApp (auth/) y los datos (data/, logs/) viven en volúmenes:
# reconstruir la imagen no pide QR de nuevo.
FROM node:20-bookworm-slim

# Chromium del sistema + fuentes (sin ellas los emojis y acentos salen cuadrados en las capturas).
RUN apt-get update && apt-get install -y --no-install-recommends \
        chromium fonts-liberation fonts-noto-color-emoji ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    CHROME_PATH=/usr/bin/chromium \
    WA_HEADLESS=1

WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 y canvas traen binarios precompilados para Linux x64/arm64; si faltara alguno, build-essential los compila.
RUN npm ci --omit=dev
COPY . .

# Usuario sin privilegios; los volúmenes se montan sobre estas carpetas.
RUN useradd -m -u 1001 bot && mkdir -p /app/auth /app/data /app/logs && chown -R bot:bot /app/auth /app/data /app/logs
USER bot

# Servidor de estado (solo dentro del contenedor; docker-compose no lo publica a internet).
ENV LION_STATUS_HOST=0.0.0.0
HEALTHCHECK --interval=60s --timeout=5s --start-period=120s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.LION_STATUS_PORT||8096)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "index.js"]
