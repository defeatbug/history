#!/usr/bin/env bash
# ============================================================================
# Resend 域名 DNS 记录自检
# ============================================================================
# 检查在 Resend 添加的域名，其 DNS 记录是否已正确生效。
#
# 用法：
#   ./scripts/check-dns.sh                          # 默认域名
#   ./scripts/check-dns.sh your.domain.com          # 指定域名
#
# 检查项：
#   1. 泛解析检测 —— 若存在泛解析，会掩盖未配置的具体记录
#   2. DKIM  (TXT  resend._domainkey.<域名>)
#   3. SPF   (CNAME rsend.<域名> 与 send.<域名>)
#   4. DMARC (TXT  _dmarc.<域名>)
# ============================================================================
set -uo pipefail

DOMAIN="${1:-hjy.dmmcloud.com}"
RESOLVER="${DNS_RESOLVER:-1.1.1.1}"

GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; RESET=$'\033[0m'

ok()   { printf '%s✅ %s%s\n' "$GREEN" "$1" "$RESET"; }
bad()  { printf '%s❌ %s%s\n' "$RED" "$1" "$RESET"; }
warn() { printf '%s⚠️  %s%s\n' "$YELLOW" "$1" "$RESET"; }
info() { printf '%s▸ %s%s\n' "$CYAN" "$1" "$RESET"; }

query() {
  # query <类型> <名称>
  dig +short "@${RESOLVER}" "$1" "$2" 2>/dev/null | head -1
}

echo "════════════════════════════════════════════════════════════"
echo " Resend DNS 自检"
echo " 域名     : ${DOMAIN}"
echo " 解析器   : ${RESOLVER}"
echo "════════════════════════════════════════════════════════════"
echo

# ---------------------------------------------------------------------------
# 0. 泛解析检测
# ---------------------------------------------------------------------------
echo "── 0. 泛解析检测 ──"
RANDOM_SUB="notexist-$$-$(date +%s)"
WILDCARD_CNAME="$(query CNAME "${RANDOM_SUB}.${DOMAIN}")"
WILDCARD_A="$(query A "${RANDOM_SUB}.${DOMAIN}")"

HAS_WILDCARD=0
if [ -n "$WILDCARD_CNAME" ]; then
  warn "存在泛解析 CNAME：*.${DOMAIN} → ${WILDCARD_CNAME}"
  info "泛解析会掩盖未配置的具体记录 —— 本脚本会对比实际值是否与泛解析不同"
  HAS_WILDCARD=1
elif [ -n "$WILDCARD_A" ]; then
  warn "存在泛解析 A 记录：*.${DOMAIN} → ${WILDCARD_A}"
  HAS_WILDCARD=1
else
  ok "无泛解析"
fi
echo

# 判断某个名称是否「被泛解析顶替」
is_shadowed() {
  local value="$1"
  [ "$HAS_WILDCARD" = "1" ] && [ -n "$value" ] && [ "$value" = "$WILDCARD_CNAME" ]
}

# ---------------------------------------------------------------------------
# 1. DKIM
# ---------------------------------------------------------------------------
echo "── 1. DKIM (TXT) ──"
DKIM_NAME="resend._domainkey.${DOMAIN}"
DKIM_VAL="$(dig +short "@${RESOLVER}" TXT "$DKIM_NAME" 2>/dev/null | head -1)"

if [ -z "$DKIM_VAL" ]; then
  bad "缺失 TXT 记录：${DKIM_NAME}"
elif is_shadowed "$DKIM_VAL"; then
  bad "被泛解析顶替（不是真正的 DKIM 记录）：${DKIM_VAL}"
  info "需要在 DNS 添加 TXT 记录：${DKIM_NAME}"
else
  ok "已配置：${DKIM_VAL:0:60}…"
  info "长度 ${#DKIM_VAL} 字符（完整 DKIM 公钥通常 200+ 字符，被截断会验证失败）"
fi
echo

# ---------------------------------------------------------------------------
# 2. SPF / Enable Sending (CNAME)
# ---------------------------------------------------------------------------
echo "── 2. Enable Sending (CNAME) ──"
for sub in rsend send; do
  NAME="${sub}.${DOMAIN}"
  VAL="$(query CNAME "$NAME")"
  if [ -z "$VAL" ]; then
    bad "缺失 CNAME：${NAME}"
  elif is_shadowed "$VAL"; then
    bad "被泛解析顶替（指向 ${VAL}，应指向 Resend 的 mta.net 服务器）：${NAME}"
  else
    ok "${NAME} → ${VAL}"
  fi
done
echo

# ---------------------------------------------------------------------------
# 3. DMARC（可选）
# ---------------------------------------------------------------------------
echo "── 3. DMARC (TXT，可选) ──"
DMARC_VAL="$(query TXT "_dmarc.${DOMAIN}")"
if [ -z "$DMARC_VAL" ]; then
  warn "未配置 _dmarc.${DOMAIN}（可选，但建议配）"
  info "推荐值：v=DMARC1; p=none;"
elif is_shadowed "$DMARC_VAL"; then
  bad "被泛解析顶替：${DMARC_VAL}"
else
  ok "${DMARC_VAL}"
fi
echo

# ---------------------------------------------------------------------------
# 4. 权威 NS
# ---------------------------------------------------------------------------
echo "── 4. 你的 DNS 服务商 ──"
BASE_DOMAIN="$(echo "$DOMAIN" | sed -E 's/^[^.]+\.//')"
dig +short "@${RESOLVER}" NS "$BASE_DOMAIN" 2>/dev/null | head -4 | sed 's/^/     /'
echo

echo "════════════════════════════════════════════════════════════"
echo " 提示"
echo "════════════════════════════════════════════════════════════"
echo " • 记录值必须从 Resend 页面用「复制按钮」复制完整内容"
echo " • 不要在截图里读，截图里的值会被 [...] 截断"
echo " • DKIM 公钥很长，截断一个字符就无法通过验证"
echo " • 添加后等几分钟到几小时生效，然后重跑本脚本"
