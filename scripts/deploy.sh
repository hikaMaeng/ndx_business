#!/usr/bin/env bash
# `-E` is load-bearing: without it the ERR trap below is not inherited by
# functions, and almost everything here runs inside one. A failure would then
# exit silently, which is the one outcome this script exists to prevent.
set -eEuo pipefail

# Run from the repository root regardless of the caller's directory. Every path
# below is repo-relative, and this script's own position in the repository is
# fixed, so its location is the reliable anchor.
cd "$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd -P )" || exit 2

# Repository deploy entrypoint. This file is owned by this repository: edit it
# when this project's deploy needs change. The `web-deploy-docker` skill owns
# the contract it must satisfy (local build first, compose refresh, published
# port and health verification, and the deploy-report block), not this
# implementation.
#
# Usage:
#   scripts/deploy.sh <service> [<service> ...]   deploy the named services
#   scripts/deploy.sh --all                       deploy every compose service
#   scripts/deploy.sh                             deploy the only service, if one
#
# Optional overrides:
#   DEPLOY_HEALTH_PATHS      space-separated paths to verify (default: /health)
#   DEPLOY_COMPOSE_PROFILES  comma-separated Compose profiles to activate

now_ms() {
  if [[ -r /proc/uptime ]]; then
    awk '{printf "%.0f\n", $1 * 1000}' /proc/uptime
  else
    node -e 'process.stdout.write(String(Date.now()))'
  fi
}

deploy_started_ms="$(now_ms)"
deploy_completed=0

elapsed_ms() {
  local started_ms="$1"
  echo $(( $(now_ms) - started_ms ))
}

report_failed_total() {
  local exit_code=$?
  if [[ "$deploy_completed" -eq 0 ]]; then
    echo "deploy-total status=failed exit_code=$exit_code elapsed_ms=$(elapsed_ms "$deploy_started_ms")"
  fi
  exit "$exit_code"
}

trap report_failed_total ERR

require_tool() {
  local tool="$1"
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "deploy-runtime $tool=missing" >&2
    exit 2
  fi
}

require_tool docker
require_tool node
require_tool curl

# Docker Desktop exposes a WSL shim even when this distro is not integrated.
# Prefer the native CLI only after the shim cannot reach an engine; every call
# below still uses the same `docker compose` contract through this function.
docker_cli="docker"
if ! command docker info >/dev/null 2>&1; then
  if command -v docker.exe >/dev/null 2>&1 && command docker.exe info >/dev/null 2>&1; then
    docker_cli="docker.exe"
    echo "deploy-runtime docker=docker.exe status=fallback"
  else
    echo "deploy-runtime docker=unavailable" >&2
    exit 2
  fi
fi

docker() {
  command "$docker_cli" "$@"
}

# macOS ships `shasum`, Linux ships `sha256sum`. Pick one rather than assuming.
if command -v sha256sum >/dev/null 2>&1; then
  sha256_of() { sha256sum "$@"; }
elif command -v shasum >/dev/null 2>&1; then
  sha256_of() { shasum -a 256 "$@"; }
else
  echo "deploy-runtime sha256sum=missing shasum=missing" >&2
  exit 2
fi

# The base image decides the runtime Node. This checks the *build* toolchain
# instead: the host Node has to satisfy the range the root manifest declares,
# because a Node outside it can fail deep inside the module loader with an
# error that never mentions the version. The range can exclude a middle window,
# not just cap a ceiling, so compare full versions rather than majors.
check_toolchain_node() {
  local declared running
  declared="$(node -p "require('./package.json').engines?.node ?? ''" 2>/dev/null)"
  [[ -z "$declared" ]] && return 0
  running="$(node -p 'process.versions.node')"

  if node scripts/node-range.mjs "$declared" "$running"; then
    echo "deploy-runtime node=v$running declared=\"$declared\" status=ok"
  else
    echo "deploy-runtime node=v$running declared=\"$declared\" status=unsupported" >&2
    echo "the build toolchain requires a Node version inside \"$declared\"; switch versions before deploying" >&2
    echo "run scripts/check-node-support.sh to see whether a newer release is usable yet" >&2
    exit 2
  fi
}

check_toolchain_node

require_tool npm

if [[ ! -d apps ]]; then
  echo "missing apps/ directory" >&2
  exit 2
fi

deploy_health_paths_override="${DEPLOY_HEALTH_PATHS:-}"
if [[ -n "${DEPLOY_COMPOSE_PROFILES:-}" ]]; then export COMPOSE_PROFILES="$DEPLOY_COMPOSE_PROFILES"; fi

