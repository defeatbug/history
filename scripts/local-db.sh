#!/usr/bin/env bash
# ============================================================================
# HistoriaQuest —— 本地 PostgreSQL 开发数据库
# ============================================================================
# 用途：
#   用单个 postgres:15 容器（约 150 MB）代替整套 Supabase 本地栈（约 2.5 GB），
#   用于开发与测试数据库层：迁移、RLS、触发器、存储过程、算法。
#
# 适用场景：
#   ✅ 编写/调试 SQL 迁移
#   ✅ 验证 RLS 权限策略
#   ✅ 测试存储过程（如 evaluate_badges、后续的 SM-2 调度）
#   ❌ 前端联调（supabase-js 需要 PostgREST，裸 PG 没有）
#      前端联调请连云端 Supabase 项目
#
# 用法：
#   ./scripts/local-db.sh up       # 启动并初始化（迁移 + seed）
#   ./scripts/local-db.sh reset    # 重放所有迁移 + seed
#   ./scripts/local-db.sh psql     # 进入交互式 psql
#   ./scripts/local-db.sh test     # 跑一遍完整性自检
#   ./scripts/local-db.sh logs     # 查看数据库日志
#   ./scripts/local-db.sh down     # 停止并删除容器
#   ./scripts/local-db.sh status   # 查看状态与连接串
# ============================================================================
set -euo pipefail

CONTAINER="hq-dev-pg"
PORT="${HQ_PG_PORT:-55432}"
PASSWORD="postgres"
DB="postgres"

