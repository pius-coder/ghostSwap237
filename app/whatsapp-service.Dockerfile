FROM oven/bun:1.3.14

WORKDIR /srv/henshin
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY scripts/whatsapp-baileys-service.mjs ./scripts/whatsapp-baileys-service.mjs

ENV BAILEYS_PORT=3010
ENV BAILEYS_AUTH_DIR=/data/baileys
VOLUME ["/data/baileys"]
EXPOSE 3010

CMD ["bun", "run", "scripts/whatsapp-baileys-service.mjs"]
