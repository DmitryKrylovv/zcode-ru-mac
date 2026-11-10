#!/usr/bin/env node
// Извлечение корпуса en+zh из app.asar ZCode.app.
// Выход: upstream/corpus.json {ns:{key:{en,zh}}} + upstream/report.json
import { extractFile } from '@electron/asar';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASAR = process.argv[2] ?? '/Applications/ZCode.app/Contents/Resources/app.asar';

function listFiles(archive) {
  const fd = require_fs_open(archive);
  const buf = Buffer.alloc(16);
  fd.readSync ? null : null;
  return null;
}
// --- простой ридер заголовка asar (без зависимостей) ---
import { openSync, readSync, closeSync } from 'node:fs';
function readHeader(archive) {
  const fd = openSync(archive, 'r');
  const b = Buffer.alloc(16);
  readSync(fd, b, 0, 16, 0);
  const jsonSize = b.readUInt32LE(12);
  const jb = Buffer.alloc(jsonSize);
  readSync(fd, jb, 0, jsonSize, 16);
  closeSync(fd);
  return JSON.parse(jb.toString('utf8'));
}

function findFile(node, path, test) {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const p = path ? `${path}/${name}` : name;
    if (child.files) {
      const hit = findFile(child, p, test);
      if (hit) return hit;
    } else if (test(p, child)) return { path: p, node: child };
  }
  return null;
}

const header = readHeader(ASAR);
const hit = findFile(header, '', (p, n) => !n.unpacked && /IntlProvider-[A-Za-z0-9_-]+\.js$/.test(p));
if (!hit) { console.error('FATAL: IntlProvider chunk не найден в asar'); process.exit(1); }
const chunkName = hit.path;
const content = extractFile(ASAR, chunkName).toString('utf8');
console.log(`чанк: ${chunkName} (${(content.length / 1024).toFixed(0)} KB)`);

// --- реестр словарей ---
const reg = content.match(/(\w+)=\{"zh-CN":(\w+),"en-US":(\w+)\}/);
if (!reg) { console.error('FATAL: реестр словарей не найден'); process.exit(1); }
const [, , ZH_VAR, EN_VAR] = reg;
console.log(`реестр: zh=${ZH_VAR} en=${EN_VAR}`);

function findSpan(content, varName) {
  const key = `${varName}={`; 
  let pos = 0;
  while (true) {
    const i = content.indexOf(key, pos);
    if (i === -1) return null;
    const open = i + key.length - 1;
    let depth = 0, inBt = false, inStr = false, esc = false;
    for (let j = open; j < content.length; j++) {
      const c = content[j];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (inBt) { if (c === '`') inBt = false; continue; }
      if (inStr) { if (c === '"') inStr = false; continue; }
      if (c === '`') { inBt = true; continue; }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return [open + 1, j]; }
    }
    pos = i + 1;
  }
}

function unescapeTmpl(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\' && i + 1 < raw.length) {
      const n = raw[i + 1];
      if (n === '`' || n === '\\' || n === '$') { out += n; i++; continue; }
    }
    out += raw[i];
  }
  return out;
}

function parseKv(inner) {
  const out = {};
  const re = /"([^"]+)":`/g;
  let m;
  while ((m = re.exec(inner))) {
    const key = m[1];
    let j = m.index + m[0].length;
    while (j < inner.length) {
      if (inner[j] === '\\') { j += 2; continue; }
      if (inner[j] === '`') break;
      j++;
    }
    out[key] = unescapeTmpl(inner.slice(m.index + m[0].length, j));
    re.lastIndex = j + 1;
  }
  return out;
}

const enSpan = findSpan(content, EN_VAR);
const zhSpan = findSpan(content, ZH_VAR);
if (!enSpan || !zhSpan) { console.error('FATAL: словари не найдены'); process.exit(1); }
const en = parseKv(content.slice(enSpan[0], enSpan[1]));
const zh = parseKv(content.slice(zhSpan[0], zhSpan[1]));
console.log(`ключей: en=${Object.keys(en).length} zh=${Object.keys(zh).length}`);

// --- корпус по namespace'ам (первый сегмент ключа) ---
const corpus = {};
const onlyEn = [], onlyZh = [];
for (const k of Object.keys(en)) {
  if (!(k in zh)) { onlyEn.push(k); continue; }
  const ns = k.split('.')[0];
  (corpus[ns] ??= {})[k] = { en: en[k], zh: zh[k] };
}
for (const k of Object.keys(zh)) if (!(k in en)) onlyZh.push(k);

const nsStats = Object.entries(corpus)
  .map(([ns, keys]) => [ns, Object.keys(keys).length])
  .sort((a, b) => b[1] - a[1]);
const total = nsStats.reduce((s, [, n]) => s + n, 0);

writeFileSync(join(ROOT, 'upstream/corpus.json'), JSON.stringify(corpus, null, 1));
const report = {
  app: 'ZCode.app', asar: ASAR, chunk: chunkName,
  extractedAt: new Date().toISOString(),
  totalKeys: total,
  namespaces: Object.fromEntries(nsStats),
  enOnlyKeys: onlyEn, zhOnlyKeys: onlyZh,
};
writeFileSync(join(ROOT, 'upstream/report.json'), JSON.stringify(report, null, 2));

console.log(`\nитого ключей: ${total} (namespace'ов: ${nsStats.length})`);
console.log('топ-10 ns:', nsStats.slice(0, 10).map(([n, c]) => `${n}:${c}`).join('  '));
if (onlyEn.length || onlyZh.length)
  console.log(`warning: только-en=${onlyEn.length}, только-zh=${onlyZh.length}`);
