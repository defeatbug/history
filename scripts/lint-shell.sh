#!/usr/bin/env bash
# ============================================================================
# Shell 脚本静态检查
# ============================================================================
# 本项目踩过的坑：脚本里的中文全角标点紧跟变量时，
# Bash 会把全角字符也当成变量名的一部分，导致 "unbound variable"。
#
#   错误写法： "关联项目 $PROJECT_REF…"   → 变量名被解析为 PROJECT_REF…
#   正确写法： "关联项目 ${PROJECT_REF}…"
#
# 本脚本同时做两件事：
#   1. bash -n 语法检查
#   2. 检测 $VAR 紧跟非 ASCII 字符的危险写法
#
# 用法：npm run lint:sh
# ============================================================================
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'

files=()
while IFS= read -r f; do
  files+=("$f")
done < <(find scripts -name '*.sh' -type f 2>/dev/null | sort)

if [ ${#files[@]} -eq 0 ]; then
  echo "未找到 shell 脚本"
  exit 0
fi

problems=0

for f in "${files[@]}"; do
  # --- 1. 语法检查 ---
  if ! err="$(bash -n "$f" 2>&1)"; then
    printf '%s❌ %s%s\n' "$RED" "$f" "$RESET"
    echo "$err" | sed 's/^/     /'
    problems=$((problems + 1))
    continue
  fi

  # --- 2. 检测 $VAR 紧跟非 ASCII 字符（跳过注释行）---
  # 用 perl 精确匹配：$变量名 后面直接跟多字节字符
  if hits="$(perl -ne 'print "$.: $_" if !/^\s*#/ && /\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7f]/' "$f" 2>/dev/null)"; then
    if [ -n "$hits" ]; then
      printf '%s⚠️  %s —— 变量后紧跟非 ASCII 字符，必须用 ${VAR} 包裹：%s\n' "$YELLOW" "$f" "$RESET"
      echo "$hits" | sed 's/^/     /'
      problems=$((problems + 1))
      continue
    fi
  fi

  printf '%s✅ %s%s\n' "$GREEN" "$f" "$RESET"
done

echo
if [ "$problems" -eq 0 ]; then
  printf '%s✅ %d 个脚本全部通过%s\n' "$GREEN" "${#files[@]}" "$RESET"
  exit 0
else
  printf '%s❌ 发现 %d 个问题%s\n' "$RED" "$problems" "$RESET"
  exit 1
fi
