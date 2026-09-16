#!/usr/bin/env bash
# ============================================================================
# HistoriaQuest —— 云端 Supabase 初始化
# ============================================================================
# 把本地迁移推送到云端 Supabase 项目。
#
# 前置条件：
#   1. 已在 Dashboard 点过 "Resume project"（免费版 7 天不活动会暂停）
#   2. 知道项目数据库密码（Dashboard → Project Settings → Database）
#   3. 已生成 Personal Access Token（https://supabase.com/dashboard/account/tokens）
#
# 用法：
#   npm run cloud:setup
# ============================================================================
set -euo pipefail

# 项目 ref（默认取 .env 里的 URL 推导，可用环境变量覆盖）
DEFAULT_REF="mzimdqaqomldydgapsyo"
PROJECT_REF="${SUPABASE_PROJECT_REF:-$DEFAULT_REF}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

c_ok()   { printf '\033[32m✅ %s\033[0m\n' "$*"; }
c_err()  { printf '\033[31m❌ %s\033[0m\n' "$*"; }
c_info() { printf '\033[36m▸ %s\033[0m\n' "$*"; }
c_warn() { printf '\033[33m⚠️  %s\033[0m\n' "$*"; }

echo "════════════════════════════════════════════════════════════"
echo " 云端 Supabase 初始化"
echo " 项目 ref: $PROJECT_REF"
echo "════════════════════════════════════════════════════════════"
echo

# ---------------------------------------------------------------------------
# 1. 检查 CLI 登录状态
# ---------------------------------------------------------------------------
c_info "检查登录状态…"
if npx supabase projects list >/dev/null 2>&1; then
  c_ok "已登录"
else
  c_warn "未登录"
  echo
  echo "请先登录。CLI 会打开浏览器让你授权："
  echo
  echo "    npx supabase login"
  echo
  echo "或者用 Personal Access Token 非交互登录："
  echo "    npx supabase login --token sbp_你的token"
  echo
  echo "Token 生成地址：https://supabase.com/dashboard/account/tokens"
  echo
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. 关联项目
# ---------------------------------------------------------------------------
c_info "关联项目 ${PROJECT_REF}…"
if npx supabase link --project-ref "$PROJECT_REF"; then
  c_ok "已关联"
else
  c_err "关联失败。常见原因："
  echo "     • 项目被暂停 → 到 Dashboard 点 Resume project"
  echo "     • 数据库密码错误 → Dashboard → Project Settings → Database 可重置"
  echo "     • 网络问题 → 你使用了代理，可尝试临时关闭"
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. 推送迁移
# ---------------------------------------------------------------------------
echo
c_info "推送迁移（会创建 13 张表、32 条 RLS 策略、3 个函数 + 内容种子）…"

# 直连 db.<ref>.supabase.co:5432 在代理环境下常因握手被中断而失败。
# 回退方案：改用 Management API（HTTPS，走 443 端口），
# 由 `supabase db query --linked` 执行合并后的 SQL。
#
# 优点：完全绕开 5432，无需数据库密码。
# 代价：`db query` 不会自动写迁移历史表，需自行补记（见 record_migration_history）。
apply_via_management_api() {
  c_info "生成合并 SQL…"
  if ! bun run scripts/bundle-sql.ts >/dev/null 2>&1; then
    c_err "生成 supabase/bundle.sql 失败"
    return 1
  fi

  c_info "通过 Management API 执行（HTTPS，不走 5432）…"
  if ! npx supabase db query --linked --file supabase/bundle.sql >/dev/null 2>&1; then
    c_err "Management API 执行失败"
    return 1
  fi

  record_migration_history
  c_ok "已通过 Management API 应用全部迁移"
  return 0
}

# 写入迁移历史，使后续 `supabase db push` 不会重复执行已应用的迁移
record_migration_history() {
  local values=""
  local f base version name
  for f in supabase/migrations/*.sql; do
    [ -e "$f" ] || continue
    base="$(basename "$f")"
    version="${base%%_*}"
    name="${base#*_}"
    name="${name%.sql}"
    values="${values}('${version}','${name}'),"
  done
  values="${values%,}"

  [ -z "$values" ] && return 0

  npx supabase db query --linked "
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    );
    insert into supabase_migrations.schema_migrations (version, name)
    values ${values}
    on conflict (version) do nothing;
  " >/dev/null 2>&1 || c_warn "迁移历史记录失败（不影响数据库结构）"
}

push_migrations() {
  # 首选：直连推送（会同时写入迁移历史）
  if npx supabase db push; then
    return 0
  fi

  echo
  c_warn "直连数据库失败（代理环境下 5432 握手常被中断）"
  c_info "改用 Management API（HTTPS）…"
  apply_via_management_api
}

if push_migrations; then
  c_ok "迁移已推送"
else
  c_err "推送失败"
  echo
  echo "手动备选方案："
  echo "  1. 生成合并 SQL：  npm run db:sql"
  echo "  2. 在 Dashboard → SQL Editor 粘贴 supabase/bundle.sql 并执行"
  echo "     https://supabase.com/dashboard/project/$PROJECT_REF/sql/new"
  exit 1
fi

# ---------------------------------------------------------------------------
# 4. 自检
# ---------------------------------------------------------------------------
echo
c_info "运行云端自检…"
if bun run scripts/check-cloud.ts; then
  echo
  c_ok "云端环境已就绪"
else
  echo
  c_warn "自检未全部通过，请查看上面的输出"
  exit 1
fi
