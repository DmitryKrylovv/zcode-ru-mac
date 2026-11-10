# Third-party notices

## warment/zcode-ru

База русскоязычного словаря (`dict/ru/01.json` … `19.json`) взята из проекта **zcode-ru** —
https://github.com/warment/zcode-ru (тег `v2.0.4`), который распространяется по лицензии MIT:

```
MIT License

Copyright (c) zcode-ru contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Благодарности

Спасибо проекту **zcode-ru** — он первым сделал русскую локализацию ZCode. Основа словаря
(6 115 переводов), подход к правке словарей внутри `app.asar` и их скрипт извлечения текстов
взяты оттуда; этот пакет — продолжение их работы под ZCode 3.17.2.

## ZCode

ZCode — продукт Beijing Knowledge Atlas Technology (Z.ai). Этот пакет не официальный,
не поддерживается Z.ai и не содержит изменений в исполняемых файлах Electron: изменяются
только словари внутри `app.asar` и регистрация локали.
