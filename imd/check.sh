#!/usr/bin/env bash
# Free validation of the IMD job before paying. Needs curl and jq.
# 1) import: resolves the repo + commit exactly as IMD wants them
# 2) check: blockers must be []
# 3) quote: "created": true means the exact body passes (nothing is charged, expires in 10 min)
set -euo pipefail
cd "$(dirname "$0")"
API=https://api.imd.fun

echo "== import"
IMPORT=$(curl -s -X POST $API/requests/import -H 'Content-Type: application/json' \
  -d '{"url":"https://github.com/Teino-92/polyhamster","kind":"site"}')
echo "$IMPORT" | jq .
REPO=$(echo "$IMPORT" | jq -r '.source.repoUrl')
COMMIT=$(echo "$IMPORT" | jq -r '.source.baseCommit')
jq --arg r "$REPO" --arg c "$COMMIT" '.repoUrl=$r | .baseCommit=$c' brief.json > brief.final.json

echo "== check"
curl -s -X POST $API/requests/check -H 'Content-Type: application/json' \
  -d "{\"action\":\"job.open\",\"input\":$(jq -c . brief.final.json)}" | jq .

echo "== quote"
KEY=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr A-F a-f)
curl -s -X POST $API/requests/quote -H "Authorization: Bearer $(openssl rand -hex 32)" -H 'Content-Type: application/json' \
  -d "{\"requestKey\":\"$KEY\",\"action\":\"job.open\",\"input\":$(jq -c . brief.final.json)}" | jq .

echo
echo "Body to paste in https://explorer.imd.fun/launch (imd/brief.final.json):"
jq -c . brief.final.json
