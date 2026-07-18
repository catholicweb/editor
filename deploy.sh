#!/usr/bin/env bash
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
# Required env vars (export these or put them in a .env file and `source` it):
#   CLOUDFLARE_API_TOKEN   - API token with Zone.DNS:Edit + Account.Cloudflare Pages:Edit
#   CLOUDFLARE_ACCOUNT_ID  - Cloudflare account ID
#   CLOUDFLARE_ZONE_ID     - Zone ID for parroquia.app
#
# Adjust these to match your project:
PROJECT_NAME="editor-parroquia"          # Cloudflare Pages project name
CUSTOM_DOMAIN="editor.parroquia.app"     # Full hostname you want live
BUILD_DIR="docs/.vitepress/dist"         # VitePress output dir (adjust if different)
BUILD_CMD="npm run build"           # Your VitePress build command

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID}"
: "${CLOUDFLARE_ZONE_ID:?Set CLOUDFLARE_ZONE_ID}"

API="https://api.cloudflare.com/client/v4"
AUTH_HEADER="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"

echo "▶ 1/5 Building VitePress site..."
${BUILD_CMD}

if [ ! -d "${BUILD_DIR}" ]; then
  echo "✗ Build dir '${BUILD_DIR}' not found. Check BUILD_DIR in this script." >&2
  exit 1
fi

echo "▶ 2/5 Ensuring Cloudflare Pages project '${PROJECT_NAME}' exists..."
if ! npx wrangler pages project list 2>/dev/null | grep -q "${PROJECT_NAME}"; then
  npx wrangler pages project create "${PROJECT_NAME}" --production-branch=main
else
  echo "  already exists, skipping creation"
fi

echo "▶ 3/5 Deploying via Wrangler (Direct Upload)..."
npx wrangler pages deploy "${BUILD_DIR}" \
  --project-name="${PROJECT_NAME}" \
  --branch=main

echo "▶ 4/5 Ensuring DNS CNAME record for ${CUSTOM_DOMAIN}..."
SUBDOMAIN="${CUSTOM_DOMAIN%%.parroquia.app}"
TARGET="${PROJECT_NAME}.pages.dev"

EXISTING_RECORD_ID=$(curl -s -X GET \
  "${API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=CNAME&name=${CUSTOM_DOMAIN}" \
  -H "${AUTH_HEADER}" -H "Content-Type: application/json" \
  | jq -r '.result[0].id // empty')

if [ -z "${EXISTING_RECORD_ID}" ]; then
  echo "  creating new CNAME ${CUSTOM_DOMAIN} -> ${TARGET}"
  curl -s -X POST "${API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
    -H "${AUTH_HEADER}" -H "Content-Type: application/json" \
    --data "{\"type\":\"CNAME\",\"name\":\"${SUBDOMAIN}\",\"content\":\"${TARGET}\",\"ttl\":1,\"proxied\":true}" \
    | jq -e '.success' > /dev/null
else
  echo "  record already exists (id=${EXISTING_RECORD_ID}), updating target just in case"
  curl -s -X PATCH "${API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${EXISTING_RECORD_ID}" \
    -H "${AUTH_HEADER}" -H "Content-Type: application/json" \
    --data "{\"type\":\"CNAME\",\"name\":\"${SUBDOMAIN}\",\"content\":\"${TARGET}\",\"ttl\":1,\"proxied\":true}" \
    | jq -e '.success' > /dev/null
fi

echo "▶ 5/5 Attaching custom domain to Pages project..."
ATTACH_RESPONSE=$(curl -s -X POST \
  "${API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/domains" \
  -H "${AUTH_HEADER}" -H "Content-Type: application/json" \
  --data "{\"name\":\"${CUSTOM_DOMAIN}\"}")

if echo "${ATTACH_RESPONSE}" | jq -e '.success' > /dev/null; then
  echo "  domain attached ✓"
elif echo "${ATTACH_RESPONSE}" | jq -r '.errors[0].message // empty' | grep -qi "already"; then
  echo "  domain already attached, skipping"
else
  echo "  ⚠ unexpected response:"
  echo "${ATTACH_RESPONSE}" | jq .
fi

echo ""
echo "✓ Done. ${CUSTOM_DOMAIN} should resolve within a few minutes"
echo "  (Pages issues a free SSL cert automatically once DNS + domain verification complete)."