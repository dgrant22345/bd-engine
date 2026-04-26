FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV BD_CLOUD_PORT=8787

COPY package.json ./
COPY src ./src
COPY public ./public
COPY schema.sql ./

EXPOSE 8787
CMD ["node", "src/server.js"]
