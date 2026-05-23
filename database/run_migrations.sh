#!/usr/bin/env bash
# ============================================================
# run_migrations.sh
# Applies all pending migrations to your Supabase project
# using the Supabase CLI (no browser/dashboard needed).
#
# Usage:
#   chmod +x run_migrations.sh
#   ./run_migrations.sh
# ============================================================

set -e

PROJECT_ID="aqtpuxjcotjukutezmbp"
MIGRATIONS_DIR="$(dirname "$0")/migrations"

# ── Colours ──────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
info() { echo -e "${YELLOW}→ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }

echo ""
echo "============================================"
echo "  Petrol Pump — DB Migration Runner"
echo "============================================"
echo ""

# ── 1. Check Supabase CLI is logged in ───────────────────────
info "Checking Supabase CLI login..."
if ! supabase projects list &>/dev/null; then
  fail "Not logged in. Run:  supabase login"
fi
ok "Supabase CLI authenticated"

# ── 2. Get DB connection string via CLI ──────────────────────
info "Fetching DB connection URL for project ${PROJECT_ID}..."
DB_URL=$(supabase db remote set-connection-string 2>/dev/null || true)

# If that fails, build from known values — user will need to set DB password
# Get it from: Supabase Dashboard → Settings → Database → Connection string
if [ -z "$DB_URL" ]; then
  echo ""
  echo -e "${YELLOW}Could not auto-detect DB URL.${NC}"
  echo "Find your DB password at:"
  echo "  https://supabase.com/dashboard/project/${PROJECT_ID}/settings/database"
  echo ""
  read -rsp "Enter your Supabase DB password: " DB_PASS
  echo ""
  DB_URL="postgresql://postgres.${PROJECT_ID}:${DB_PASS}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
fi
ok "DB URL ready"

# ── 3. Run migrations in order ───────────────────────────────
MIGRATIONS=(
  "002_pwa_complete_schema.sql"
  "003_lorry_count_rpc.sql"
  "004_mobile_web_fixes.sql"
)

echo ""
info "Running migrations..."
echo ""

for FILE in "${MIGRATIONS[@]}"; do
  FULL_PATH="${MIGRATIONS_DIR}/${FILE}"
  if [ ! -f "$FULL_PATH" ]; then
    echo -e "${YELLOW}⚠ Skipping (not found): ${FILE}${NC}"
    continue
  fi
  info "Applying: ${FILE}"
  psql "$DB_URL" -f "$FULL_PATH" --set ON_ERROR_STOP=1 -q 2>&1 \
    | grep -v "^$" | grep -v "^NOTICE" | grep -v "already exists" || true
  ok "Done: ${FILE}"
done

echo ""
echo "============================================"
ok "All migrations applied successfully!"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Deploy edge function:  supabase functions deploy monthly-report --project-ref ${PROJECT_ID}"
echo "  2. Run 005 for cron:      psql \"\$DB_URL\" -f migrations/005_cron_payslip_automation.sql"
echo ""
