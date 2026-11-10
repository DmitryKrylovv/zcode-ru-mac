#!/bin/bash
# ZCode RU 3.17.2 — установка русской локализации.
# Ставится ПОВЕРХ вашей версии 3.17.2: меняется только app.asar, код приложения тот же,
# поэтому плагины, MCP и скиллы продолжают работать.
set -euo pipefail

APP="/Applications/ZCode.app"
RES="$APP/Contents/Resources"
ASAR="$RES/app.asar"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# архив ищем рядом или в build/ — репозиторий его не хранит, его собирают локально
NEW=""
for c in "$HERE/app-ru.asar" "$HERE/build/app-ru.asar"; do
  [[ -f "$c" ]] && NEW="$c" && break
done
BACKUP_DIR="$HOME/.zcode-ru-backup"
STOCK="$BACKUP_DIR/app.asar.stock"
EXPECT_VER="3.17.2"
STOCK_SHA="12a2fc939df2fcb4188699772590f5151f1f2b90556bd34ecb6d44cf0d793cc6"

log() { echo "==> $*"; }
die() { echo "ОШИБКА: $*" >&2; exit 1; }

[[ "$(uname)" == "Darwin" ]] || die "нужен macOS"
[[ -d "$APP" ]] || die "ZCode.app не найден в /Applications"
[[ -n "$NEW" && -f "$NEW" ]] || die "не найден app-ru.asar (ни рядом со скриптом, ни в build/).
Соберите его из своей установки:  npm run build   (см. README)"

VER=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")
[[ "$VER" == "$EXPECT_VER" ]] || die "пакет собран под ZCode $EXPECT_VER, а установлен $VER.
Нужна пересборка под вашу версию — см. README, раздел «После обновления ZCode»."

pgrep -f "/Applications/ZCode\.app/Contents" >/dev/null && \
  die "ZCode запущен. Закройте его (Cmd+Q) и повторите — установщик не трогает работающее приложение."

NEW_SHA=$(shasum -a 256 "$NEW" | cut -d' ' -f1)
CUR_SHA=$(shasum -a 256 "$ASAR" | cut -d' ' -f1)
if [[ "$CUR_SHA" == "$NEW_SHA" ]]; then log "русификация уже установлена, ничего не меняю"; exit 0; fi

if [[ "$CUR_SHA" == "$STOCK_SHA" ]]; then
  mkdir -p "$BACKUP_DIR"
  if [[ ! -f "$STOCK" ]]; then
    log "бэкап оригинала -> $STOCK"
    cp -f "$ASAR" "$STOCK"
  else
    log "бэкап оригинала уже есть: $STOCK"
  fi
else
  mkdir -p "$BACKUP_DIR"
  ALT="$BACKUP_DIR/app.asar.before-$(date +%Y%m%d-%H%M%S)"
  log "~ текущий app.asar не совпадает с эталонным 3.17.2 — сохраняю его отдельно: $ALT"
  cp -f "$ASAR" "$ALT"
  [[ -f "$STOCK" ]] || cp -f "$ASAR" "$STOCK"
fi

log "устанавливаю app-ru.asar..."
cp -f "$NEW" "$RES/app.asar.new"
mv -f "$RES/app.asar.new" "$ASAR"
xattr -cr "$APP"
log "переподписываю приложение (ad-hoc)..."
codesign --force --deep --sign - "$APP"

log "запускаю ZCode..."
open -a "$APP"
sleep 10
if ! pgrep -f "/Applications/ZCode\.app/Contents" >/dev/null; then
  log "не запустилось — откатываю оригинал"
  cp -f "$STOCK" "$ASAR"
  xattr -cr "$APP"
  codesign --force --deep --sign - "$APP"
  open -a "$APP"
  die "сборка не подошла, оригинал восстановлен"
fi

cat <<'EOF'

Готово. ZCode запущен на русском.
Если язык не переключился: Настройки → Язык → «Русский».

Важно (один раз): подпись заменена на ad-hoc, поэтому macOS может заново
спросить разрешения — «Запись экрана» и «Универсальный доступ». Это нормально.

Откат в любой момент:  ./restore.sh
EOF
