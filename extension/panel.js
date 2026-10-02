import { defaultDate, prevMonthRange, monthName, fetchRate } from './core.js';
import { savedFolder, pickFolder, getFolder, readYear, writeYear } from './storage.js';
import { checkRsTab, openDeclPage, listDeclarations, selectMonth, openForm, fillFields } from './rs.js';
import { fillDeclaration } from './flow.js';

const $ = (id) => document.getElementById(id);

// Текст в элемент; адреса https://… — кликабельные ссылки (открываются в новой вкладке).
function setText(el, text) {
  el.replaceChildren(
    ...String(text).split(/(https:\/\/[^\s]+[^\s.,;:)])/).map((part, i) => {
      if (i % 2 === 0) return document.createTextNode(part);
      const a = document.createElement('a');
      a.href = part;
      a.target = '_blank';
      a.textContent = part;
      return a;
    }),
  );
}

function log(text, cls) {
  const line = document.createElement('div');
  setText(line, text);
  if (cls) line.className = cls;
  $('log').append(line);
}

let pageOk = false;
let busy = false;
const updateButtons = () => {
  $('fill').disabled = !pageOk || busy;
  $('recheck').disabled = busy;
  $('inputs').hidden = !pageOk;
  $('hint').hidden = !pageOk;
};

async function showFolder() {
  const dir = await savedFolder();
  $('folder').textContent = dir ? dir.name : 'не выбрана';
}

async function checkPage() {
  pageOk = false;
  updateButtons();
  $('pageStatus').className = 'muted';
  $('pageStatus').textContent = 'Проверка страницы RS…';
  try {
    await checkRsTab();
    pageOk = true;
    $('pageStatus').className = 'ok';
    $('pageStatus').textContent = '✓ Сайт RS открыт.';
  } catch (e) {
    $('pageStatus').className = 'err';
    setText($('pageStatus'), e.message);
  }
  updateButtons();
}

function ask(text) {
  $('confirmText').textContent = text;
  $('confirm').style.display = 'block';
  return new Promise((ok) => {
    const answer = (v) => () => {
      $('confirm').style.display = 'none';
      ok(v);
    };
    $('yes').onclick = answer(true);
    $('no').onclick = answer(false);
  });
}

// Таблица прошлых месяцев. Возвращает строки [{ month, date, usd }] после «Сохранить и продолжить» или null после «Отмена».
function pastTable(months) {
  $('pastTitle').textContent = `Доходы ${months[0].slice(0, 4)} года за месяцы без записи в файле. Пустая сумма — в этом месяце дохода не было.`;
  if ($('pastRows').rows.length !== months.length) {
    $('pastRows').replaceChildren(
      ...months.map((m) => {
        const tr = document.createElement('tr');
        tr.dataset.month = m;
        tr.innerHTML = `<td>${monthName(m)}</td><td><input type="date" value="${m}-22" min="${m}-01" max="${m}-31"></td><td><input inputmode="decimal" placeholder="USD"></td>`;
        return tr;
      }),
    );
  }
  $('past').style.display = 'block';
  return new Promise((ok) => {
    const done = (v) => () => {
      $('past').style.display = 'none';
      ok(v);
    };
    $('pastSave').onclick = () => {
      $('past').style.display = 'none';
      ok([...$('pastRows').rows].map((tr) => ({ month: tr.dataset.month, date: tr.cells[1].firstChild.value, usd: tr.cells[2].firstChild.value })));
    };
    $('pastCancel').onclick = done(null);
  });
}

async function fill() {
  busy = true;
  updateButtons();
  $('log').textContent = '';
  $('pastRows').replaceChildren();
  try {
    // Доступ к папке — первым: Chrome спрашивает разрешение только сразу после клика.
    const dir = await getFolder();
    await fillDeclaration({
      today: new Date(),
      input: { date: $('date').value, usd: $('usd').value },
      ui: { log, ask, pastTable },
      storage: { readYear: (year) => readYear(dir, year), writeYear: (data) => writeYear(dir, data) },
      fetchRate,
      rs: { openDeclPage, listDeclarations, selectMonth, openForm, fillFields },
    });
  } catch (e) {
    log(e.message, 'err');
  }
  busy = false;
  updateButtons();
}

$('date').value = defaultDate();
Object.assign($('date'), prevMonthRange()); // календарь — только прошлый месяц
$('pickFolder').onclick = async () => {
  try {
    await pickFolder();
  } catch (e) {
    if (e.name !== 'AbortError') log(`История доходов: не удалось выбрать папку.\nОшибка: ${e.message}`, 'err');
  }
  showFolder();
};
$('recheck').onclick = checkPage;
$('fill').onclick = fill;
showFolder();
checkPage();
