#!/usr/bin/env bash
# Start een complete testomgeving: echte Postgres + PostgREST, de nepwolk en de app.
# Nodig: PostgreSQL 16 (initdb/pg_ctl), een PostgREST-binary (POSTGREST_BIN) en een gebouwde app (npm run build).
# Gebruik: tests/integratie/omgeving.sh start | stop
set -euo pipefail
cd "$(dirname "$0")/../.."
W=${WORK:-/tmp/debat-it}
PG=/usr/lib/postgresql/16/bin
POSTGREST_BIN=${POSTGREST_BIN:-postgrest}
APP_PORT=${APP_PORT:-3200}

stop() {
  for p in app fake rest; do
    # Elk proces draait in een eigen procesgroep; stop de hele groep (npx + next-server).
    [ -f "$W/$p.pid" ] && kill -- "-$(cat "$W/$p.pid")" 2>/dev/null || true
  done
  sleep 1
  [ -d "$W/pg" ] && su postgres -c "$PG/pg_ctl -D $W/pg stop -m fast" >/dev/null 2>&1 || true
}

if [ "${1:-start}" = "stop" ]; then stop; exit 0; fi
stop
rm -rf "$W" && mkdir -p "$W/storage" && chown postgres "$W"
su postgres -c "$PG/initdb -D $W/pg -A trust -U postgres" >/dev/null
su postgres -c "$PG/pg_ctl -D $W/pg -o '-p 55432 -k $W' -l $W/pg.log start" >/dev/null
sleep 1
Q="psql -q -h 127.0.0.1 -p 55432 -U postgres -d postgres -v ON_ERROR_STOP=1"
$Q <<'SQL'
create role anon nologin; create role authenticated nologin; create role web nologin bypassrls;
create role authenticator login noinherit; grant web to authenticator; grant anon to authenticator;
create schema storage; create table storage.buckets (id text primary key, name text, public boolean);
SQL
for f in supabase/migrations/*.sql; do $Q -f "$f"; done
$Q <<'SQL'
grant usage on schema public to web;
grant all on all tables in schema public to web;
grant all on all sequences in schema public to web;
grant execute on all functions in schema public to web;
SQL
# MODE=anon: zoals de live-versie, met de gewone sleutel plus een eigen geheim.
if [ "${MODE:-service}" = "anon" ]; then
  sed "s/VERVANG-DIT-GEHEIM/testgeheim/" supabase/optioneel/zonder-service-key.sql | sed '/storage.objects/,$d' | $Q
  ANON_ROLE=anon
  DBKEYS="SUPABASE_ANON_KEY=nep SUPABASE_APP_SECRET=testgeheim"
else
  ANON_ROLE=web
  DBKEYS="SUPABASE_SERVICE_ROLE_KEY=nep"
fi
cat > "$W/postgrest.conf" <<CONF
db-uri = "postgres://authenticator@127.0.0.1:55432/postgres"
db-schemas = "public"
db-anon-role = "$ANON_ROLE"
server-port = 54330
CONF
setsid $POSTGREST_BIN "$W/postgrest.conf" > "$W/rest.log" 2>&1 & echo $! > "$W/rest.pid"
FAKE_STORE="$W/storage" setsid node tests/integratie/fake-cloud.mjs > "$W/fake.log" 2>&1 & echo $! > "$W/fake.pid"
F=http://127.0.0.1:54321
env APP_PASSWORD=test123 SUPABASE_URL=$F $DBKEYS \
ANTHROPIC_BASE_URL=$F/anthropic OPENAI_BASE_URL=$F/openai/v1 GEMINI_BASE_URL=$F/google XAI_BASE_URL=$F/xai ELEVENLABS_BASE_URL=$F/eleven/v1 \
PORT=$APP_PORT setsid npx next start > "$W/app.log" 2>&1 & echo $! > "$W/app.pid"
for i in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$APP_PORT/login" && curl -sf -o /dev/null http://127.0.0.1:54330/ && break; sleep 0.5; done
curl -s -o /dev/null -w "app: %{http_code}\n" "http://127.0.0.1:$APP_PORT/login"
curl -s "http://127.0.0.1:54330/" -o /dev/null -w "postgrest: %{http_code}\n"
