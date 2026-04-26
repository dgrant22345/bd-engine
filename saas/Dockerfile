FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV BD_CLOUD_PORT=8787
ENV BD_CLOUD_HOST=0.0.0.0

# Copy app files
COPY saas/package.json ./
COPY saas/src ./src
COPY saas/public ./public
COPY saas/schema.sql ./
COPY app ./app

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8787/health || exit 1

EXPOSE 8787
CMD ["node", "src/server.js"]
