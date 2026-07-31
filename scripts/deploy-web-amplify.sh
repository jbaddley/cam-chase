#!/usr/bin/env bash
#
# Stand up (or update) the AWS Amplify Hosting app for apps/web and run the
# first build. Idempotent: safe to re-run. Does NOT touch DNS — the photochase.app
# cutover is a separate, reviewed step (share the printed App id and I'll generate
# the Route 53 change-batch).
#
# Prerequisites
#   • AWS credentials with Amplify + IAM permissions (your default profile).
#   • A GitHub token so Amplify can connect the repo — a classic PAT with `repo`
#     scope. Export it first; it is passed as a CLI arg and never written to disk:
#         export GITHUB_TOKEN=ghp_xxx
#   • Optional, for universal links to actually verify (placeholders serve until set):
#         export APPLE_APP_ID="TEAMID.app.photochase.client"
#         export ANDROID_SHA256_CERT_FINGERPRINTS="AA:BB:..,CC:DD:.."
#
# If the repo connection fails with a GitHub-App error, the token method is not
# permitted for this repo — fall back to the console: Amplify > Create new app >
# GitHub (the amplify.yml in the repo root drives the monorepo build either way).
#
# Usage:  export GITHUB_TOKEN=...   &&   ./scripts/deploy-web-amplify.sh

set -euo pipefail

REGION="us-east-1"
APP_NAME="photochase-web"
REPO="https://github.com/jbaddley/cam-chase"
BRANCH="main"
APP_ROOT="apps/web"
ROLE_NAME="photochase-amplify-ssr"

: "${GITHUB_TOKEN:?export GITHUB_TOKEN=<GitHub PAT with repo scope> first}"
NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://yragu7zl51.execute-api.us-east-1.amazonaws.com}"
APPLE_APP_ID="${APPLE_APP_ID:-}"
ANDROID_SHA256_CERT_FINGERPRINTS="${ANDROID_SHA256_CERT_FINGERPRINTS:-}"

command -v aws >/dev/null || { echo "aws CLI not found"; exit 1; }
aws sts get-caller-identity >/dev/null || { echo "AWS credentials not working"; exit 1; }

echo "▶ Region $REGION | App $APP_NAME | Repo $REPO@$BRANCH | Root $APP_ROOT"

# ── Service role Amplify assumes to deploy the SSR compute ────────────────────
ROLE_ARN="${AMPLIFY_SERVICE_ROLE_ARN:-}"
if [ -z "$ROLE_ARN" ]; then
  ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null || true)
  if [ -z "$ROLE_ARN" ] || [ "$ROLE_ARN" = "None" ]; then
    echo "▶ Creating service role $ROLE_NAME…"
    ROLE_ARN=$(aws iam create-role --role-name "$ROLE_NAME" \
      --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"amplify.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
      --query 'Role.Arn' --output text)
    aws iam attach-role-policy --role-name "$ROLE_NAME" \
      --policy-arn arn:aws:iam::aws:policy/AdministratorAccess-Amplify
    echo "  waiting for IAM to propagate…"; sleep 12
  fi
fi
echo "▶ Service role: $ROLE_ARN"

# ── Environment variables (JSON, so comma-separated fingerprints survive) ─────
ENV_JSON="{\"AMPLIFY_MONOREPO_APP_ROOT\":\"$APP_ROOT\",\"NEXT_PUBLIC_API_URL\":\"$NEXT_PUBLIC_API_URL\""
[ -n "$APPLE_APP_ID" ] && ENV_JSON="$ENV_JSON,\"APPLE_APP_ID\":\"$APPLE_APP_ID\""
[ -n "$ANDROID_SHA256_CERT_FINGERPRINTS" ] && ENV_JSON="$ENV_JSON,\"ANDROID_SHA256_CERT_FINGERPRINTS\":\"$ANDROID_SHA256_CERT_FINGERPRINTS\""
ENV_JSON="$ENV_JSON}"

# ── Create or reuse the app ───────────────────────────────────────────────────
APP_ID=$(aws amplify list-apps --region "$REGION" --query "apps[?name=='$APP_NAME'].appId | [0]" --output text)
if [ "$APP_ID" = "None" ] || [ -z "$APP_ID" ]; then
  echo "▶ Creating Amplify app…"
  APP_ID=$(aws amplify create-app \
    --name "$APP_NAME" --region "$REGION" \
    --repository "$REPO" --access-token "$GITHUB_TOKEN" \
    --platform WEB_COMPUTE \
    --iam-service-role-arn "$ROLE_ARN" \
    --environment-variables "$ENV_JSON" \
    --enable-branch-auto-build \
    --query 'app.appId' --output text)
  echo "  created app $APP_ID"
else
  echo "▶ Reusing app $APP_ID (updating platform/env/role)…"
  aws amplify update-app --region "$REGION" --app-id "$APP_ID" \
    --platform WEB_COMPUTE --iam-service-role-arn "$ROLE_ARN" \
    --environment-variables "$ENV_JSON" >/dev/null
fi

# ── Create the branch if needed ───────────────────────────────────────────────
if ! aws amplify get-branch --region "$REGION" --app-id "$APP_ID" --branch-name "$BRANCH" >/dev/null 2>&1; then
  echo "▶ Creating branch $BRANCH…"
  aws amplify create-branch --region "$REGION" --app-id "$APP_ID" \
    --branch-name "$BRANCH" --stage PRODUCTION --enable-auto-build >/dev/null
fi

# ── Build ─────────────────────────────────────────────────────────────────────
echo "▶ Starting build…"
JOB_ID=$(aws amplify start-job --region "$REGION" --app-id "$APP_ID" \
  --branch-name "$BRANCH" --job-type RELEASE --query 'jobSummary.jobId' --output text)
echo "  job $JOB_ID (a few minutes)…"
while true; do
  STATUS=$(aws amplify get-job --region "$REGION" --app-id "$APP_ID" \
    --branch-name "$BRANCH" --job-id "$JOB_ID" --query 'job.summary.status' --output text)
  echo "  status: $STATUS"
  case "$STATUS" in
    SUCCEED) break ;;
    FAILED|CANCELLED) echo "✗ Build $STATUS — open the Amplify console for logs (App id $APP_ID)."; exit 1 ;;
  esac
  sleep 15
done

DOMAIN=$(aws amplify get-app --region "$REGION" --app-id "$APP_ID" --query 'app.defaultDomain' --output text)
URL="https://$BRANCH.$DOMAIN"
echo
echo "✅ Deployed to $URL"
echo "   Verify BEFORE any DNS change:"
echo "     curl -i $URL/.well-known/assetlinks.json    # expect application/json"
echo "     open   $URL/j/ABC234"
echo
echo "   App id: $APP_ID  ← share this and I'll generate the photochase.app Route 53 cutover."