# 优先复用本地已有的 postgres 镜像，避免重复下载。
# 按优先级尝试，取第一个本地已存在的；都没有才回退到最小的那个。
IMAGE_CANDIDATES=("postgres:17-alpine" "postgres:15-alpine" "postgres:17" "postgres:15" "postgres:16-alpine")
IMAGE=""
pick_image() {
  local c
  for c in "${IMAGE_CANDIDATES[@]}"; do
    if docker image inspect "$c" >/dev/null 2>&1; then
      IMAGE="$c"
      return 0
    fi
  done
  # 本地一个都没有，回退到体积最小的官方镜像
  IMAGE="postgres:17-alpine"
  return 1
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/supabase/migrations"
SEED_FILE="$ROOT_DIR/supabase/seed.sql"
AUTH_STUB="$ROOT_DIR/scripts/local-db/auth-stub.sql"

# Docker 内用于暂存 SQL 的目录（避免依赖挂载权限）
WORKDIR="/tmp/hq-sql"

# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------
c_ok()   { printf '\033[32m✅ %s\033[0m\n' "$*"; }
c_err()  { printf '\033[31m❌ %s\033[0m\n' "$*"; }
c_info() { printf '\033[36m▸ %s\033[0m\n' "$*"; }

require_docker() {
  if ! docker info >/dev/null 2>&1; then
    c_err "Docker 未运行。请先启动 Docker Desktop。"
    exit 1
  fi
}

is_running() {
  [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)" = "true" ]
}

exists() {
  docker inspect "$CONTAINER" >/dev/null 2>&1
}

wait_ready() {
  local i
  for i in $(seq 1 30); do
    if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  c_err "数据库启动超时"
  return 1
}

# 把迁移与 seed 拷进容器（比挂载更省事，且不依赖宿主目录权限）
push_sql() {
  docker exec "$CONTAINER" mkdir -p "$WORKDIR"
  docker cp "$AUTH_STUB" "$CONTAINER:$WORKDIR/00-auth-stub.sql" >/dev/null
  local f n
  for f in "$MIGRATIONS_DIR"/*.sql; do
    [ -e "$f" ] || continue
    n="$(basename "$f")"
    docker cp "$f" "$CONTAINER:$WORKDIR/$n" >/dev/null
  done
  if [ -f "$SEED_FILE" ]; then
    docker cp "$SEED_FILE" "$CONTAINER:$WORKDIR/99-seed.sql" >/dev/null
  fi
}

run_sql_file() {
  docker exec "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q -f "$1"
}

# ---------------------------------------------------------------------------
# 命令
# ---------------------------------------------------------------------------
cmd_up() {
  require_docker

  if is_running; then
    c_info "容器 $CONTAINER 已在运行"
  else
    if exists; then
      c_info "启动已存在的容器…"
      docker start "$CONTAINER" >/dev/null
    else
      if pick_image; then
        c_ok "复用本地镜像：$IMAGE"
      else
        c_info "本地无 postgres 镜像，将拉取 ${IMAGE}…"
      fi
      c_info "创建并启动容器（端口 ${PORT}）…"
      docker run -d --name "$CONTAINER" \
        -e POSTGRES_PASSWORD="$PASSWORD" \
        -p "$PORT:5432" \
        "$IMAGE" >/dev/null
    fi
    wait_ready
    c_ok "PostgreSQL 已就绪"
  fi

  c_info "应用认证桩 + 迁移 + seed…"
  push_sql
  run_sql_file "$WORKDIR/00-auth-stub.sql"

  local f
  for f in "$MIGRATIONS_DIR"/*.sql; do
    [ -e "$f" ] || continue
    local n; n="$(basename "$f")"
    printf '  %-46s' "$n"
    if run_sql_file "$WORKDIR/$n" 2>/dev/null; then
      printf '\033[32m✅\033[0m\n'
    else
      printf '\033[31m❌\033[0m\n'
      docker exec "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -f "$WORKDIR/$n" 2>&1 | head -10
      exit 1
    fi
  done

  if [ -f "$SEED_FILE" ]; then
    printf '  %-46s' "99-seed.sql"
    run_sql_file "$WORKDIR/99-seed.sql" && printf '\033[32m✅\033[0m\n'
  fi

  c_ok "初始化完成"
  cmd_status
}

cmd_reset() {
  require_docker
  is_running || { c_err "容器未运行，请先执行：$0 up"; exit 1; }

  c_info "重置 public / auth schema…"
  docker exec "$CONTAINER" psql -U postgres -q -c \
    "drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;" >/dev/null

  cmd_up
}

cmd_psql() {
  require_docker
  is_running || { c_err "容器未运行，请先执行：$0 up"; exit 1; }
  docker exec -it "$CONTAINER" psql -U postgres
}

cmd_test() {
  require_docker
  is_running || { c_err "容器未运行，请先执行：$0 up"; exit 1; }

  echo "── 1. 内容表行数 ──"
  docker exec "$CONTAINER" psql -U postgres -c "
    select 'courses' t, count(*) n from courses
    union all select 'questions', count(*) from questions
    union all select 'badges', count(*) from badges
    union all select 'history_events', count(*) from history_events
    union all select 'timeline_events', count(*) from timeline_events
    union all select 'museums', count(*) from museums
    union all select 'artifacts', count(*) from artifacts
    order by 1;"

  echo "── 2. RLS 策略数量 ──"
  docker exec "$CONTAINER" psql -U postgres -tAc \
    "select count(*) || ' 条策略 / ' || count(distinct tablename) || ' 张表' from pg_policies where schemaname='public';"

  echo "── 3. 安全定义函数 ──"
  docker exec "$CONTAINER" psql -U postgres -tAc \
    "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef order by 1;"

  echo "── 4. 注册触发器 ──"
  docker exec "$CONTAINER" psql -U postgres -tAc \
    "select tgname from pg_trigger where not tgisinternal and tgname like '%user%';"

  echo "── 5. anon 读内容表（应为 14）──"
  docker exec "$CONTAINER" psql -U postgres -tAc \
    "set role anon; select count(*) from courses;"

  echo "── 6. anon 读私有表（应为 0，被 RLS 拦截）──"
  docker exec "$CONTAINER" psql -U postgres -tAc \
    "set role anon; select count(*) from user_progress;"

  c_ok "自检完成（请人工核对上述数字）"
}

cmd_logs() {
  docker logs --tail 40 "$CONTAINER"
}

cmd_down() {
  require_docker
  if exists; then
    docker rm -f "$CONTAINER" >/dev/null
    c_ok "容器已删除"
  else
    c_info "容器不存在"
  fi
}

cmd_status() {
  require_docker
  if is_running; then
    # 镜像名从容器实际配置读取，避免 reset 等路径下 IMAGE 未赋值
    local img
    img="$(docker inspect "$CONTAINER" --format '{{.Config.Image}}' 2>/dev/null || echo postgres)"
    c_ok "运行中（镜像 ${img}）"
    echo "  容器名 : $CONTAINER"
    echo "  连接串 : postgresql://postgres:$PASSWORD@127.0.0.1:$PORT/$DB"
    echo "  psql   : ./scripts/local-db.sh psql"
  elif exists; then
    c_info "已停止（./scripts/local-db.sh up 启动）"
  else
    c_info "未创建（./scripts/local-db.sh up 创建）"
  fi
}

usage() {
  sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 1
}

case "${1:-}" in
  up)     cmd_up ;;
  reset)  cmd_reset ;;
  psql)   cmd_psql ;;
  test)   cmd_test ;;
  logs)   cmd_logs ;;
  down)   cmd_down ;;
  status) cmd_status ;;
  *)      usage ;;
esac
