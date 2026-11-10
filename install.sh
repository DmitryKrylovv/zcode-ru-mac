#!/bin/bash
# ZCode на русском — установка/откат русской локализации ZCode Desktop (macOS).
#
# Установка одной строкой (сначала закройте ZCode: Cmd+Q):
#   bash <(curl -fsSL https://raw.githubusercontent.com/DmitryKrylovv/zcode-ru-mac/main/install.sh)
#
# Из склонированного репозитория:   ./install.sh
# Откат:                            ./restore.sh
#
# Параметры:
#   --check          только скачать архив и проверить контрольную сумму, приложение не трогать
#   --asar ПУТЬ      использовать готовый архив из другого места
#   --tag ТЕГ        взять архив из другого релиза (по умолчанию v1.0.0)
#   --restore        вернуть оригинальный app.asar (то же, что restore.sh)
#
# Приватный репозиторий:  GITHUB_TOKEN=$(gh auth token) bash <(curl -fsSL .../install.sh)

set -euo pipefail

REPO="DmitryKrylovv/zcode-ru-mac"
TAG="v1.0.0"
EXPECT_VER="3.17.2"
EXPECT_SHA="c1dd8ac567fbd06ed0c80ff6c30577542a2d46cd7a7c99c6cae118efc8ceb81b"

APP="/Applications/ZCode.app"
RES="$APP/Contents/Resources"
ASAR="$RES/app.asar"
BACKUP_DIR="$HOME/.zcode-ru-backup"
STOCK="$BACKUP_DIR/app.asar.stock"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" || HERE="."

log()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!  \033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mОШИБКА:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
ZCode на русском — установка и откат.

  bash install.sh                установить
  bash install.sh --check        только скачать и проверить архив
  bash install.sh --asar ПУТЬ    использовать готовый архив из другого места
  bash install.sh --tag ТЕГ      взять другой релиз (по умолчанию v1.0.0)
  bash install.sh --restore      вернуть оригинал

Перед установкой закройте ZCode (Cmd+Q).
EOF
}

MODE="install"; ASAR_SRC=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check)   MODE="check" ;;
    --restore) MODE="restore" ;;
    --asar)    ASAR_SRC="${2:-}"; [ -n "$ASAR_SRC" ] || die "--asar требует путь"; shift ;;
    --tag)     TAG="${2:-}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "неизвестный параметр: $1 (см. install.sh --help)" ;;
  esac
  shift
done

[[ "$(uname)" == "Darwin" ]] || die "этот установщик только для macOS"
[[ -d "$APP" ]] || die "не нашёл ZCode.app в /Applications"

VER=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || echo "?")
[[ "$VER" == "$EXPECT_VER" ]] || die "этот выпуск собран под ZCode $EXPECT_VER, а у вас $VER.
Для другой версии русификатор нужно пересобрать — см. README, раздел «Другая версия ZCode»."

# ─── откат ────────────────────────────────────────────────────────────────────
if [[ "$MODE" == "restore" ]]; then
  [[ -f "$STOCK" ]] || die "резервная копия не найдена: $STOCK — откатывать нечего"
  pgrep -f "/Applications/ZCode\.app/Contents" >/dev/null && die "ZCode запущен. Закройте его (Cmd+Q) и повторите."
  log "возвращаю оригинальный app.asar"
  cp -f "$STOCK" "$ASAR"
  xattr -cr "$APP"
  codesign --force --deep --sign - "$APP"
  open -a "$APP"
  log "готово — ZCode вернулся к оригиналу"
  exit 0
fi

# ─── где взять архив ──────────────────────────────────────────────────────────
TMPDIR_RU=""
cleanup() { [[ -n "$TMPDIR_RU" && -d "$TMPDIR_RU" ]] && rm -rf "$TMPDIR_RU"; }
trap cleanup EXIT

if [[ -n "$ASAR_SRC" ]]; then
  [[ -f "$ASAR_SRC" ]] || die "не нахожу архив: $ASAR_SRC"
  NEW="$ASAR_SRC"
  log "использую свой архив: $NEW"
elif [[ -f "$HERE/app-ru.asar" ]]; then
  NEW="$HERE/app-ru.asar"
  log "использую архив рядом со скриптом"
elif [[ -f "$HERE/build/app-ru.asar" ]]; then
  NEW="$HERE/build/app-ru.asar"
  log "использую архив из build/"
