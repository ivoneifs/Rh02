FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY api/package.json ./api/package.json
RUN cd api && npm install --omit=dev --no-audit --no-fund
COPY db ./db
COPY src ./src
COPY api ./api
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["sh","-c","node --experimental-strip-types --no-warnings api/src/migrate.ts && exec node --experimental-strip-types --no-warnings api/src/server.ts"]
