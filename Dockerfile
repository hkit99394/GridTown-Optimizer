ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    MAX_RUNNING_SOLVES=1 \
    PROGRESS_LOG_INTERVAL_SECONDS=10 \
    PROGRESS_LOG_POLL_INTERVAL_SECONDS=2 \
    CITY_BUILDER_CP_SAT_PYTHON=/opt/cp-sat-venv/bin/python

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY python ./python
RUN python3 -m venv /opt/cp-sat-venv \
    && /opt/cp-sat-venv/bin/pip install --upgrade pip \
    && /opt/cp-sat-venv/bin/pip install -r python/requirements-cp-sat.txt

COPY --from=build /app/dist ./dist
COPY apps/planner-web ./apps/planner-web

RUN mkdir -p artifacts/solve-progress \
    && chown -R node:node /app /opt/cp-sat-venv

USER node

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '4173') + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/webServer.js"]