compose_json() {
  docker compose config --format json 2>/dev/null
}

compose_query() {
  # compose_query <service> <node-expression over `svc`>
  local service="$1"
  local expression="$2"
  compose_json | node -e '
let raw = "";
process.stdin.on("data", (chunk) => raw += chunk);
process.stdin.on("end", () => {
  try {
    const svc = JSON.parse(raw).services?.[process.argv[1]];
    console.log(eval(process.argv[2]) ?? "");
  } catch {
    process.exit(1);
  }
});
' "$service" "$expression" 2>/dev/null || true
}

list_compose_services() {
  docker compose config --services | sed 's/\r$//' | sort
}

# ---------------------------------------------------------------- resolve ----

if [[ $# -eq 0 || "${1:-}" == "--all" ]]; then
  services=()
  while IFS= read -r service; do
    services+=("$service")
  done < <(list_compose_services)
  if [[ ${#services[@]} -eq 0 ]]; then
    echo "no deployable services found in docker-compose.yml" >&2
    exit 2
  fi
  if [[ $# -eq 0 && ${#services[@]} -gt 1 ]]; then
    echo "multiple services found; pass one service or --all:" >&2
    printf '  %s\n' "${services[@]}" >&2
    exit 2
  fi
else
  services=("$@")
fi

for index in "${!services[@]}"; do
  services[$index]="${services[$index]#apps/}"
  services[$index]="${services[$index]%/}"
done

compose_services=()
while IFS= read -r service; do
  compose_services+=("$service")
done < <(list_compose_services)

for service in "${services[@]}"; do
  if ! printf '%s\n' "${compose_services[@]}" | grep -Fxq "$service"; then
    echo "docker-compose.yml has no service named: $service" >&2
    exit 2
  fi
done

# A fresh clone has no docker/.env: it is git-ignored on purpose. Recreate it
# from the committed template so the checkout is deployable as-is. This runs
# before anything else touches compose.
for service in "${services[@]}"; do
  env_template="apps/$service/docker/env.defaults"
  env_local="apps/$service/docker/.env"
  if [[ -f "$env_template" && ! -f "$env_local" ]]; then
    cp "$env_template" "$env_local"
    echo "materialized $env_local from $env_template"
  elif [[ -f "$env_template" ]]; then
    # The local file can carry machine-specific credentials, so never overwrite it.
    # Append only newly introduced non-secret template keys; existing local values remain authoritative.
    appended=0
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ -z "$line" || "$line" == \#* ]] && continue
      key="${line%%=*}"
      [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
      if ! grep -Fqx "${key}=" "$env_local" && ! grep -Eq "^${key}=" "$env_local"; then
        printf '%s\n' "$line" >> "$env_local"
        appended=$((appended + 1))
      fi
    done < "$env_template"
    if [[ "$appended" -gt 0 ]]; then echo "reconciled $env_local from $env_template appended=$appended"; fi
  fi
done

resolve_elapsed_ms="$(elapsed_ms "$deploy_started_ms")"
echo "deploy-phase phase=resolve status=ok elapsed_ms=$resolve_elapsed_ms services=${services[*]}"

# ---------------------------------------------------------------- install ----

install_started_ms="$(now_ms)"

dependency_fingerprint() {
  bash scripts/dependency-fingerprint.sh
}

run_install() {
  # A lockfile means the install is reproducible; without one this is a first
  # run and npm writes the lockfile as it goes.
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
}

install_marker="node_modules/.deploy-install.sha256"
current_fingerprint="$(dependency_fingerprint)"
needs_install=1
install_reason="fingerprint-changed"
if [[ ! -d node_modules ]]; then
  install_reason="node-modules-missing"
elif [[ ! -f "$install_marker" ]]; then
  install_reason="marker-missing"
elif [[ "$(cat "$install_marker")" == "$current_fingerprint" ]]; then
  needs_install=0
  install_reason="up-to-date"
fi

if [[ "$needs_install" -eq 1 ]]; then
  install_status="ran"
  echo "dependencies bootstrap required reason=$install_reason"
  run_install
  mkdir -p "$(dirname "$install_marker")"
  printf '%s\n' "$current_fingerprint" > "$install_marker"
else
  install_status="skipped"
  echo "dependencies already bootstrapped"
fi

install_elapsed_ms="$(elapsed_ms "$install_started_ms")"
echo "deploy-phase phase=install status=$install_status reason=$install_reason elapsed_ms=$install_elapsed_ms"

# ------------------------------------------------------------------ build ----

build_started_ms="$(now_ms)"
build_args=(exec -- turbo run build)
build_args_base=${#build_args[@]}
for service in "${services[@]}"; do
  if [[ -d "apps/$service" ]]; then
    build_args+=(--filter="./apps/$service")
  fi
done

# Only build when at least one filter was added; a service with no module of
# its own has nothing to build here.
if [[ ${#build_args[@]} -gt "$build_args_base" ]]; then
  # Stream the build rather than capturing it. A captured build shows nothing
  # while it runs, so a bundler that wedges looks identical to one that is
  # simply slow, and the panic that explains it stays buffered out of sight.
  build_log="$(mktemp)"
  set +e
  npm "${build_args[@]}" 2>&1 | tee "$build_log"
  build_exit_code="${PIPESTATUS[0]}"
  set -e
  rm -f "$build_log"

  if [[ "$build_exit_code" -ne 0 ]]; then
    exit "$build_exit_code"
  fi
fi

build_elapsed_ms="$(elapsed_ms "$build_started_ms")"
echo "deploy-phase phase=build status=ok elapsed_ms=$build_elapsed_ms services=${services[*]}"

# ---------------------------------------------------------------- compose ----

service_fingerprint() {
  local service="$1"
  {
    printf 'deploy-runtime-v6\n'
    printf 'service=%s\n' "$service"

    if [[ -d "apps/$service" ]]; then
      local runtime_payload="apps/$service/dist"
      if [[ ! -d "$runtime_payload" ]]; then
        # Runtime-only apps produce no dist/; their Dockerfile copies app
        # source directly, so that source is the deploy payload.
        runtime_payload="apps/$service"
      fi
      # `env_file` values are runtime input too: compose does not rebuild an
      # image for them, so omitting this generated file would leave containers
      # running with a previous queue, endpoint, or capacity setting.
      find docker-compose.yml "apps/$service/docker" "apps/$service/docker/.env" "$runtime_payload" \
        -type f -print 2>/dev/null | sort -u | while IFS= read -r path; do
          sha256_of "$path"
        done
    else
      # A role-only service may share an app image with a published sibling
      # (agent-worker and agent-router use the Agent Dockerfile). Its own
      # service folder is absent, but its runtime payload is not: changing the
      # shared app dist must recreate every role that runs that image.
      local dockerfile owner_app runtime_payload
      dockerfile="$(compose_query "$service" 'svc?.build?.dockerfile')"
      owner_app="${dockerfile%/docker/Dockerfile}"
      runtime_payload="$owner_app/dist"
      if [[ -n "$dockerfile" && -d "$owner_app" && -d "$runtime_payload" ]]; then
        find docker-compose.yml "$dockerfile" "$owner_app/docker/.env" "$runtime_payload" \
          -type f -print 2>/dev/null | sort -u | while IFS= read -r path; do
            sha256_of "$path"
          done
      else
        # An external image or database has no repository runtime payload. Its
        # compose declaration is then the complete deploy input.
        compose_query "$service" 'JSON.stringify(svc)'
        sha256_of docker-compose.yml
      fi
    fi
  } | sha256_of | awk '{print $1}'
}

contains_service() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

service_target_port_of() {
  compose_query "$1" '(svc?.ports ?? []).find((p) => Number(p?.published) > 0 && Number(p?.target) > 0)?.target'
}

published_port_valid() {
  local port_target="$1"
  local port_number="${port_target##*:}"
  [[ -n "$port_target" && "$port_number" =~ ^[1-9][0-9]*$ ]]
}

service_has_published_port() {
  local target
  target="$(service_target_port_of "$1")"
  [[ -n "$target" ]]
}

internal_health_status() {
  local service="$1" container status
  for _ in {1..30}; do
    container="$(docker compose ps -q "$service" 2>/dev/null || true)"
    status="$(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)"
    [[ "$status" == "healthy" ]] && { printf '%s' "$status"; return 0; }
    [[ "$status" == "exited" || "$status" == "dead" ]] && { printf '%s' "$status"; return 1; }
    sleep 1
  done
  printf '%s' "${status:-unknown}"
  return 1
}

emit_report() {
  local status="$1"
  local total_ms="$2"
  local line
  echo "deploy-report-begin"
  echo "result: status=$status services=${services[*]} compose=${compose_status:-none}"
  echo "time: total=${total_ms}ms resolve=${resolve_elapsed_ms}ms install=${install_elapsed_ms:-0}ms build=${build_elapsed_ms:-0}ms compose=${compose_elapsed_ms:-0}ms verify=${verify_elapsed_ms:-0}ms"
  for line in "${deploy_report_lines[@]}"; do
    echo "verify: $line"
  done
  echo "changed: files_edited=none"
  echo "deploy-report-end"
}

compose_started_ms="$(now_ms)"
deploy_report_lines=()
if ! compose_config_output="$(docker compose config 2>&1)"; then
  echo "$compose_config_output" >&2
  compose_elapsed_ms="$(elapsed_ms "$compose_started_ms")"
  compose_status="failed"
  deploy_report_lines=("compose-config status=failed output=$(printf '%s' "$compose_config_output" | tr '\n' ' ' | head -c 400)")
  echo "deploy-phase phase=compose status=failed elapsed_ms=$compose_elapsed_ms reason=compose-config"
  deploy_completed=1
  trap - ERR
  emit_report failed "$(elapsed_ms "$deploy_started_ms")"
  exit 2
fi

running_services=()
while IFS= read -r service; do
  running_services+=("$service")
done < <(docker compose ps --status running --services 2>/dev/null || true)

services_to_refresh=()
for service in "${services[@]}"; do
  deploy_marker=".docker/deploy-$service.sha256"
  current_runtime_fingerprint="$(service_fingerprint "$service")"
  current_port="$(docker compose port "$service" "$(service_target_port_of "$service")" 2>/dev/null || true)"
  if [[ -f "$deploy_marker" ]] &&
    [[ "$(cat "$deploy_marker")" == "$current_runtime_fingerprint" ]] &&
    printf '%s\n' "${running_services[@]}" | grep -Fxq "$service" &&
    { ! service_has_published_port "$service" || published_port_valid "$current_port"; }; then
    echo "service already current: $service"
  else
    services_to_refresh+=("$service")
  fi
done

if [[ ${#services_to_refresh[@]} -gt 0 ]]; then
  current_project="$(compose_json | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{console.log(JSON.parse(s).name||"")}catch{}})' 2>/dev/null || true)"

  # A container left by a different compose project holds the name and the
  # published port; drop it before recreating under this project.
  for service in "${services_to_refresh[@]}"; do
    container_name="$(compose_query "$service" 'svc?.container_name')"
    if [[ -n "$container_name" ]]; then
      existing_project="$(docker inspect "$container_name" --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>/dev/null || true)"
      if [[ -n "$existing_project" && "$existing_project" != "$current_project" ]]; then
        docker rm -f "$container_name" >/dev/null 2>&1 || true
      fi
    fi
  done

  dependency_services=()
  for service in "${services_to_refresh[@]}"; do
    while IFS= read -r dependency; do
      if [[ -n "$dependency" ]] &&
        ! contains_service "$dependency" "${services_to_refresh[@]}" &&
        ! contains_service "$dependency" ${dependency_services[@]+"${dependency_services[@]}"}; then
        dependency_services+=("$dependency")
      fi
    done < <(compose_query "$service" 'Object.keys(svc?.depends_on ?? {}).join("\n")')
  done

  if [[ ${#dependency_services[@]} -gt 0 ]]; then
    docker compose up -d --no-build "${dependency_services[@]}"
  fi

  # Build through compose, never `docker build`: compose owns the build args
  # and the image name declared for the service.
  for service in "${services_to_refresh[@]}"; do
    docker compose build "$service"
  done

  docker compose up -d --no-deps --force-recreate "${services_to_refresh[@]}"
  mkdir -p .docker
  for service in "${services_to_refresh[@]}"; do
    service_fingerprint "$service" > ".docker/deploy-$service.sha256"
  done
  compose_status="refreshed"
else
  compose_status="already-current"
fi

compose_elapsed_ms="$(elapsed_ms "$compose_started_ms")"
echo "deploy-phase phase=compose status=$compose_status elapsed_ms=$compose_elapsed_ms refresh_count=${#services_to_refresh[@]}"

# ----------------------------------------------------------------- verify ----

# Judge health by the HTTP status, not by whether a body came back. A healthy
# endpoint is allowed to answer 204, or 200 with nothing in it; treating an
# empty body as failure reports a working service as broken.
#
# Sets `probe_status` and `probe_body` in the caller. Returns 0 on a 2xx.
probe_http() {
  local url="$1" tmp
  tmp="$( mktemp )"
  probe_status="$( curl -sS --max-time 5 -o "$tmp" -w '%{http_code}' "$url" 2>/dev/null || echo 000 )"
  probe_body="$( head -c 400 "$tmp" 2>/dev/null || true )"
  rm -f "$tmp"
  [[ "$probe_status" =~ ^2[0-9][0-9]$ ]]
}

probe_with_retry() {
  local url="$1" attempt
  for attempt in {1..30}; do
    if probe_http "$url"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

health_host_candidates() {
  local port_host="$1"
  local gateway
  case "$port_host" in
    ""|"0.0.0.0"|"::"|"[::]")
      printf '%s\n' "127.0.0.1"
      printf '%s\n' "localhost"
      if getent hosts host.docker.internal >/dev/null 2>&1; then
        printf '%s\n' "host.docker.internal"
      fi
      gateway="$(ip route show default 2>/dev/null | awk 'NR == 1 {print $3}')"
      [[ -n "$gateway" ]] && printf '%s\n' "$gateway"
      ;;
    *)
      printf '%s\n' "${port_host#[}"
      ;;
  esac
}

check_health_path() {
  local body_var="$1" url_var="$2" status_var="$3" path="$4" port_host="$5" port_number="$6"
  local candidate url
  while IFS= read -r candidate; do
    [[ -z "$candidate" ]] && continue
    url="http://$candidate:$port_number$path"
    if probe_with_retry "$url"; then
      printf -v "$body_var" '%s' "$probe_body"
      printf -v "$url_var" '%s' "$url"
      printf -v "$status_var" '%s' "$probe_status"
      return 0
    fi
  done < <(health_host_candidates "$port_host" | awk '!seen[$0]++')
  printf -v "$status_var" '%s' "${probe_status:-000}"
  return 1
}

verify_started_ms="$(now_ms)"
verify_status="ok"
deploy_report_lines=()

for service in "${services[@]}"; do
  if contains_service "$service" ${services_to_refresh[@]+"${services_to_refresh[@]}"}; then
    refresh_status="refreshed"
  else
    refresh_status="already-current"
  fi

  port_target="$(docker compose port "$service" "$(service_target_port_of "$service")" 2>/dev/null || true)"
  port_number="${port_target##*:}"
  port_host="${port_target%:*}"
  port_host="${port_host#[}"
  port_host="${port_host%]}"
  port_reason="ok"
  health_report=""

  if [[ -z "$port_target" ]]; then
    if internal_status="$(internal_health_status "$service")"; then
      port_reason="internal-only"
      health_report=" health[docker]=ok"
      deploy_report_lines+=("health service=$service scope=internal docker=$internal_status")
    else
      port_reason="internal-unhealthy(${internal_status:-unknown})"
      verify_status="failed"
    fi
  elif ! published_port_valid "$port_target"; then
    port_reason="published-port-invalid"
    verify_status="failed"
  else
    service_health_paths="${deploy_health_paths_override:-$(compose_query "$service" "svc.labels?.['ndx.business.deploy-health-path']")}"
    read -r -a health_paths <<< "${service_health_paths:-/health}"
    for health_path in "${health_paths[@]}"; do
      health_body=""
      health_url=""
      health_status=""
      if check_health_path health_body health_url health_status "$health_path" "$port_host" "$port_number"; then
        health_report+=" health[$health_path]=ok"
        deploy_report_lines+=("health service=$service path=$health_path http=$health_status url=$health_url body=$health_body")
      else
        health_report+=" health[$health_path]=failed(http=${health_status:-000})"
        verify_status="failed"
      fi
    done
  fi

  echo "deploy-summary service=$service refresh=$refresh_status port=${port_target:-none} port_reason=$port_reason$health_report"
  deploy_report_lines+=("service=$service refresh=$refresh_status port=${port_target:-none} port_reason=$port_reason$health_report")
done

verify_elapsed_ms="$(elapsed_ms "$verify_started_ms")"
echo "deploy-phase phase=verify status=$verify_status elapsed_ms=$verify_elapsed_ms"

deploy_completed=1
trap - ERR
total_elapsed_ms="$(elapsed_ms "$deploy_started_ms")"

if [[ "$verify_status" != "ok" ]]; then
  echo "deploy-total status=failed elapsed_ms=$total_elapsed_ms services=${services[*]}"
  emit_report failed "$total_elapsed_ms"
  exit 1
fi

printf 'deployed services: %s\n' "${services[*]}"
echo "deploy-total status=ok elapsed_ms=$total_elapsed_ms services=${services[*]}"
emit_report ok "$total_elapsed_ms"
