#!/usr/bin/env bash
set -Eeuo pipefail

postgres_pid=""
admin_pid=""

stop_children() {
  trap - TERM INT EXIT
  if [[ -n "$admin_pid" ]] && kill -0 "$admin_pid" 2>/dev/null; then
    kill -TERM "$admin_pid" 2>/dev/null || true
  fi
  if [[ -n "$postgres_pid" ]] && kill -0 "$postgres_pid" 2>/dev/null; then
    kill -TERM "$postgres_pid" 2>/dev/null || true
  fi
  [[ -z "$admin_pid" ]] || wait "$admin_pid" 2>/dev/null || true
  [[ -z "$postgres_pid" ]] || wait "$postgres_pid" 2>/dev/null || true
}

trap stop_children TERM INT EXIT

# Keep the official entrypoint so a pre-existing volume is never reinitialized.
/usr/local/bin/docker-entrypoint.sh postgres &
postgres_pid=$!

for attempt in $(seq 1 60); do
  if ! kill -0 "$postgres_pid" 2>/dev/null; then
    wait "$postgres_pid"
    exit 1
  fi
  if pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == "60" ]]; then
    echo "postgres did not become ready" >&2
    exit 1
  fi
  sleep 1
done

node /app/dist/server/index.js &
admin_pid=$!

while kill -0 "$postgres_pid" 2>/dev/null && kill -0 "$admin_pid" 2>/dev/null; do
  sleep 1
done

if ! kill -0 "$admin_pid" 2>/dev/null; then
  wait "$admin_pid" || true
  exit 1
fi

echo "postgres exited while admin was running" >&2
exit 1
