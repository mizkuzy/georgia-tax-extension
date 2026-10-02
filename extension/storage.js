// JSON-файлы по годам в папке, которую выбрал пользователь (File System Access API).
// Ссылка на папку хранится в IndexedDB расширения.

import { emptyYear, isYearData } from './core.js';

function openDb() {
  return new Promise((ok, fail) => {
    const r = indexedDB.open('georgia-tax', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('handles');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}

async function idb(mode, fn) {
  const tx = (await openDb()).transaction('handles', mode);
  const req = fn(tx.objectStore('handles'));
  return new Promise((ok, fail) => {
    tx.oncomplete = () => ok(req.result);
    tx.onerror = () => fail(tx.error);
  });
}

export const savedFolder = () => idb('readonly', (s) => s.get('folder'));

export async function pickFolder() {
  const dir = await showDirectoryPicker({ mode: 'readwrite' });
  await idb('readwrite', (s) => s.put(dir, 'folder'));
  return dir;
}

// Вызывать сразу в обработчике клика: Chrome показывает запрос разрешения только после действия пользователя.
export async function getFolder() {
  const dir = await savedFolder();
  if (!dir) throw new Error('История доходов: папка не выбрана.\nНажмите «Выбрать папку» и выберите папку для файлов 2026.json, 2027.json.');
  if ((await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') {
    throw new Error(`История доходов: нет доступа к папке «${dir.name}».\nНажмите «Заполнить декларацию» снова и разрешите доступ в окне Chrome.`);
  }
  return dir;
}

export async function readYear(dir, year) {
  let file;
  try {
    file = await (await dir.getFileHandle(`${year}.json`)).getFile();
  } catch (e) {
    if (e.name === 'NotFoundError') return emptyYear(year);
    throw new Error(`История доходов: не удалось открыть файл ${year}.json в папке «${dir.name}».\nОшибка: ${e.message}`);
  }
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    throw new Error(`История доходов: файл ${year}.json в папке «${dir.name}» повреждён: это не JSON.\nОшибка: ${e.message}\nНа RS ничего не изменено. Исправьте файл или восстановите его из копии.`);
  }
  if (!isYearData(data, year)) {
    throw new Error(`История доходов: файл ${year}.json в папке «${dir.name}» повреждён: нужны "year": ${year} и список "incomes", у каждой записи "date" (YYYY-MM-DD), "usd" и "gel" — числа.\nНа RS ничего не изменено. Исправьте файл или восстановите его из копии.`);
  }
  return data;
}

export async function writeYear(dir, data) {
  const w = await (await dir.getFileHandle(`${data.year}.json`, { create: true })).createWritable();
  await w.write(JSON.stringify(data, null, 2) + '\n');
  await w.close();
}
