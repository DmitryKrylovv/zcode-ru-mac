#!/bin/bash
# Возврат оригинального ZCode (без русификации).
#   ./restore.sh
#   bash <(curl -fsSL https://raw.githubusercontent.com/DmitryKrylovv/zcode-ru-mac/main/restore.sh)
set -euo pipefail
APP="/Applications/ZCode.app"
ASAR="$APP/Contents/Resources/app.asar"
STOCK="$HOME/.zcode-ru-backup/app.asar.stock"

log() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mОШИБКА:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(uname)" == "Darwin" ]] || die "только для macOS"
[[ -d "$APP" ]] || die "не нашёл ZCode.app в /Applications"
[[ -f "$STOCK" ]] || die "резервная копия не найдена ($STOCK) — откатывать нечего: русификатор не ставился этим установщиком"
pgrep -f "/Applications/ZCode\.app/Contents" >/dev/null && die "ZCode запущен. Закройте его (Cmd+Q) и повторите."

log "возвращаю оригинальный app.asar ($(shasum -a 256 "$STOCK" | cut -c1-16)…)"
cp -f "$STOCK" "$ASAR"
xattr -cr "$APP"
codesign --force --deep --sign - "$APP"
log "запускаю ZCode"
open -a "$APP"
log "готово — ZCode вернулся к оригиналу"
