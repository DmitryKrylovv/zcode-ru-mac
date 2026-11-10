# Заметки по устройству ZCode 3.17.2 и способу патча

Практические наблюдения, добытые при сборке под 3.17.2 (build 9661). Полезны при
пересборке под новые версии.

## Приложение

- ZCode 3.17.2 использует **Electron 44.7.0** (в `Electron Framework.framework`).
- Главный исполняемый файл `Contents/MacOS/ZCode` — только стаб (53 КБ), реальный код
  в `Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework`.

## Fuse-флаги

Блок fuse лежит в бинаре Electron Framework: сентинелла
`dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX`, затем version, число флагов и по байту на флаг
(`'0'` = 0x30 выключен, `'1'` = 0x31 включён). В 3.17.2 состояние
**`101100011`**, порядок флагов Electron 44:

| # | Флаг | Значение |
|---|---|---|
| 0 | RunAsNode | вкл |
| 1 | EnableCookieEncryption | выкл |
| 2 | EnableNodeOptionsEnvironmentVariable | вкл |
| 3 | EnableNodeCliInspectArguments | вкл |
| **4** | **EnableEmbeddedAsarIntegrityValidation** | **выкл** |
| 5 | OnlyLoadAppFromAsar | выкл |
| 6 | LoadBrowserProcessSpecificV8Snapshot | выкл |
| 7 | GrantFileProtocolExtraPrivileges | вкл |
| 8 | WasmTrapHandlers | вкл |

**Важно:** порядок флагов в новых Electron сдвинулся — между `RunAsNode` и
`EnableNodeOptionsEnvironmentVariable` появился `EnableCookieEncryption`. Если читать по
старому списку, флаг честности asar читается как `'1'` и вывод получается неверным.

Поскольку флаг целостности **выключен**, `Contents/Resources/app.asar` можно подменять:
проверка из Electron 44 (`shell/common/asar/archive.cc::Init`) просто не выполняется.

## Хеш в Info.plist не используется

В `Info.plist` есть `ElectronAsarIntegrity` → `Resources/app.asar` →
`c4f9b3d7eb0d10c962652e8d08a078415be498d17be02a827033ecf5faf1d3c6`. Он **не совпадает**
ни с `SHA256(headerString)` (`18c2c824…`, как считает `script/gn-asar-hash.js` из Electron),
ни с SHA256 файла (`12a2fc93…`). Хеш устаревший, но безвредный — при выключенном флаге
он не читается. При включённом — приложение не стартует (в `asar_util.cc` это `LOG(FATAL)`).

## asar запечатан в подписи

`Contents/_CodeSignature/CodeResources` содержит `files2 → Resources/app.asar` с
SHA256 всего файла. Поэтому после любой правки `app.asar` подпись перестаёт быть валидной
и обязательна переподпись:

```bash
xattr -cr /Applications/ZCode.app
codesign --force --deep --sign - /Applications/ZCode.app
```

Подпись становится ad-hoc: приложение работает локально, но macOS может заново запросить
разрешения TCC (запись экрана, универсальный доступ).

## Формат asar (для точечной записи)

```
0..3     uint32 = 4
4..7     uint32 = размер внутреннего pickle (4 + strLen + паддинг)
8..11    uint32 = размер payload внутреннего pickle
12..15   uint32 = длина JSON-заголовка
16..     JSON-заголовок
+ паддинг до 4 байт
данные файлов; offset в заголовке отсчитывается от 8 + u32[4]
```

Практический вывод: `dataStart = 8 + u32[4]` (у 3.17.2 это 8328604). Ошибиться на паддинг
легко — тогда все файлы читаются со сдвигом 1–3 байта и «ломается» всё, что после первого
изменённого файла. Второй подводный камень: смещения нужно присваивать **в том же порядке**,
в котором пишутся данные (порядок обхода заголовка ≠ порядок смещений в архиве).

Распакованные (`unpacked: true`) файлы в 3.17.2 — 5 нативных модулей (`node-pty`,
`sharp` + `libvips`, `ssh2`); они лежат в `app.asar.unpacked` и при патче не трогаются.
Глоб `**/*.node` их не покрывает — `libvips-cpp.*.dylib` нужно учитывать отдельно.

## Что именно патчится (17 файлов)

| Файл | Патч |
|---|---|
| `out/renderer/assets/IntlProvider-*.js` | реестр `X={"zh-CN":m,"en-US":h}` → добавляется `"ru-RU":Object.assign({},h,{…словарь})`; whitelist `===`zh-CN`\|\|x===`en-US`` → + ru; определение системной локали `startsWith('zh')…` → + ветка `ru` |
| `out/renderer/assets/styles-*.js` | пункт «Русский» в селекторе языка, две формы разметки (с `data-testid` и без) |
| `out/renderer/assets/cua-permission-panel-*.js` | словарь панели разрешений: `e["ru-RU"]=Object.assign({},e["en-US"],{…})` |
| `out/main/chunk-*.js` | словарь меню-бара/tray/dock (`wC`): `,"ru-RU":Object.assign({},wC["en-US"],{…})` |
| `out/main/index.js` | словарь диалога «О программе» (`sR`): аналогично |
| `out/host/index.js` | описания встроенных агентов и стилей вывода |
| 10 × `out/{preload,host,scheduler,main}/…` | `enum(["zh-CN","en-US"])` → + `"ru-RU"`; `enum(["system","zh-CN","en-US"])` → + ru |

Схемы Zod с локалями продублированы в каждом слое бандла (renderer, host, scheduler и
7 preload). Если пропустить хотя бы один слой, переключатель принимает «Русский», настройка
сохраняется, но словарь не применяется — самый коварный симптом.

## Как проверялось

1. `scripts/validate.mjs` — сверка собранного asar с оригиналом по SHA256 каждого файла:
   должны отличаться ровно пропатченные, структура и флаги `unpacked` совпадать.
2. Запуск на **копии** приложения (`cp -Rc` = APFS-clone, почти не занимает места) с
   отдельным профилем: `ZCODE_HOME=… ZCODE_DESKTOP_USER_DATA_DIR=…` — иначе срабатывает
   single-instance lock и второй инстанс молча выходит. Внимание: `--user-data-dir`
   ZCode игнорирует, нужны именно его переменные `ZCODE_*`.
3. Чтение интерфейса через DevTools-протокол: запуск с `--remote-debugging-port=9333`,
   затем `Runtime.evaluate` с `document.body.innerText` — так видно реальный результат
   перевода, а не предположение. (`Page.captureScreenshot` там же, если нужен скриншот.)
4. Плагины: в логе главного процесса `plugin-management.listPlugins OK` /
   `getPluginsOverview OK` — что и было целью: версия кода остаётся исходной.
