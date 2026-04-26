FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV BD_CLOUD_PORT=8787

COPY saas/package.json ./
COPY saas/src ./src
COPY saas/schema.sql ./
COPY app ./app

EXPOSE 8787
CMD ["node", "src/server.js"]
