#!/usr/bin/env bash
# Cloud Agent start — per-boot Docker + local Supabase auth backend.
# Idempotent: safe to re-run. Does not leave foreground servers running.
set -euo pipefail

cd "$(dirname "$0")/.."

log() { echo "[cloud-agent-start] $*"; }

ensure_iptables_legacy() {
  if command -v update-alternatives >/dev/null 2>&1; then
    sudo update-alternatives --set iptables /usr/sbin/iptables-legacy >/dev/null 2>&1 || true
    sudo update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy >/dev/null 2>&1 || true
  fi
}

ensure_docker_daemon() {
  if ! command -v dockerd >/dev/null 2>&1; then
    log "dockerd not installed — skipping local Supabase"
    return 1
  fi

  sudo mkdir -p /etc/docker
  if [[ ! -f /etc/docker/daemon.json ]]; then
    echo '{"storage-driver":"fuse-overlayfs","features":{"containerd-snapshotter":false},"iptables":true,"ip-forward":true,"userland-proxy":true}' \
      | sudo tee /etc/docker/daemon.json >/dev/null
  fi

  if docker info >/dev/null 2>&1; then
    log "Docker already running"
    sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
    return 0
  fi

  ensure_iptables_legacy
  sudo rm -f /var/run/docker.pid
  # Ensure the agent user can talk to the socket before readiness checks.
  if ! id -nG 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
    sudo usermod -aG docker "$(id -un)" 2>/dev/null || true
  fi
  sudo dockerd >/tmp/dockerd.log 2>&1 &
  for _ in $(seq 1 45); do
    sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
    if docker info >/dev/null 2>&1; then
      sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
      log "Docker daemon ready"
      return 0
    fi
    sleep 1
  done
  log "Docker daemon failed to become ready — see /tmp/dockerd.log"
  return 1
}

ensure_supabase_cli() {
  if command -v supabase >/dev/null 2>&1; then
    return 0
  fi
  log "supabase CLI missing — skipping local stack"
  return 1
}

write_env_local() {
  # Prefer already-injected hosted Supabase secrets over local stack keys.
  # Cloud Agents that point at production (GSC probes, migrate probes) must not
  # have .env.local overwritten with http://127.0.0.1:54321.
  local hosted="${NEXT_PUBLIC_SUPABASE_URL:-}"
  if [[ -n "$hosted" ]] && [[ "$hosted" != *"127.0.0.1"* ]] && [[ "$hosted" != *"localhost"* ]]; then
    if [[ -n "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" && -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
      cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
EOF
      log "Wrote .env.local from hosted Supabase secrets (skipped local keys)"
      return 0
    fi
  fi

  local api_url anon service
  api_url=$(supabase status -o env 2>/dev/null | awk -F= '/^API_URL=/{print $2}' | tr -d '"')
  anon=$(supabase status -o env 2>/dev/null | awk -F= '/^ANON_KEY=/{print $2}' | tr -d '"')
  service=$(supabase status -o env 2>/dev/null | awk -F= '/^SERVICE_ROLE_KEY=/{print $2}' | tr -d '"')
  if [[ -z "$api_url" || -z "$anon" ]]; then
    log "Could not read supabase status keys"
    return 1
  fi
  cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=${api_url}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}
SUPABASE_SERVICE_ROLE_KEY=${service}
EOF
  log "Wrote .env.local for local Supabase"
}

start_supabase() {
  if supabase status >/dev/null 2>&1; then
    log "Supabase already running"
    write_env_local || true
    return 0
  fi

  # Hosted base tables are not in migrations — start with empty public schema
  # so GoTrue/auth works, then restore migration files for the repo tree.
  local moved=0
  if [[ -d supabase/migrations ]] && [[ -n "$(ls -A supabase/migrations 2>/dev/null || true)" ]]; then
    mv supabase/migrations /tmp/seoranko-migrations-aside
    mkdir -p supabase/migrations
    moved=1
  fi

  set +e
  supabase start
  local rc=$?
  set -e

  if [[ "$moved" -eq 1 ]]; then
    rm -rf supabase/migrations
    mv /tmp/seoranko-migrations-aside supabase/migrations
  fi

  # CLI can exit before health settles — poll status briefly.
  if [[ "$rc" -ne 0 ]]; then
    log "supabase start returned rc=$rc — waiting for services to become ready"
    for _ in $(seq 1 60); do
      if supabase status >/dev/null 2>&1; then
        rc=0
        break
      fi
      sleep 2
    done
  fi

  if [[ "$rc" -ne 0 ]]; then
    log "supabase start failed (rc=$rc)"
    return "$rc"
  fi

  write_env_local
}

main() {
  ensure_iptables_legacy || true
  if ensure_docker_daemon && ensure_supabase_cli; then
    start_supabase || log "Continuing without local Supabase — set hosted secrets for app auth"
  else
    log "Docker/Supabase unavailable — unit tests still work; app auth needs secrets or local stack"
  fi
  log "Start complete"
}

main "$@"
