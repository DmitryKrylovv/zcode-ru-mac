#!/usr/bin/env node
// Сверка собранного asar с оригиналом: каждый файл сравнивается по SHA256.
// Ожидание: отличаются только файлы, которые патчер осознанно менял.
import { openSync, readSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';

function reader(path) {
  const fd = openSync(path, 'r');
  const b = Buffer.alloc(16); readSync(fd, b, 0, 16, 0);
  const jl = b.readUInt32LE(12);
  const jb = Buffer.alloc(jl); readSync(fd, jb, 0, jl, 16);
  const header = JSON.parse(jb.toString('utf8'));
  const ds = 8 + b.readUInt32LE(4);
  const map = new Map();
  (function walk(n, p) {
    for (const [k, v] of Object.entries(n.files ?? {})) {
      const q = p ? p + '/' + k : k;
      if (v.files) { walk(v, q); continue; }
      map.set(q, v);
    }
  })(header, '');
  return {
    fd, ds, map, header,
    hash(q) {
      const v = map.get(q);
      if (!v) return null;
      if (v.unpacked) return 'UNPACKED';
      const h = createHash('sha256');
      let left = v.size, off = ds + (+v.offset);
      const buf = Buffer.alloc(4 * 1024 * 1024);
      let parity = 0;
      while (left > 0) { const n = Math.min(buf.length, left); readSync(fd, buf, 0, n, off); h.update(buf.slice(0, n)); off += n; left -= n; }
      return h.digest('hex');
    },
    close() { closeSync(fd); },
  };
}

const [A, B] = process.argv.slice(2);
const a = reader(A), b = reader(B);
const pa = [...a.map.keys()], pb = new Set(b.map.keys());
const missing = pa.filter(q => !pb.has(q));
const extra = [...pb].filter(q => !a.map.has(q));
console.log(`файлов: оригинал ${pa.length}, сборка ${pb.size}`);
if (missing.length) console.log(`  !! пропали: ${missing.length}`, missing.slice(0, 5));
if (extra.length) console.log(`  !! лишние: ${extra.length}`, extra.slice(0, 5));
let same = 0, diff = [], unpackedMismatch = 0;
for (const q of pa) {
  if (!pb.has(q)) continue;
  if (!!a.map.get(q).unpacked !== !!b.map.get(q).unpacked) { unpackedMismatch++; console.log(`  !! флаг unpacked изменился: ${q}`); continue; }
  const ha = a.hash(q), hb = b.hash(q);
  if (ha === hb) same++; else diff.push(q);
}
console.log(`идентичных: ${same}`);
console.log(`изменённых: ${diff.length}`);
diff.forEach(q => console.log(`  * ${q}`));
console.log(`распакованных в оригинале: ${[...a.map.values()].filter(v => v.unpacked).length}, в сборке: ${[...b.map.values()].filter(v => v.unpacked).length}`);
console.log(missing.length || extra.length || unpackedMismatch ? 'ИТОГ: ❌ структура расходится' : 'ИТОГ: ✅ структура совпадает');
a.close(); b.close();
