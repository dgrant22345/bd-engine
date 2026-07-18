FROM mcr.microsoft.com/playwright:v1.61.0-noble

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8790
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

USER pwuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8790) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

EXPOSE 8790
CMD ["node", "src/server.js"]
