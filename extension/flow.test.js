// Запуск: node --test extension/flow.test.js
// Сценарий «Заполнить декларацию» (flow.js) с заглушками вместо сайта RS, файла, NBG и вопросов в панели.
// Главное правило: на сайте ничего не нажимается, пока не получены все ответы пользователя.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillDeclaration } from './flow.js';
import { emptyYear, addIncome, makeIncome, zeroIncome, pastMonths, declarationFields } from './core.js';

// Действия, которые что-то нажимают на странице RS.
const CLICKS = ['selectMonth', 'openForm', 'fillFields'];
const RATE = 2.6074;

// Файл 2026 с прошлыми месяцами: январь–май 0, июнь–август доход.
function fileWithPast() {
  let y = emptyYear(2026);
  for (const m of ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']) y = addIncome(y, zeroIncome(m));
  y = addIncome(y, makeIncome('2026-06-22', 600.15, 2.6505));
  y = addIncome(y, makeIncome('2026-07-23', 5200.40, 2.629));
  y = addIncome(y, makeIncome('2026-08-20', 7300.25, 2.6138));
  return y;
}

function setup({ file = fileWithPast(), input = { date: '2026-09-22', usd: '6100,55' }, decls = [], answers = [], tables = [], fail = {} } = {}) {
  const calls = [];
  const logs = [];
  const writes = [];
  const deps = {
    today: new Date(2026, 9, 3), // 3 октября 2026 — декларация за сентябрь
    input,
    ui: {
      log: (text, cls) => logs.push({ text, cls }),
      ask: async (text) => {
        calls.push(['ask', text]);
        return answers.shift();
      },
      // Таблица прошлых месяцев: строки [{ month, date, usd }] или null — «Отмена».
      pastTable: async (months) => {
        calls.push(['pastTable', months]);
        return tables.length ? tables.shift() : null;
      },
    },
    storage: {
      readYear: async (year) => {
        calls.push(['readYear', year]);
        return file ?? emptyYear(year);
      },
      writeYear: async (data) => {
        calls.push(['writeYear']);
        writes.push(structuredClone(data));
      },
    },
    fetchRate: async (date) => {
      calls.push(['fetchRate', date]);
      if (fail.rate) throw new Error('Шаг 3 (курс NBG): нет ответа от сервера NBG.');
      return { rate: RATE };
    },
    rs: {
      openDeclPage: async () => {
        calls.push(['openDeclPage']);
        return 7;
      },
      // Декларации за месяц — запросом к сайту, без кликов.
      listDeclarations: async (tabId, month) => {
        calls.push(['listDeclarations', month]);
        return decls;
      },
      selectMonth: async (tabId, month) => {
        calls.push(['selectMonth', month]);
      },
      openForm: async (tabId, month, seq) => {
        calls.push(['openForm', month, seq]);
        return { number: seq ?? '77000001' };
      },
      fillFields: async (tabId, f15, f20) => {
        calls.push(['fillFields', f15, f20]);
        if (fail.fill) throw new Error('Шаг 6: в форме не найдено поле 20 (COL_20).');
        return { c15: f15.toFixed(2), c20: f20.toFixed(2), c17: f20.toFixed(2), c26: '0.00' };
      },
    },
  };
  const names = () => calls.map((c) => c[0]);
  const errors = () => logs.filter((l) => l.cls === 'err').map((l) => l.text);
  return { deps, calls, names, logs, errors, writes };
}

const SAVED = { seq: '10000001', status: '0', text: 'saved 0 0 10000001' };
const SENT = { seq: '10000002', status: '1', text: 'Sent 100.00 0 10000002' };

// Ожидаемые поля для сентября: прошлые месяцы + 6100.55 USD по курсу RATE.
const expected = (file = fileWithPast(), usd = 6100.55) =>
  declarationFields(usd ? addIncome(file, makeIncome('2026-09-22', usd, RATE)) : file, '2026-09');

const noClicks = (names) => assert.deepEqual(names.filter((n) => CLICKS.includes(n)), [], 'на сайте ничего не нажато');

test('нет деклараций за месяц: без вопроса создаётся новая, поля заполняются, доход записывается', async () => {
  const t = setup();
  await fillDeclaration(t.deps);
  assert.deepEqual(t.names(), ['readYear', 'fetchRate', 'openDeclPage', 'listDeclarations', 'selectMonth', 'openForm', 'fillFields', 'writeYear']);
  assert.deepEqual(t.calls.find((c) => c[0] === 'openForm'), ['openForm', '2026-09', null]);
  const { field15, field20 } = expected();
  assert.deepEqual(t.calls.find((c) => c[0] === 'fillFields'), ['fillFields', field15, field20]);
  assert.equal(t.writes.at(-1).incomes.at(-1).date, '2026-09-22');
  assert.deepEqual(t.errors(), []);
});

test('журнал шага 3: курс, расчёт, налог, поля 15 и 20', async () => {
  const t = setup();
  await fillDeclaration(t.deps);
  const { field15, field20 } = expected();
  const gel = makeIncome('2026-09-22', 6100.55, RATE);
  const step3 = t.logs.map((l) => l.text).find((s) => s.startsWith('Шаг 3'));
  assert.equal(
    step3,
    [
      'Шаг 3: проверка курса.',
      `Курс NBG на 2026-09-22: 1 USD = ${RATE} GEL.`,
      `${RATE} × 6100.55 = ${gel.gel.toFixed(2)} GEL.`,
      `Налог 1% = ${gel.tax_gel.toFixed(2)} GEL.`,
      `Накопленный доход (поле 15) = ${field15.toFixed(2)}.`,
      `Доход в этом месяце (поле 20) = ${field20.toFixed(2)}.`,
    ].join('\n'),
  );
});

test('журнал шага 3 при сумме 0: без курса, поля 15 и 20', async () => {
  const t = setup({ input: { date: '2026-09-22', usd: '0' } });
  await fillDeclaration(t.deps);
  const { field15 } = expected(fileWithPast(), 0);
  const step3 = t.logs.map((l) => l.text).find((s) => s.startsWith('Шаг 3'));
  assert.equal(
    step3,
    ['Шаг 3: сумма 0 — месяц без дохода, курс не нужен.', `Накопленный доход (поле 15) = ${field15.toFixed(2)}.`, 'Доход в этом месяце (поле 20) = 0.00.'].join('\n'),
  );
});

test('есть сохранённая, ответ «Да»: клики только после ответа, открывается она', async () => {
  const t = setup({ decls: [SAVED], answers: [true] });
  await fillDeclaration(t.deps);
  const n = t.names();
  assert.ok(n.indexOf('ask') > n.indexOf('listDeclarations'), 'вопрос после чтения деклараций');
  for (const c of CLICKS) assert.ok(n.indexOf(c) > n.indexOf('ask'), `${c} после ответа`);
  assert.match(t.calls.find((c) => c[0] === 'ask')[1], /10000001/);
  assert.deepEqual(t.calls.find((c) => c[0] === 'openForm'), ['openForm', '2026-09', '10000001']);
  assert.ok(n.includes('writeYear'));
  assert.deepEqual(t.errors(), []);
});

test('есть сохранённая, ответ «Нет»: на сайте ничего не нажато, файл не меняется', async () => {
  const t = setup({ decls: [SAVED], answers: [false] });
  await fillDeclaration(t.deps);
  noClicks(t.names());
  assert.ok(!t.names().includes('writeYear'));
  assert.match(t.errors().join('\n'), /отказались/);
});

test('есть отправленная: остановка без вопроса и без кликов', async () => {
  const t = setup({ decls: [SENT] });
  await fillDeclaration(t.deps);
  noClicks(t.names());
  assert.ok(!t.names().includes('ask'));
  assert.ok(!t.names().includes('writeYear'));
  assert.match(t.errors().join('\n'), /уже есть декларация №10000002/);
});

test('пустой файл, «Прошлых доходов не было»: вопрос до сайта, месяцы записаны с 0, затем заполнение', async () => {
  const t = setup({ file: null, answers: [false] });
  await fillDeclaration(t.deps);
  const n = t.names();
  assert.match(t.calls.find((c) => c[0] === 'ask')[1], /Были доходы/);
  assert.ok(n.indexOf('ask') < n.indexOf('openDeclPage'), 'вопрос до перехода на сайт');
  assert.ok(n.indexOf('writeYear') < n.indexOf('openDeclPage'), 'прошлые месяцы записаны до перехода на сайт');
  assert.ok(!n.includes('pastTable'));
  assert.deepEqual(t.writes[0].incomes.map((i) => [i.date, i.usd]), pastMonths('2026-09').map((m) => [`${m}-01`, 0]));
  const fill = t.calls.find((c) => c[0] === 'fillFields');
  const sept = makeIncome('2026-09-22', 6100.55, RATE).gel;
  assert.deepEqual(fill, ['fillFields', sept, sept]);
  assert.equal(t.writes.at(-1).incomes.length, 9);
});

test('пустой файл, «Да» и таблица: таблица с января по август, прошлые доходы записаны, затем заполнение', async () => {
  const rows = pastMonths('2026-09').map((m) => ({ month: m, date: `${m}-22`, usd: '' }));
  rows[5].usd = '600,15'; // июнь
  rows[6] = { month: '2026-07', date: '2026-07-23', usd: '5200,40' };
  rows[7] = { month: '2026-08', date: '2026-08-20', usd: '7300,25' };
  const t = setup({ file: null, answers: [true], tables: [rows] });
  await fillDeclaration(t.deps);
  const n = t.names();
  assert.deepEqual(t.calls.find((c) => c[0] === 'pastTable')[1], pastMonths('2026-09'));
  assert.ok(n.indexOf('writeYear') < n.indexOf('openDeclPage'));
  assert.deepEqual(t.writes[0].incomes.filter((i) => i.usd > 0).map((i) => i.date), ['2026-06-22', '2026-07-23', '2026-08-20']);
  assert.equal(t.writes[0].incomes.length, 8);
  assert.ok(n.includes('fillFields'));
  assert.deepEqual(t.errors(), []);
});

test('пустой файл, «Да» и «Отмена» в таблице: остановка без сайта и без записи', async () => {
  const t = setup({ file: null, answers: [true], tables: [null] });
  await fillDeclaration(t.deps);
  assert.ok(!t.names().includes('openDeclPage'));
  assert.ok(!t.names().includes('writeYear'));
  assert.match(t.errors().join('\n'), /остановлено/);
});

test('ошибка в таблице: таблица показывается снова, файл пишется только с верными данными', async () => {
  const bad = pastMonths('2026-09').map((m) => ({ month: m, date: `${m}-22`, usd: '' }));
  bad[6] = { month: '2026-07', date: '2026-08-02', usd: '100' }; // дата не в июле
  const good = pastMonths('2026-09').map((m) => ({ month: m, date: `${m}-22`, usd: '' }));
  const t = setup({ file: null, answers: [true], tables: [bad, good] });
  await fillDeclaration(t.deps);
  assert.equal(t.names().filter((n) => n === 'pastTable').length, 2);
  assert.match(t.logs.map((l) => l.text).join('\n'), /Июль 2026: дата 2026-08-02 не в этом месяце/);
  assert.equal(t.writes[0].incomes.length, 8);
  assert.ok(t.names().includes('fillFields'));
});

test('дата не из прошлого месяца: остановка до курса и до сайта', async () => {
  const t = setup({ input: { date: '2026-08-22', usd: '100' } });
  await fillDeclaration(t.deps);
  assert.ok(!t.names().includes('fetchRate'));
  assert.ok(!t.names().includes('openDeclPage'));
  assert.match(t.errors().join('\n'), /не из прошлого месяца/);
});

test('неверная сумма: остановка до курса и до сайта', async () => {
  const t = setup({ input: { date: '2026-09-22', usd: 'abc' } });
  await fillDeclaration(t.deps);
  assert.ok(!t.names().includes('fetchRate'));
  assert.ok(!t.names().includes('openDeclPage'));
  assert.match(t.errors().join('\n'), /указана неверно/);
});

test('ошибка NBG: остановка до сайта, файл не меняется', async () => {
  const t = setup({ fail: { rate: true } });
  await fillDeclaration(t.deps);
  assert.ok(!t.names().includes('openDeclPage'));
  assert.ok(!t.names().includes('writeYear'));
  assert.match(t.errors().join('\n'), /Шаг 3/);
});

test('в файле уже есть доход за этот месяц с другой суммой: остановка до сайта', async () => {
  const file = addIncome(fileWithPast(), makeIncome('2026-09-22', 9999, RATE));
  const t = setup({ file });
  await fillDeclaration(t.deps);
  assert.ok(!t.names().includes('openDeclPage'));
  assert.ok(!t.names().includes('writeYear'));
  assert.match(t.errors().join('\n'), /уже есть запись за 2026-09/);
});

test('сумма 0: без курса, поле 20 = 0, файл не меняется', async () => {
  const t = setup({ input: { date: '2026-09-22', usd: '0' } });
  await fillDeclaration(t.deps);
  assert.ok(!t.names().includes('fetchRate'));
  const { field15 } = expected(fileWithPast(), 0);
  assert.deepEqual(t.calls.find((c) => c[0] === 'fillFields'), ['fillFields', field15, 0]);
  assert.ok(!t.names().includes('writeYear'));
});

test('ошибка при заполнении полей: доход в файл не записывается, сообщение о состоянии RS', async () => {
  const t = setup({ fail: { fill: true } });
  await fillDeclaration(t.deps);
  assert.ok(!t.names().includes('writeYear'));
  assert.match(t.errors().join('\n'), /На RS: создан черновик №77000001/);
});

test('сумма 0, а в файле уже есть доход за этот месяц: остановка до сайта', async () => {
  const file = addIncome(fileWithPast(), makeIncome('2026-09-22', 100, RATE));
  const t = setup({ file, input: { date: '2026-09-22', usd: '0' } });
  await fillDeclaration(t.deps);
  assert.ok(!t.names().includes('openDeclPage'));
  assert.ok(!t.names().includes('fillFields'));
  assert.match(t.errors().join('\n'), /уже есть запись за 2026-09: 2026-09-22, 100 USD/);
});

test('в файле пропущены месяцы: вопрос и таблица только про пропущенные', async () => {
  const file = addIncome(emptyYear(2026), makeIncome('2026-03-22', 1000, 2.7)); // записан только март
  const missing = ['2026-01', '2026-02', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];

  const no = setup({ file, answers: [false] });
  await fillDeclaration(no.deps);
  assert.match(no.calls.find((c) => c[0] === 'ask')[1], /Январь 2026, Февраль 2026, Апрель 2026/);
  assert.deepEqual(no.writes[0].incomes.map((i) => i.date.slice(0, 7)), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']);
  assert.deepEqual(no.errors(), []);

  const rows = missing.map((m) => ({ month: m, date: `${m}-22`, usd: '' }));
  const yes = setup({ file, answers: [true], tables: [rows] });
  await fillDeclaration(yes.deps);
  assert.deepEqual(yes.calls.find((c) => c[0] === 'pastTable')[1], missing);
  assert.deepEqual(yes.errors(), []);
});

test('несколько сохранённых за месяц: вопрос называет все номера, открывается первая', async () => {
  const other = { seq: '10000003', status: '0', text: 'saved 0 0 10000003' };
  const t = setup({ decls: [SAVED, other], answers: [true] });
  await fillDeclaration(t.deps);
  assert.match(t.calls.find((c) => c[0] === 'ask')[1], /10000001.*10000003/s);
  assert.deepEqual(t.calls.find((c) => c[0] === 'openForm'), ['openForm', '2026-09', '10000001']);
});
