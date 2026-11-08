#!/usr/bin/env bash
# Deploy Tether to a Vultr VM over SSH.
#
#   infra/deploy.sh <ip-or-host> [domain] [--bot]
#
# Copies this checkout (minus node_modules, build output and git history) to /opt/tether on the VM, merges the
# VM's .env with the local one (local non-empty values win, VM-only keys are kept) and rewrites the public URLs, installs Docker if missing, and runs Compose.
# Without a domain the VM is served at https://<ip-with-dashes>.sslip.io, which needs no DNS setup.
# `--bot` also starts the Discord gateway on the VM: stop the laptop's `pnpm dev:server` first (one token, one
# gateway), and set TETHER_RUN_CRONS=1 on exactly one machine.
set -euo pipefail
HOST="${1:?usage: infra/deploy.sh <ip-or-host> [domain] [--bot]}"; shift
DOMAIN=""; BOT=0
for a in "$@"; do case "$a" in --bot) BOT=1;; *) DOMAIN="$a";; esac; done
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH_USER="${SSH_USER:-root}"
# No domain given: an IP becomes its sslip.io name, a hostname is served as itself.
if [ -z "$DOMAIN" ]; then
  if [[ "$HOST" =~ ^[0-9.]+$ ]]; then DOMAIN="${HOST//./-}.sslip.io"; else DOMAIN="$HOST"; fi
fi
[ -f "$ROOT/.env" ] || { echo "$ROOT/.env missing"; exit 1; }

echo "→ $HOST will serve https://$DOMAIN (bot: $BOT)"
# The VM's .env is a merge: keys already on the VM are kept, every non-empty key in the local .env overrides them,
# then the public URLs and single-process flags are fixed for a server. So a teammate whose .env lacks a key
# (Auth0 on one laptop, Google or Instagram on another) does not wipe it from the VM by redeploying.
TMP_ENV="$(mktemp)"; REMOTE_ENV="$(mktemp)"
ssh -o StrictHostKeyChecking=accept-new "$SSH_USER@$HOST" 'cat /opt/tether/.env 2>/dev/null' > "$REMOTE_ENV" || true
FIXED='^(DOMAIN|APP_BASE_URL|WEB_PUBLIC_URL|SERVER_PUBLIC_URL|INNGEST_DEV|NODE_ENV|NEXT_DIST_DIR)='
awk -v fixed="$FIXED" '
  /^[A-Za-z_][A-Za-z0-9_]*=/ {
    key=$0; sub(/=.*/, "", key); val=$0; sub(/^[^=]*=/, "", val); sub(/[[:space:]]+#.*$/, "", val)
    if ($0 ~ fixed) next
    if (FILENAME == ARGV[1]) { if (!(key in seen)) order[++n]=key; seen[key]=1; vals[key]=$0; from[key]="vm" }
    else if (val != "") { if (!(key in seen)) order[++n]=key; seen[key]=1; vals[key]=$0; from[key]="local" }
    else if (!(key in seen)) { order[++n]=key; seen[key]=1; vals[key]=$0; from[key]="local(empty)" }
    next
  }
  END { for (i=1;i<=n;i++) { print vals[order[i]]; if (from[order[i]]=="vm") kept=kept" "order[i] }
        if (kept != "") print "→ kept from the VM (not in local .env):" kept > "/dev/stderr" }
' "$REMOTE_ENV" "$ROOT/.env" > "$TMP_ENV"
rm -f "$REMOTE_ENV"
cat >> "$TMP_ENV" <<ENV

# ---- written by infra/deploy.sh ----
NODE_ENV=production
DOMAIN=$DOMAIN
APP_BASE_URL=https://$DOMAIN
WEB_PUBLIC_URL=https://$DOMAIN
SERVER_PUBLIC_URL=https://$DOMAIN
ENV

ssh -o StrictHostKeyChecking=accept-new "$SSH_USER@$HOST" 'command -v docker >/dev/null || (curl -fsSL https://get.docker.com | sh); mkdir -p /opt/tether'
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .next --exclude '.next-*' --exclude dist --exclude .env --exclude '.claude/worktrees' \
  --exclude demo-clips --exclude '*.mov' --exclude '*.mp4' \
  "$ROOT/" "$SSH_USER@$HOST:/opt/tether/"
scp -q "$TMP_ENV" "$SSH_USER@$HOST:/opt/tether/.env"; rm -f "$TMP_ENV"

PROFILE=""; [ "$BOT" = 1 ] && PROFILE="--profile bot"
ssh "$SSH_USER@$HOST" "cd /opt/tether && docker compose -f infra/docker-compose.yml --env-file .env $PROFILE up -d --build --remove-orphans && docker compose -f infra/docker-compose.yml ps"
echo "✓ https://$DOMAIN  (TLS can take a minute on first boot; Auth0 callback: https://$DOMAIN/auth/callback)"
