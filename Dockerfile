FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Default: ship the *.sqlite files already committed in the repo as-is. Opt in with
# `--build-arg REBUILD_DB=true` to regenerate every scenario's DB from its committed
# CSV/reference source data during the image build instead.
ARG REBUILD_DB=false
RUN if [ "$REBUILD_DB" = "true" ]; then npm run db:build:all; fi

RUN npm run build

FROM node:20-alpine

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/scenarios/travel/travel.sqlite ./src/scenarios/travel/travel.sqlite

# Default: fictional data only (no real-world airline names etc). Opt in with
# `--build-arg USE_REAL_AIRLINES=true` to serve the real-world roster instead. This is
# fixed for the life of the container - there's no request-time or runtime toggle.
ARG USE_REAL_AIRLINES=false
ENV TRAVEL_USE_REAL_AIRLINES=${USE_REAL_AIRLINES}

RUN chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["node", "dist/index.js"]
