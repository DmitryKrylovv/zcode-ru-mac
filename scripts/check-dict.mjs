#!/usr/bin/env node
// Валидация словаря: покрытие, плейсхолдеры, китайские символы, пустые значения, плюралы
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const corpus = JSON.parse(readFileSync(join(ROOT, 'upstream/corpus.json'), 'utf8'));
const flat = {};
for (const [ns, d] of Object.entries(corpus))
  for (const [k, v] of Object.entries(d)) flat[k.includes('.') ? k : `${ns}.${k}`] = v;
const ru = {};
for (const f of readdirSync(join(ROOT, 'dict/ru')).filter(f => f.endsWith('.json')).sort())
  Object.assign(ru, JSON.parse(readFileSync(join(ROOT, 'dict/ru', f), 'utf8')));

const tok = s => [...(s || '').matchAll(/\{\w+\}/g)].map(m => m[0]).sort();
const errors = [], warns = [], notes = [];
const noEn = [];
let checked = 0;
for (const [k, v] of Object.entries(flat)) {
  const en = v.en ?? '', zh = v.zh ?? '';
  if (en === '') { noEn.push(k); continue; }
  checked++;
  const r = ru[k];
  if (r === undefined) { errors.push(`нет перевода: ${k}`); continue; }
  if (!r.trim()) { errors.push(`пустое значение: ${k}`); continue; }
  if (r === en) warns.push(`значение совпадает с английским: ${k}`);
  if (/[\u4e00-\u9fff\u3000-\u303f]/.test(r)) errors.push(`китайские символы: ${k} -> ${r}`);
  const a = tok(en).join('|'), b = tok(r).join('|');
  if (a !== b) errors.push(`плейсхолдеры не совпадают: ${k}\n      en: ${a}\n      ru: ${b}`);
  if (/\(ов\)|\(а\)|\(ы\)/.test(r)) errors.push(`скобочная форма числа: ${k} -> ${r}`);
}
// плюральные базы
const bases = new Map();
for (const k of Object.keys(flat)) {
  const m = k.match(/^(.*)\.(one|other|many|few|zero|two)$/);
  if (m) { if (!bases.has(m[1])) bases.set(m[1], []); bases.get(m[1]).push(m[2]); }
}
for (const [b, sufs] of bases) {
  const missing = sufs.filter(s => ru[`${b}.${s}`] === undefined);
  if (missing.length) errors.push(`плюрал не покрыт: ${b} → нет ${missing.join(', ')}`);
}
const stale = Object.keys(ru).filter(k => !(k in flat));
console.log(`корпус: ${Object.keys(flat).length} | проверено: ${checked} | словарь: ${Object.keys(ru).length}`);
console.log(`пустых en (пропущены): ${noEn.length} ${noEn.join(', ')}`);
console.log(`устаревших ключей (нет в 3.17.2): ${stale.length}`);
console.log(`предупреждений: ${warns.length}${warns.length ? '\n   ' + warns.slice(0, 10).join('\n   ') : ''}`);
console.log(`ОШИБОК: ${errors.length}`);
errors.slice(0, 40).forEach(e => console.log('   ✗', e));
process.exit(errors.length ? 1 : 0);
