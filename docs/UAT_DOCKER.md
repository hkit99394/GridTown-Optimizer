# UAT Docker Hosting

This runbook hosts the City Builder planner as a single-container UAT service.
It keeps the current local planner execution model: one HTTP process owns solve
state, cancellation, and progress snapshots.

## Scope

- Serves the planner UI and API from `dist/webServer.js`.
- Includes Python OR-Tools for Auto, LNS, and CP-SAT paths.
- Persists solve-progress logs in a named Docker volume.
- Runs one container instance. Do not scale this compose service horizontally
  until durable worker ownership is implemented.

The planner has no built-in authentication or TLS. Put UAT behind a VPN, an
auth proxy, or a reverse proxy with TLS and access control before sharing it
outside a trusted network.

## Build And Run

```bash
docker compose -f docker-compose.uat.yml up --build -d
```

The default URL is:

```text
http://localhost:4173
```

Override the host port when needed:

```bash
CITY_BUILDER_UAT_PORT=8080 docker compose -f docker-compose.uat.yml up --build -d
```

## Configuration

| Variable                             | Default                  | Purpose                                    |
| ------------------------------------ | ------------------------ | ------------------------------------------ |
| `CITY_BUILDER_UAT_PORT`              | `4173`                   | Host port mapped to the planner container. |
| `CITY_BUILDER_UAT_IMAGE`             | `city-builder-uat:local` | Built image name and tag.                  |
| `CITY_BUILDER_NODE_IMAGE`            | `node:24-bookworm-slim`  | Base Node image used by the Dockerfile.    |
| `MAX_RUNNING_SOLVES`                 | `1`                      | Per-container solve concurrency cap.       |
| `PROGRESS_LOG_INTERVAL_SECONDS`      | `10`                     | Progress log compaction cadence.           |
| `PROGRESS_LOG_POLL_INTERVAL_SECONDS` | `2`                      | Live progress polling cadence.             |
| `CITY_BUILDER_UAT_CPUS`              | `2`                      | Compose CPU limit for the service.         |
| `CITY_BUILDER_UAT_MEMORY`            | `2g`                     | Compose memory limit for the service.      |

The container sets `HOST=0.0.0.0`; without that, the planner binds to
`127.0.0.1` and is not reachable through Docker port publishing.

## Verification

Health check:

```bash
curl -fsS http://127.0.0.1:4173/api/health
```

CP-SAT readiness:

```bash
curl -fsS http://127.0.0.1:4173/api/cp-sat/readiness
```

Hosted smoke test:

```bash
CITY_BUILDER_UAT_REQUIRE_CP_SAT=true npm run smoke:uat
```

For a non-default URL:

```bash
CITY_BUILDER_UAT_BASE_URL=http://127.0.0.1:8080 CITY_BUILDER_UAT_REQUIRE_CP_SAT=true npm run smoke:uat
```

## Operations

Show logs:

```bash
docker compose -f docker-compose.uat.yml logs -f city-builder-uat
```

Stop UAT:

```bash
docker compose -f docker-compose.uat.yml down
```

Remove the persisted UAT progress volume:

```bash
docker compose -f docker-compose.uat.yml down -v
```

## Hosting Checklist

1. Build and run the compose service.
2. Confirm `/api/health` returns `{ "ok": true }`.
3. Confirm `/api/cp-sat/readiness` reports `ready: true`.
4. Run `CITY_BUILDER_UAT_REQUIRE_CP_SAT=true npm run smoke:uat`.
5. Open the planner URL and run one Auto solve manually.
6. Put the service behind TLS and access control before external UAT access.

## Known Limits

- Running solves are owned by the current container process.
- Restarting the container can orphan a running solve.
- Compose scaling is not supported for this UAT shape.
- CP-SAT can use meaningful CPU; keep resource limits conservative until UAT
  usage patterns are known.
