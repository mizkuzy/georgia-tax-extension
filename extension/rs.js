// Работа со страницами RS. Селекторы описаны в docs/rs-page-structure.md.
// Функции с суффиксом InPage выполняются в странице (world: MAIN): им нужны функции сайта (ksd_set_value, view_decl).
// Они не используют внешние переменные и возвращают { error } вместо исключения.

export const DECL_URL = 'https://decl.rs.ge/decls.aspx';
// Вход в модуль деклараций с eservices (как карточка «Declarations»). Прямой DECL_URL без него перекидывает на главную.
const ENTRY_URL = 'https://eservices.rs.ge/Redirect.ashx?Module=DECL';
const RS_HOSTS = ['eservices.rs.ge', 'decl.rs.ge'];

async function run(tabId, func, ...args) {
  let res;
  try {
    [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args });
  } catch (e) {
    throw new Error(`Не удалось выполнить код на странице RS.\nОшибка: ${e.message}`);
  }
  if (res?.result?.error) throw new Error(res.result.error);
  return res?.result;
}

// Открыть адрес во вкладке и дождаться загрузки конечной страницы (после перенаправлений).
function openInTab(tabId, url, timeoutMs = 30000) {
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      fail(new Error(`Шаг 4 (страница деклараций): страница ${url} не загрузилась за ${timeoutMs / 1000} секунд.\nЧто сделать: проверьте интернет и нажмите «Заполнить декларацию» снова.`));
    }, timeoutMs);
    function onUpdated(id, info, tab) {
      if (id !== tabId || info.status !== 'complete' || tab.url?.includes('Redirect.ashx')) return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      ok(tab);
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.update(tabId, { url });
  });
}

// Проверка без переходов и кликов: активная вкладка — сайт RS и не страница входа. Возвращает вкладку.
export async function checkRsTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ? new URL(tab.url) : null;
  if (!url || !RS_HOSTS.includes(url.host)) {
    throw new Error('Шаг 1 (проверка): активная вкладка — не сайт RS.\nОжидалось: eservices.rs.ge или decl.rs.ge.\nЧто сделать: откройте https://eservices.rs.ge/, залогиньтесь и нажмите «Проверить снова».');
  }
  if (/login\.aspx/i.test(url.pathname)) {
    throw new Error('Шаг 1 (проверка): открыта страница входа RS.\nЧто сделать: залогиньтесь и нажмите «Проверить снова».');
  }
  return tab;
}

// Шаг 4: открыть страницу деклараций на английском; проверить, что пользователь залогинен.
export async function openDeclPage() {
  const tab = await checkRsTab();
  if (tab.url !== DECL_URL) await openInTab(tab.id, ENTRY_URL);
  // Язык хранится в сессии decl.rs.ge; новая сессия — на грузинском.
  if ((await run(tab.id, switchToEnglishInPage)).switched) await openInTab(tab.id, DECL_URL);
  await run(tab.id, checkDeclPageInPage);
  return tab.id;
}

function switchToEnglishInPage() {
  if (location.host !== 'decl.rs.ge' || document.querySelector('#main_footer')?.getAttribute('lang') === 'EN' || typeof change_lang !== 'function') return { switched: false };
  change_lang('EN'); // синхронный запрос сайта sys_service.asmx/chage_language
  return { switched: true };
}

// Меню слева сайт строит скриптом после загрузки страницы — ждём его. Ничего не нажимаем.
async function checkDeclPageInPage() {
  if (location.host !== 'decl.rs.ge') {
    return { error: `Шаг 4 (страница деклараций): вместо страницы деклараций открылась ${location.href}.\nСкорее всего, вы не залогинены или сессия закончилась.\nЧто сделать: залогиньтесь на https://eservices.rs.ge/ и нажмите «Заполнить декларацию» снова.` };
  }
  let item;
  for (let t = 0; t < 15000 && !(item = document.querySelector('td.acc_item[value="58"]')); t += 200) {
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!item) {
    return { error: 'Шаг 4 (страница деклараций): на странице деклараций за 15 секунд не появился пункт Small Business Income Declaration (td.acc_item[value="58"]).\nЕсли страница загрузилась полностью — RS изменил страницу, нужно исправить селекторы в расширении.\nЕсли нет — нажмите «Заполнить декларацию» снова.' };
  }
  return { ok: true };
}

// Шаг 4. Декларации 58 за месяц — тем же запросом, которым сайт грузит таблицу. Без кликов, страница не меняется.
export const listDeclarations = async (tabId, month) => (await run(tabId, listDeclarationsInPage, month)).rows;