else
  # запуск одной строкой: скачиваем архив из релиза
  TMPDIR_RU="$(mktemp -d)"
  NEW="$TMPDIR_RU/app-ru.asar"
  log "скачиваю русификатор ($TAG, ~350 МБ) ..."
  downloaded=0

  # путь 1: gh CLI — самый надёжный, работает и для приватного репозитория
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if gh release download "$TAG" --repo "$REPO" --pattern 'app-ru.asar' --dir "$TMPDIR_RU" >/dev/null 2>&1; then
      log "скачано через gh CLI"
      downloaded=1
    fi
  fi

  # путь 2: токен в окружении — тянем через API (для приватного репозитория)
  if [ "$downloaded" = "0" ] && [ -n "${GITHUB_TOKEN:-}" ] && command -v python3 >/dev/null 2>&1; then
    ASSET_ID=$(curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" \
      "https://api.github.com/repos/$REPO/releases/tags/$TAG" 2>/dev/null \
      | python3 -c 'import json,sys
try: a=json.load(sys.stdin)["assets"]
except Exception: a=[]
print(next((x["id"] for x in a if x["name"]=="app-ru.asar"), ""))' 2>/dev/null || true)
    if [ -n "${ASSET_ID:-}" ]; then
      if curl -fL --progress-bar --retry 3 -H "Authorization: Bearer $GITHUB_TOKEN" \
           -H "Accept: application/octet-stream" -o "$NEW" \
           "https://api.github.com/repos/$REPO/releases/assets/$ASSET_ID"; then
        log "скачано через API с токеном"
        downloaded=1
      fi
    fi
  fi

  # путь 3: обычная ссылка релиза — работает, когда репозиторий публичный
  if [ "$downloaded" = "0" ]; then
    URL="https://github.com/$REPO/releases/download/$TAG/app-ru.asar"
    if curl -fL --progress-bar --retry 3 --retry-delay 2 -o "$NEW" "$URL"; then
      downloaded=1
    else
      rm -f "$NEW"
      die "не удалось скачать архив ($URL).

Проверьте подключение к интернету и повторите. Если не помогает — скачайте файл
app-ru.asar вручную из раздела Releases репозитория и положите его рядом с install.sh."
    fi
  fi

  [[ -s "$NEW" ]] || die "архив скачался пустым — повторите"
  if [[ "${ZCODE_RU_SKIP_SHA:-0}" != "1" ]]; then
    GOT=$(shasum -a 256 "$NEW" | cut -d' ' -f1)
    [[ "$GOT" == "$EXPECT_SHA" ]] || die "контрольная сумма не совпала:
  ожидалось $EXPECT_SHA
  получено  $GOT
Файл скачался не полностью или подменён. Удалите его и повторите."
    log "контрольная сумма совпала"
  fi
fi

if [[ "$MODE" == "check" ]]; then
  log "проверка пройдена: архив на месте и корректен. Приложение не тронуто."
  [[ -n "$TMPDIR_RU" ]] && cp -f "$NEW" "./app-ru.asar" && log "сохранил рядом: ./app-ru.asar"
  exit 0
fi

# ─── установка ────────────────────────────────────────────────────────────────
pgrep -f "/Applications/ZCode\.app/Contents" >/dev/null && \
  die "ZCode запущен. Закройте его (Cmd+Q) и повторите — установщик не трогает работающее приложение."

NEW_SHA=$(shasum -a 256 "$NEW" | cut -d' ' -f1)
CUR_SHA=$(shasum -a 256 "$ASAR" | cut -d' ' -f1)
[[ "$CUR_SHA" == "$NEW_SHA" ]] && { log "русификация уже установлена — ничего не меняю"; exit 0; }

mkdir -p "$BACKUP_DIR"
if [[ ! -f "$STOCK" ]]; then
  log "сохраняю оригинал в $STOCK"
  cp -f "$ASAR" "$STOCK"
else
  log "резервная копия оригинала уже есть"
fi

SIZE=$(du -h "$NEW" | cut -f1)
log "устанавливаю ($SIZE) ..."
cp -f "$NEW" "$RES/app.asar.new"
mv -f "$RES/app.asar.new" "$ASAR"
xattr -cr "$APP"
log "переподписываю приложение (ad-hoc) ..."
codesign --force --deep --sign - "$APP"

log "запускаю ZCode ..."
open -a "$APP"
sleep 10
if ! pgrep -f "/Applications/ZCode\.app/Contents" >/dev/null; then
  warn "ZCode не запустился — возвращаю оригинал"
  cp -f "$STOCK" "$ASAR"
  xattr -cr "$APP"
  codesign --force --deep --sign - "$APP"
  open -a "$APP"
  die "этот выпуск не подошёл, оригинал восстановлен. Напишите issue: https://github.com/$REPO/issues"
fi

cat <<'EOF'

Готово — ZCode запущен на русском.
Если язык не переключился: Настройки → Язык → «Русский».

Что стоит знать (один раз):
  • приложение переподписано локально, поэтому macOS может заново спросить
    разрешения «Запись экрана» и «Универсальный доступ» — это нормально;
  • обновление ZCode вернёт английский — после обновления запустите установщик снова.

Откат в любой момент:  ./restore.sh
EOF
