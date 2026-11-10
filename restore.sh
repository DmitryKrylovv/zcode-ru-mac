#!/bin/bash
# Возврат оригинального app.asar (байт-в-байт) и переподпись.
set -euo pipefail
APP="/Applications/ZCode.app"
RES="$APP/Contents/Resources"
ASAR="$RES/app.asar"
STOCK="$HOME/.zcode-ru-backup/app.asar.stock"

log() { echo "==> $*"; }
die() { echo "ОШИБКА: $*" >&2; exit 1; }

[[ -d "$APP" ]] || die "ZCode.app не найден"
[[ -f "$STOCK" ]] || die "бэкап не найден: $STOCK — откатывать нечего"
pgrep -f "/Applications/ZCode\.app/Contents" >/dev/null && die "закройте ZCode (Cmd+Q) и повторите"

log "восстанавливаю оригинальный app.asar ($(shasum -a 256 "$STOCK" | cut -c1-16)...)"
cp -f "$STOCK" "$ASAR"
xattr -cr "$APP"
codesign --force --deep --sign - "$APP"
log "запускаю ZCode"
open -a "$APP"
log "готово — оригинал восстановлен"