async function listDeclarationsInPage(month) {
  const step = 'Шаг 4 (декларации за месяц)';
  if (typeof $ !== 'function') return { error: `${step}: на странице нет jQuery.\nНужно исправить расширение.` };
  const period = month.replace('-', '');
  const filters = `[{ 'x_name': 'gad_kod', 'value': '58', 'filter_type': '0' },{ 'x_name': 'sag_periodi', 'value': '${period}', 'filter_type': '0' },{ 'x_name': 'tax_type', 'value': '1', 'filter_type': '0' }]`;
  const answer = await new Promise((ok) =>
    $.ajax({
      url: 'sys_service.asmx/get_grid_r_data',
      type: 'POST',
      dataType: 'json',
      contentType: 'application/json; charset=utf-8',
      global: false, // не вызывать обработчики страницы
      data: `{ 'grid_id' : 3 , 'page_size' : 100, 'curent_page' : 1, 'filters' : ${filters}, 'order_by' : [], 'guid' : 'ext' }`,
      success: (d) => ok({ d: d.d }),
      error: (x) => ok({ fail: `HTTP ${x.status}: ${String(x.responseText).slice(0, 300)}` }),
    }),
  );
  if (answer.fail || String(answer.d).split(':')[0] === '-1') {
    return { error: `${step}: сайт не вернул декларации за ${month}.\nОтвет: ${answer.fail ?? String(answer.d).slice(0, 300)}\nНа RS ничего не изменено. Что сделать: нажмите «Заполнить декларацию» снова.` };
  }
  let list;
  try {
    list = JSON.parse(answer.d).list;
  } catch {
    list = null;
  }
  if (!Array.isArray(list)) return { error: `${step}: непонятный ответ сайта.\nОтвет: ${String(answer.d).slice(0, 300)}\nНужно исправить расширение.` };
  return { rows: list.map((r) => ({ seq: String(r.SEQ_NUM), status: String(r.STATUS), text: `${r.STATUS_TXT} №${r.SEQ_NUM}` })) };
}

// Шаг 5. Выбрать декларацию 58 и период (клики на странице). month: 'YYYY-MM'.
export const selectMonth = (tabId, month) => run(tabId, selectMonthInPage, month);

async function selectMonthInPage(month) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 15000) => {
    for (let t = 0; t < ms; t += 200) {
      const v = fn();
      if (v) return v;
      await sleep(200);
    }
    return null;
  };
  const step = 'Шаг 5 (выбор декларации и месяца)';

  const item = document.querySelector('td.acc_item[value="58"]');
  if (!item) return { error: `${step}: не найден пункт Small Business Income Declaration (td.acc_item[value="58"]).\nНужно исправить селекторы в расширении.` };
  // Таблица грузится запросом $.ajax к get_grid_r_data. Ждём его ответ (событие jQuery ajaxComplete).
  // parts — строки, которые должны быть в теле запроса: id таблицы и, если нужно, период.
  const gridLoaded = (...parts) =>
    new Promise((ok) => {
      const done = (v) => {
        clearTimeout(timer);
        $(document).off('ajaxComplete', onComplete);
        setTimeout(() => ok(v), 100); // строки рисуются в success, до ajaxComplete; запас на всякий случай
      };
      const onComplete = (e, xhr, o) => {
        if (String(o.url).includes('get_grid_r_data') && parts.every((p) => String(o.data).includes(p))) done(xhr.status === 200);
      };
      const timer = setTimeout(() => done(false), 15000);
      $(document).on('ajaxComplete', onComplete);
    });
  if (typeof $ !== 'function') return { error: `${step}: на странице нет jQuery.\nНужно исправить расширение.` };

  // Клик по пункту сбрасывает период и загружает таблицу. Ждём конца этой загрузки, иначе она перепишет нашу.
  const gridId = () => document.querySelector('#control_0_g3g')?.getAttribute('grid_id');
  if (!item.classList.contains('acc_sel_item') || !document.querySelector('#control_0_new')?.offsetParent) {
    const loaded = gridLoaded(gridId() ? `'grid_id' : ${gridId()} ,` : "'grid_id'");
    item.click();
    if (!(await waitFor(() => document.querySelector('#control_0_new')?.offsetParent)) || !(await loaded)) {
      return { error: `${step}: после выбора Small Business Income Declaration не появилась кнопка New return (#control_0_new) или не загрузилась таблица деклараций.\nНужно исправить селекторы в расширении.` };
    }
  }
  const period = document.querySelector('#control_0_m');
  if (!period || !gridId() || typeof ksd_set_value !== 'function' || typeof control_0_m_chenge !== 'function') {
    return { error: `${step}: не найдено поле «Период» (#control_0_m), таблица деклараций (#control_0_g3g[grid_id]) или функции сайта ksd_set_value / control_0_m_chenge.\nНужно исправить селекторы в расширении.` };
  }

  const value = `${month.slice(5, 7)}.${month.slice(0, 4)}`; // MM.YYYY
  const loaded = gridLoaded(`'grid_id' : ${gridId()} ,`, `'value': '${month.replace('-', '')}'`);
  ksd_set_value($(period), value);
  control_0_m_chenge(period);
  if (!(await loaded)) {
    return { error: `${step}: таблица деклараций за ${value} не загрузилась за 15 секунд.\nНа RS ничего не изменено. Что сделать: нажмите «Заполнить декларацию» снова.` };
  }
  const shown = period.querySelector('.d_value').value;
  if (shown !== value) return { error: `${step}: в поле «Период» стоит ${shown}, ожидалось ${value}.` };
  return { ok: true };
}

