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

echo "▶ 1/2 Building VitePress site..."
${BUILD_CMD}

if [ ! -d "${BUILD_DIR}" ]; then
  echo "✗ Build dir '${BUILD_DIR}' not found. Check BUILD_DIR in this script." >&2
  exit 1
fi

echo "▶ 2/2 Deploying via Wrangler (Direct Upload)..."
npx wrangler pages deploy "${BUILD_DIR}" \
  --project-name="${PROJECT_NAME}" \
  --branch=main

echo ""
echo "✓ Done."