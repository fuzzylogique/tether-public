#!/usr/bin/env bash
# Create the Vultr VM Tether deploys to, through the Vultr API, and print its IP.
#
#   VULTR_API_KEY=... infra/vultr-create.sh [label] [region] [plan]
#
# Defaults: label tether, region yto (Toronto), plan vc2-2c-4gb (the Next build needs ~3 GB of heap). Uses, or
# creates, ~/.ssh/id_ed25519 and registers its public key so deploy.sh can log in as root. Idempotent on the
# label: an existing instance with the same label is reused.
set -euo pipefail
: "${VULTR_API_KEY:?set VULTR_API_KEY (Vultr → Account → API)}"
LABEL="${1:-tether}"; REGION="${2:-yto}"; PLAN="${3:-vc2-2c-4gb}"
API="https://api.vultr.com/v2"
auth=(-H "Authorization: Bearer $VULTR_API_KEY" -H "Content-Type: application/json")

[ -f ~/.ssh/id_ed25519.pub ] || ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 -C tether-deploy >/dev/null
PUB="$(cat ~/.ssh/id_ed25519.pub)"
KEY_ID="$(curl -fsS "${auth[@]}" "$API/ssh-keys" | python3 -c 'import json,sys; pub=sys.argv[1].split()[1]; print(next((k["id"] for k in json.load(sys.stdin)["ssh_keys"] if k["ssh_key"].split()[1]==pub), ""))' "$PUB")"
if [ -z "$KEY_ID" ]; then
  KEY_ID="$(curl -fsS "${auth[@]}" -X POST "$API/ssh-keys" -d "$(python3 -c 'import json,sys; print(json.dumps({"name":"tether-deploy","ssh_key":sys.argv[1]}))' "$PUB")" | python3 -c 'import json,sys; print(json.load(sys.stdin)["ssh_key"]["id"])')"
fi

OS_ID="$(curl -fsS "${auth[@]}" "$API/os?per_page=500" | python3 -c 'import json,sys; os=json.load(sys.stdin)["os"]; print(next(o["id"] for o in os if o["name"].startswith("Ubuntu 24.04") and o["arch"]=="x64"))')"
INSTANCE="$(curl -fsS "${auth[@]}" "$API/instances?label=$LABEL" | python3 -c 'import json,sys; i=json.load(sys.stdin)["instances"]; print(i[0]["id"] if i else "")')"
if [ -z "$INSTANCE" ]; then
  INSTANCE="$(curl -fsS "${auth[@]}" -X POST "$API/instances" -d "$(python3 -c 'import json,sys; print(json.dumps({"region":sys.argv[1],"plan":sys.argv[2],"os_id":int(sys.argv[3]),"label":sys.argv[4],"hostname":sys.argv[4],"sshkey_id":[sys.argv[5]],"backups":"disabled","enable_ipv6":False}))' "$REGION" "$PLAN" "$OS_ID" "$LABEL" "$KEY_ID")" | python3 -c 'import json,sys; print(json.load(sys.stdin)["instance"]["id"])')"
  echo "→ created instance $INSTANCE in $REGION ($PLAN)"
else
  echo "→ reusing instance $INSTANCE"
fi

for _ in $(seq 1 60); do
  read -r STATUS IP < <(curl -fsS "${auth[@]}" "$API/instances/$INSTANCE" | python3 -c 'import json,sys; i=json.load(sys.stdin)["instance"]; print(i["status"], i["main_ip"])')
  [ "$STATUS" = "active" ] && [ "$IP" != "0.0.0.0" ] && break
  sleep 5
done
[ "$STATUS" = "active" ] || { echo "instance not active yet ($STATUS)"; exit 1; }
for _ in $(seq 1 36); do ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 "root@$IP" true 2>/dev/null && break; sleep 5; done
echo "✓ $IP  →  next: infra/deploy.sh $IP"
echo "$IP"