// Шаг 5. Создать новую декларацию (seq не задан) или открыть существующую. Возвращает номер декларации.
export const openForm = (tabId, month, seq) => run(tabId, openFormInPage, month, seq ?? null);

async function openFormInPage(month, seq) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 15000) => {
    for (let t = 0; t < ms; t += 200) {
      const v = fn();
      if (v) return v;
      await sleep(200);
    }
    return null;
  };

  if (document.querySelector('.window_panel')) {
    return { error: 'Шаг 5: на странице уже открыто окно декларации.\nНа RS ничего не изменено.\nЧто сделать: закройте окно декларации и нажмите «Заполнить» снова.' };
  }
  if (seq) {
    if (typeof view_decl !== 'function') return { error: 'Шаг 5: не найдена функция сайта view_decl для открытия декларации.\nНа RS ничего не изменено. Нужно исправить расширение.' };
    view_decl(Number(seq), 58);
  } else {
    const btn = document.querySelector('#control_0_new');
    if (!btn?.offsetParent) return { error: 'Шаг 5: не найдена кнопка New return (#control_0_new).\nНа RS ничего не изменено. Нужно исправить селекторы в расширении.' };
    btn.click();
  }

  const created = seq ? '' : '\nНа RS мог быть создан пустой черновик за этот месяц.';
  const win = await waitFor(() => document.querySelector('.window_panel input[x_name="COL_15"]')?.closest('.window_panel'));
  if (!win) return { error: `Шаг 5: форма декларации не открылась за 15 секунд (нет поля COL_15).${created}` };

  // Информационное окно «Warning» о строительных услугах.
  await sleep(500);
  document.querySelectorAll('.ui-dialog .ui-dialog-titlebar-close').forEach((b) => b.offsetParent && b.click());

  const number = win.querySelector('.window_title_text')?.innerText.match(/N:\s*(\d+)/)?.[1];
  const formPeriod = win.innerText.match(/(\d{4})\/(\d{2})/);
  const expected = month.replace('-', '/');
  if (!formPeriod || formPeriod[0] !== expected) {
    return { error: `Шаг 5: в открытой декларации период ${formPeriod?.[0] ?? 'не найден'}, ожидалось ${expected}.\nПоля не заполнены.${created}\nЧто сделать: проверьте декларацию №${number ?? '?'} вручную.` };
  }
  return { number };
}

// Шаг 6. Заполнить поля 15 и 20 и проверить, что сайт их принял.
export const fillFields = (tabId, field15, field20) => run(tabId, fillFieldsInPage, field15.toFixed(2), field20.toFixed(2));

async function fillFieldsInPage(v15, v20) {
  const win = document.querySelector('.window_panel');
  const get = (name) => win?.querySelector(`input[x_name="${name}"]`);
  const f15 = get('COL_15');
  const f20 = get('COL_20');
  if (!f15 || !f20) return { error: `Шаг 6: в форме не найдено поле ${f15 ? '20 (COL_20)' : '15 (COL_15)'}.\nНужно исправить селекторы в расширении.` };

  const set = (el, v) => {
    el.focus();
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  };
  set(f15, v15);
  set(f20, v20);
  await new Promise((r) => setTimeout(r, 500));

  const read = { c15: f15.value, c20: f20.value, c17: get('COL_17')?.value, c26: get('COL_26')?.value };
  const num = (s) => Number(String(s).replace(/[\s,]/g, ''));
  if (num(read.c15) !== num(v15) || num(read.c20) !== num(v20)) {
    return { error: `Шаг 6: сайт изменил введённые значения.\nОжидалось: поле 15 = ${v15}, поле 20 = ${v20}.\nНайдено: поле 15 = ${read.c15}, поле 20 = ${read.c20}.` };
  }
  return read;
}
