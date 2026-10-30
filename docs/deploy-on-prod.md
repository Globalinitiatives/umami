# Deploying GmAnalytics on the production host

CI builds and publishes `ghcr.io/globalinitiatives/gmanalytics` (`latest` +
`sha-<short>` per merge). The production machine pulls and runs it manually —
CI never touches prod containers. Replace `<POSTGRES_PASSWORD>` (and the two
secrets if you have them) before running; keep the values stable across
deploys. `APP_SECRET` signs share tokens and API keys — changing it invalidates
every existing share link.

## First deploy on a fresh machine

```bash
IMAGE=ghcr.io/globalinitiatives/gmanalytics:latest

# Authenticate (the package is PRIVATE — created by the workflow with
# GITHUB_TOKEN, which defaults to private). Use a fine-grained PAT of any
# org member, scope: read:packages. Alternatively make the package public in
# org settings and skip this line.
echo "<PAT-with-read:packages>" | docker login ghcr.io -u <github-username> --password-stdin

docker pull "$IMAGE"

docker network create gmanalytics_network || true
docker rm -f gmanalytics gmanalytics-db 2>/dev/null || true

# Database — named volume survives container removal
docker run -d --name gmanalytics-db \
  --network gmanalytics_network \
  --restart always \
  -e POSTGRES_DB=umami \
  -e POSTGRES_USER=umami \
  -e POSTGRES_PASSWORD="<POS…ORD>" \
  -v gmanalytics_db_data:/var/lib/postgresql/data \
  postgres:15-alpine

# Wait until the DB actually answers a query (accepting TCP is NOT readiness:
# it answers while still initialising and then refuses queries with 57P03)
until docker exec gmanalytics-db psql -U umami -d umami -tAc 'SELECT 1' >/dev/null 2>&1; do sleep 2; done

# App — entrypoint runs prisma migrate deploy via scripts/check-db.js,
# but does NOT seed the admin user — that is the explicit step below.
docker run -d --name gmanalytics \
  --network gmanalytics_network \
  --restart always \
  -e DATABASE_URL="postgresql://umami:<POSTG…WORD>" \
  -e APP_SECRET="***" \
  -e TWO_FACTOR_ENCRYPTION_KEY="<two-fa…key>" \
  -e TRACKER_SCRIPT_NAME=gmanalytics.js \
  "$IMAGE"

# First admin user (mirrors the old workflow's Seed admin step; harmless to
# re-run — the script exits if the user already exists)
sleep 10
docker exec gmanalytics sh -c 'cd /app && npx ts-node scripts/seed/index.ts' || true

# Join the proxy network (nginx-proxy-manager must already provide this
# network on this machine, and a proxy host gmanalytics.opiscope.com ->
# gmanalytics:3000 must exist in its UI — DNS does not follow the image)
docker network connect nginxproxymanager_npmnetwork gmanalytics
```

Verify:

```bash
docker exec gmanalytics curl -sf http://localhost:3000/ >/dev/null && echo OK
docker logs --tail 30 gmanalytics
```

## Routine updates

```bash
docker pull ghcr.io/globalinitiatives/gmanalytics:latest
docker rm -f gmanalytics
# re-run the same docker run command above (pin the sha tag to roll back)
```

The database container is untouched; migrations apply on app startup.

## If a migration wedges (every later startup fails with P3009)

```bash
docker exec gmanalytics-db psql -U umami -d umami -c \
  "UPDATE \"_prisma_migrations\" SET rolled_back_at = NOW() WHERE finished_at IS NULL AND rolled_back_at IS NULL;"
```

Then drop any half-created tables from that migration (take names from the
`CREATE TABLE` statements in `prisma/migrations/<name>/migration.sql`), and
`docker restart gmanalytics`.

## Restoring analytics data from the old host (when it is reachable again)

```bash
# on the old machine
docker exec gmanalytics-db pg_dump -U umami umami > gmanalytics-backup.sql
# copy to the new machine, then
cat gmanalytics-backup.sql | docker exec -i gmanalytics-db psql -U umami -d umami
```
