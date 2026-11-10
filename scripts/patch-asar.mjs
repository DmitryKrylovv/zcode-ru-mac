#!/usr/bin/env node
// Точечный русификатор app.asar для установленной версии ZCode.
// Не распаковывает архив: подменяет содержимое только пропатченных файлов,
// все остальные байты переносятся 1:1 (поэтому нативные модули и плагины не затрагиваются).
//
// Использование:
//   node scripts/patch-asar.mjs <stock-app.asar> <out-app.asar> [--spike] [--dict <dir>]
//   --spike : ru-словарь = копия en + 3 тестовые строки (проверка цепочки, без перевода)

import { openSync, readSync, writeSync, closeSync, readFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const SPIKE = argv.includes('--spike');
const dictArg = argv.indexOf('--dict');
const DICT_DIR = dictArg >= 0 ? argv[dictArg + 1] : join(ROOT, 'dict/ru');
const positional = argv.filter((a, i) => !a.startsWith('--') && !(dictArg >= 0 && i === dictArg + 1));
const [STOCK, OUT] = positional;
if (!STOCK || !OUT) { console.error('нужны аргументы: <stock.asar> <out.asar>'); process.exit(2); }

const log = (...a) => console.log(...a);
const fails = [];
const patched = [];   // [path, bytesBefore, bytesAfter]

// ─────────────── 1. чтение заголовка
const src = openSync(STOCK, 'r');
const head16 = Buffer.alloc(16); readSync(src, head16, 0, 16, 0);
const jsonLen = head16.readUInt32LE(12);
const jsonBuf = Buffer.alloc(jsonLen); readSync(src, jsonBuf, 0, jsonLen, 16);
const header = JSON.parse(jsonBuf.toString('utf8'));
const dataStart = 8 + head16.readUInt32LE(4);

const entries = [];
(function walk(node, p) {
  for (const [k, v] of Object.entries(node.files ?? {})) {
    const q = p ? p + '/' + k : k;
    if (v.files) { walk(v, q); continue; }
    entries.push([q, v]);
  }
})(header, '');
const packed = entries.filter(([, v]) => !v.unpacked).sort((a, b) => +a[1].offset - +b[1].offset);
const unpackedSet = new Set(entries.filter(([, v]) => v.unpacked).map(([q]) => q));
log(`asar: ${entries.length} файлов (${packed.length} упаковано, ${unpackedSet.size} распаковано), dataStart=${dataStart}`);

const byPath = new Map(entries);
const readEntry = ([, v]) => {
  const buf = Buffer.alloc(v.size);
  readSync(src, buf, 0, v.size, dataStart + (+v.offset));
  return buf;
};
const originalOf = p => readEntry([p, byPath.get(p)]);

// ─────────────── 2. инструменты патча
function patch(name, content, regex, repl, { min = 1, critical = true } = {}) {
  const re = regex.flags.includes('g') ? regex : new RegExp(regex.source, regex.flags + 'g');
  const ms = [...content.matchAll(re)];
  if (ms.length < min) {
    const msg = `[${name}] найдено ${ms.length} (минимум ${min})`;
    log(critical ? '  !! FAIL ' : '  ~ warn ', msg);
    if (critical) fails.push(msg);
    return content;
  }
  log(`  ok [${name}] замен: ${ms.length}`);
  return content.replace(re, repl);
}
function closeBrace(s, openIdx) {
  let depth = 0, inBt = false, inStr = false, esc = false;
  for (let j = openIdx; j < s.length; j++) {
    const ch = s[j];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (inBt) { if (ch === '`') inBt = false; continue; }
    if (inStr) { if (ch === '"') inStr = false; continue; }
    if (ch === '`') { inBt = true; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return j; }
  }
  throw new Error('unbalanced braces');
}
const esc = v => v.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
const objLit = o => Object.entries(o).map(([k, v]) => `"${k}":\`${esc(v)}\``).join(',');

// ─────────────── 3. словарь
let ruItemsText = '';
if (SPIKE) {
  const test = { 'chat.send': 'Отправить', 'settings.title': 'Настройки', 'settings.locale': 'Язык' };
  ruItemsText = objLit(test);
  log('SPIKE: ru-словарь = копия en + 3 тестовые строки');
} else {
  const ru = {};
  for (const f of readdirSync(DICT_DIR).filter(f => f.endsWith('.json')).sort())
    Object.assign(ru, JSON.parse(readFileSync(join(DICT_DIR, f), 'utf8')));
  ruItemsText = objLit(ru);
  log(`ru-словарь: ${Object.keys(ru).length} ключей из ${DICT_DIR}`);
}

// ─────────────── 4. патчи по файлам
const overrides = new Map();
// актуальное содержимое файла: уже пропатченная версия, иначе оригинал
const currentText = path => (overrides.get(path) ?? originalOf(path)).toString('utf8');
const touch = (path, content) => {
  const explored = overrides.has(path);
  const before = currentText(path);
  if (before === content) { log(`  ~ warn без изменений: ${path}`); return; }
  overrides.set(path, Buffer.from(content, 'utf8'));
  if (!explored) patched.push([path, originalOf(path).length, 0]);
  const rec = patched.find(r => r[0] === path);
  rec[2] = Buffer.byteLength(content);
};
const names = entries.map(([q]) => q);
const findOne = (re, what) => {
  const hit = names.filter(q => re.test(q));
  if (hit.length !== 1) { fails.push(`${what}: ожидался 1 файл, найдено ${hit.length} (${hit.slice(0, 4).join(', ')})`); log(`  !! FAIL ${what}: найдено ${hit.length}`); return null; }
  return hit[0];
};

// --- 4.1 IntlProvider: реестр словарей + whitelist'ы + определение системы
const intlPath = findOne(/^out\/renderer\/assets\/IntlProvider-[\w-]+\.js$/, 'IntlProvider');
if (intlPath) {
  let c = currentText(intlPath);
  c = patch('IntlProvider: реестр + ru-словарь', c,
    /(\w+)=\{"zh-CN":(\w+),"en-US":(\w+)\}/,
    (m0, v, z, e) => `${v}={"zh-CN":${z},"en-US":${e},"ru-RU":Object.assign({},${e},{${ruItemsText}})}`,
    { min: 1 });
  c = patch('IntlProvider: whitelist', c, /===`zh-CN`\|\|(\w+)===`en-US`/g,
    (m0, v) => `===\`zh-CN\`||${v}===\`en-US\`||${v}===\`ru-RU\``, { min: 1 });
  c = patch('IntlProvider: определение системы', c,
    /(\w[\w$]*)\.toLowerCase\(\)\.startsWith\(`zh`\)\?`zh-CN`:`en-US`/g,
    (m0, v) => `${v}.toLowerCase().startsWith(\`zh\`)?\`zh-CN\`:${v}.toLowerCase().startsWith(\`ru\`)?\`ru-RU\`:\`en-US\``,
    { min: 1 });
  touch(intlPath, c);
}

// --- 4.2 styles: пункт «Русский» в селекторе языка (две формы разметки)
const stylesPath = findOne(/^out\/renderer\/assets\/styles-[\w-]+\.js$/, 'styles');
if (stylesPath) {
  let s = currentText(stylesPath);
  s = patch('styles: селектор (без testid)', s,
    /\(0,([\w$]+)\.jsx\)\(([\w$]+),\{value:`en-US`,children:([\w$]+)\.formatMessage\(\{id:`((?:sidebar\.)?settings\.locale\.en-US)`\}\)\}\)/g,
    (m0, jsx, comp, v, id) => `(0,${jsx}.jsx)(${comp},{value:\`en-US\`,children:${v}.formatMessage({id:\`${id}\`})}),(0,${jsx}.jsx)(${comp},{value:\`ru-RU\`,children:\`Русский\`})`,
    { min: 1 });
  s = patch('styles: селектор (с testid)', s,
    /\(0,([\w$]+)\.jsx\)\(([\w$]+),\{value:`en-US`,"data-testid":([\w$]+)\(([\w$]+),`en-US`\),children:([\w$]+)\.formatMessage\(\{id:`((?:sidebar\.)?settings\.locale\.en-US)`\}\)\}\)/g,
    (m0, jsx, comp, vo, ra, v, id) => `(0,${jsx}.jsx)(${comp},{value:\`en-US\`,"data-testid":${vo}(${ra},\`en-US\`),children:${v}.formatMessage({id:\`${id}\`})}),(0,${jsx}.jsx)(${comp},{value:\`ru-RU\`,"data-testid":${vo}(${ra},\`ru-RU\`),children:\`Русский\`})`,
    { min: 1 });
  touch(stylesPath, s);
}

// --- 4.3 мелкие словари рендерера: добавляем ru-RU через Object.assign поверх en
const SMALL_RU = {
  'out/renderer/assets/cua-permission-panel': {
    documentTitle: 'Разрешения ZCode Computer Use',
    dragTitle: 'Перетащите меня в список разрешений выше',
    hintPrefix: 'Перетащите значок слева в раздел «',
    hintSuffix: '» выше',
    completion: 'Отпустите, чтобы выдать разрешение — переключатель не нужен',
    accessibility: 'Универсальный доступ',
    screen_recording: 'Запись экрана',
  },
};
for (const [prefix, ruObj] of Object.entries(SMALL_RU)) {
  const p = names.find(q => q.startsWith(prefix) && q.endsWith('.js'));
  if (!p) { log(`  ~ warn мелкий словарь отсутствует: ${prefix}`); continue; }
  let m = currentText(p);
  const anchor = m.match(/(\w+)=\{"zh-CN":\{/);
  if (!anchor) { fails.push(`${prefix}: якорь словаря не найден`); continue; }
  const varName = anchor[1];
  const start = m.indexOf('{"zh-CN":{', anchor.index);
  const close = closeBrace(m, start);
  const ru = SPIKE ? '' : objLit(ruObj);
  m = m.slice(0, close + 1) + `;${varName}[\`ru-RU\`]=Object.assign({},${varName}[\`en-US\`],{${ru}})` + m.slice(close + 1);
  log(`  ok [${prefix}] ru-RU добавлен`);
  touch(p, m);
}

// --- 4.4 main: словарь меню-бара/tray/dock + словарь About
const MENU_RU = {
  'desktopMenu.help.checkingForUpdates': 'Проверка обновлений...',
  'desktopMenu.help.downloadingUpdateProgress': 'Скачивание обновления... {progress}',
  'desktopMenu.help.downloadingUpdateVersion': 'Скачивание обновления {version}...',
  'desktopMenu.help.restartToUpdate': 'Перезапустить для обновления ({version})',
  'desktopMenu.help.updateAvailableVersion': 'Доступна новая версия {version}',
  'dock.menu.showCurrentWindow': 'Показать текущее окно',
  'titleBar.menu.app.hide': 'Скрыть {appName}',
  'titleBar.menu.app.hideOthers': 'Скрыть остальные',
  'titleBar.menu.app.quit': 'Завершить {appName}',
  'titleBar.menu.app.services': 'Службы',
  'titleBar.menu.app.showAll': 'Показать все',
  'titleBar.menu.edit': 'Правка',
  'titleBar.menu.edit.copy': 'Копировать',
  'titleBar.menu.edit.cut': 'Вырезать',
  'titleBar.menu.edit.delete': 'Удалить',
  'titleBar.menu.edit.paste': 'Вставить',
  'titleBar.menu.edit.redo': 'Повторить',
  'titleBar.menu.edit.selectAll': 'Выбрать все',
  'titleBar.menu.edit.undo': 'Отменить',
  'titleBar.menu.file': 'Файл',
  'titleBar.menu.file.closeWindow': 'Закрыть окно',
  'titleBar.menu.file.newTask': 'Новая задача',
  'titleBar.menu.file.openWorkspace': 'Открыть рабочую папку',
  'titleBar.menu.help': 'Справка',
  'titleBar.menu.help.about': 'О программе ZCode',
  'titleBar.menu.help.checkForUpdates': 'Проверить обновления',
  'titleBar.menu.help.clearAllData': 'Очистить все данные',
  'titleBar.menu.help.exportLogs': 'Экспортировать логи',
  'titleBar.menu.help.feedback': 'Обратная связь',
  'titleBar.menu.help.processMonitor': 'Мониторинг процессов',
  'titleBar.menu.help.startPerformanceRecording': 'Начать запись производительности',
  'titleBar.menu.help.stopPerformanceRecording': 'Остановить запись производительности',
  'titleBar.menu.help.toggleDevTools': 'Инструменты разработчика',
  'titleBar.menu.help.toggleZCodeStdioTap': 'Перехват stdio-трафика агента',
  'titleBar.menu.help.whatsNew': 'Что нового',
  'titleBar.menu.help.zcodeEndpoint': 'ZCode Endpoint',
  'titleBar.menu.help.zcodeEndpoint.custom': 'Свой...',
  'titleBar.menu.help.zcodeEndpoint.production': 'Production (по умолчанию)',
  'titleBar.menu.help.zcodeEndpoint.reset': 'Сбросить',
  'titleBar.menu.help.zcodeEndpoint.test': 'Test',
  'titleBar.menu.view': 'Вид',
  'titleBar.menu.view.actualSize': 'Фактический размер',
  'titleBar.menu.view.toggleFullScreen': 'Переключить полный экран',
  'titleBar.menu.view.zoomIn': 'Увеличить',
  'titleBar.menu.view.zoomOut': 'Уменьшить',
  'titleBar.menu.window': 'Окно',
  'titleBar.menu.window.bringAllToFront': 'Все окна вперёд',
  'titleBar.menu.window.minimize': 'Свернуть',
  'titleBar.menu.window.zoom': 'Масштаб',
  'tray.menu.openZCode': 'Открыть ZCode',
  'tray.menu.quit': 'Завершить',
  'tray.tooltip': 'ZCode',
};
for (const p of names.filter(q => /^out\/main\/.+\.js$/.test(q))) {
  let m = currentText(p);
  let changed = false;
  const spAnchor = m.match(/(\w+)=\{"zh-CN":\{"titleBar\.menu\.file"/);
  if (spAnchor) {
    const varName = spAnchor[1];
    const start = m.indexOf('{"zh-CN":{', spAnchor.index);
    const close = closeBrace(m, start);
    m = m.slice(0, close + 1) + `;${varName}[\`ru-RU\`]=Object.assign({},${varName}[\`en-US\`],{${SPIKE ? '' : objLit(MENU_RU)}})` + m.slice(close + 1);
    log(`  ok [main:${p.split('/').pop()} → меню-словарь ${varName}] ru-RU добавлен`);
    changed = true;
  }
  const akAnchor = m.match(/(\w+)=\{"zh-CN":\{aboutTitle:/);
  if (akAnchor) {
    const varName = akAnchor[1];
    const start = m.indexOf('{"zh-CN":{', akAnchor.index);
    const close = closeBrace(m, start);
    const aboutRu = SPIKE ? '' :
      'aboutTitle:`О программе ZCode`,versionLabel:`Версия`,okButtonLabel:`ОК`,' +
      'optimizedForAppleSilicon:`Оптимизировано для Apple Silicon.`,' +
      'copyright:e=>`Все права защищены © ${e} ZCode.`';
    m = m.slice(0, close + 1) + `;${varName}[\`ru-RU\`]=Object.assign({},${varName}[\`en-US\`],{${aboutRu}})` + m.slice(close + 1);
    log(`  ok [main:${p.split('/').pop()} → About-словарь ${varName}] ru-RU добавлен`);
    changed = true;
  }
  if (changed) touch(p, m);
}

// --- 4.5 host: описания встроенных агентов и стилей вывода
const HOST_DESC = [
  ['General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks.',
   'Универсальный агент для исследования сложных вопросов, поиска по коду и выполнения многошаговых задач.'],
  ['Read-only search agent for broad fan-out searches.',
   'Агент поиска только для чтения — широкий параллельный обход.'],
  ['Claude completes coding tasks efficiently and provides concise responses',
   'Claude эффективно решает задачи по коду и отвечает лаконично'],
  ['Claude explains its implementation choices and codebase patterns',
   'Claude объясняет свои решения по реализации и паттерны кодовой базы'],
  ['Claude pauses and asks you to write small pieces of code for hands-on practice',
   'Claude делает паузу и предлагает вам написать небольшие фрагменты кода для практики'],
];
if (!SPIKE) {
  for (const p of names.filter(q => /^out\/host\/.+\.js$/.test(q))) {
    let h = currentText(p);
    let n = 0;
    for (const [en, ru] of HOST_DESC) {
      const b4 = h;
      h = h.split(`description:"${en}"`).join(`description:"${ru}"`);
      if (h !== b4) n++;
    }
    if (n) { log(`  ok [host:${p.split('/').pop()} → описания] замен: ${n}`); touch(p, h); }
  }
}

// --- 4.6 сплошной свип: zod-схемы локалей и whitelist'ы во всех слоях
let swept = 0;
for (const p of names.filter(q => /\.(js|cjs)$/.test(q) && q.startsWith('out/'))) {
  let c = currentText(p);
  const b4 = c;
  c = c.split('enum(["zh-CN","en-US"])').join('enum(["zh-CN","en-US","ru-RU"])');
  c = c.split('enum(["system","zh-CN","en-US"])').join('enum(["system","zh-CN","en-US","ru-RU"])');
  if (p.includes('/assets/')) {
    c = c.replace(/===`zh-CN`\|\|(\w+)===`en-US`/g, (m, v) => `===\`zh-CN\`||${v}===\`en-US\`||${v}===\`ru-RU\``);
  }
  if (c !== b4) { touch(p, c); swept++; }
}
log(`  ok [zod-схемы/whitelist'ы] файлов изменено: ${swept}`);

// --- 4.7 package.json: версия (Electron app.getVersion() читает её)
const pjPath = 'package.json';
if (names.includes(pjPath)) {
  let appVer = null;
  try {
    appVer = String(execFileSync('/usr/libexec/PlistBuddy',
      ['-c', 'Print :CFBundleShortVersionString', '/Applications/ZCode.app/Contents/Info.plist'],
      { encoding: 'utf8' })).trim();
  } catch { log('  ~ warn версия Info.plist не прочитана'); }
  let pj = currentText(pjPath);
  try {
    const o = JSON.parse(pj);
    if (appVer && o.version !== appVer) {
      o.version = appVer;
      log(`  ok [package.json:версия] -> ${appVer}`);
      touch(pjPath, JSON.stringify(o, null, 2));
    } else log(`  ok [package.json:версия] уже ${o.version}`);
  } catch (e) { log('  ~ warn package.json: ' + e.message); }
}

// ─────────────── 5. проверка синтаксиса изменённых JS
log('\nпроверка синтаксиса:');

for (const [p, , after] of patched) {
  if (!/\.(js|cjs)$/.test(p)) continue;
  const tmp = join(ROOT, 'work/syntax-check.tmp.js');
  mkdirSync(dirname(tmp), { recursive: true });
  writeSync(openSync(tmp, 'w'), overrides.get(p));
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  if (r.status !== 0) { fails.push('parse: ' + p); log(`  !! FAIL ${p}\n${(r.stderr || '').slice(0, 500)}`); }
}
log(`  проверено ${patched.filter(([p]) => /\.(js|cjs)$/.test(p)).length} файлов`);

if (fails.length) {
  log(`\nСБОРКА ПРЕРВАНА: ${fails.length} критических проблем`);
  fails.forEach(f => log('  -', f));
  process.exit(1);
}

// ─────────────── 6. запись нового asar
// новые смещения: изменённые файлы «раздуваются», остальное едет за ними
const newHeader = JSON.parse(JSON.stringify(header));
const packedList = [];
(function walk(node, p) {
  for (const [k, v] of Object.entries(node.files ?? {})) {
    const q = p ? p + '/' + k : k;
    if (v.files) { walk(v, q); continue; }
    delete v.integrity;              // fuse проверки целостности в 3.17.2 выключен
    if (v.unpacked) continue;         // распакованные остаются на диске как есть
    packedList.push([q, v]);
  }
})(newHeader, '');
// ВАЖНО: смещения присваиваются в том же порядке, в котором пишутся данные,
// иначе файлы после первого изменённого читаются не с того места.
packedList.sort((a, b) => (+byPath.get(a[0]).offset) - (+byPath.get(b[0]).offset));
let cursor = 0, changedBytes = 0, totalBytes = 0;
const layout = packedList.map(([q, v]) => {
  const ov = overrides.get(q);
  if (ov) { v.size = ov.length; changedBytes += ov.length; }
  v.offset = String(cursor);
  cursor += v.size;
  totalBytes += v.size;
  return [q, ov ?? null];
});

const jsonStr = JSON.stringify(newHeader);
const jsonBytes = Buffer.from(jsonStr, 'utf8');
const pad = (4 - ((4 + jsonBytes.length) % 4)) % 4;
const innerPayload = 4 + jsonBytes.length + pad;
const prefix = Buffer.alloc(16);
prefix.writeUInt32LE(4, 0);
prefix.writeUInt32LE(4 + innerPayload, 4);
prefix.writeUInt32LE(innerPayload, 8);
prefix.writeUInt32LE(jsonBytes.length, 12);
log(`\nновый заголовок: ${(jsonBytes.length / 1048576).toFixed(2)} MB (было ${(jsonLen / 1048576).toFixed(2)} MB)`);

mkdirSync(dirname(OUT), { recursive: true });
const dst = openSync(OUT, 'w');
writeSync(dst, prefix); writeSync(dst, jsonBytes); writeSync(dst, Buffer.alloc(pad));

const CHUNK = 4 * 1024 * 1024;
const srcFd = openSync(STOCK, 'r');
for (const [q, ovOrNull] of layout) {
  if (ovOrNull) { writeSync(dst, ovOrNull); continue; }
  const v = byPath.get(q);
  let left = v.size, off = dataStart + (+v.offset);
  const buf = Buffer.alloc(Math.min(CHUNK, left || 1));
  while (left > 0) {
    const n = Math.min(CHUNK, left);
    readSync(srcFd, buf, 0, n, off);
    writeSync(dst, buf, 0, n);
    off += n; left -= n;
  }
}
closeSync(srcFd); closeSync(dst); closeSync(src);
const outSize = statSync(OUT).size;
log(`\nизменённых файлов: ${patched.length}, содержимого: ${(changedBytes / 1048576).toFixed(2)} MB`);
patched.forEach(([p, b, a]) => log(`  * ${p}  ${b} -> ${a}${b === a ? ' (без роста)' : ''}`));
log(`\nOK: ${OUT}  ${(outSize / 1048576).toFixed(1)} MB (оригинал ${(statSync(STOCK).size / 1048576).toFixed(1)} MB)`);
