// Запуск: node --test extension/core.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultDate, prevMonth, prevMonthRange, checkIncomeDate, parseUsd, pastMonths, monthName, pastIncomes, zeroIncome, makeIncome, emptyYear, addIncome, isYearData, missingMonths, declarationFields, fetchRate } from './core.js';

test('defaultDate: 22 число предыдущего месяца', () => {
  assert.equal(defaultDate(new Date(2026, 9, 2)), '2026-09-22');
  assert.equal(defaultDate(new Date(2026, 9, 22)), '2026-09-22');
  assert.equal(defaultDate(new Date(2026, 2, 31)), '2026-02-22'); // в феврале нет 31 числа
  assert.equal(defaultDate(new Date(2026, 11, 31)), '2026-11-22');
  assert.equal(defaultDate(new Date(2026, 0, 10)), '2025-12-22'); // январь → декабрь прошлого года
});

test('parseUsd: допустимые форматы', () => {
  assert.equal(parseUsd('6100.55'), 6100.55);
  assert.equal(parseUsd('6100,55'), 6100.55);
  assert.equal(parseUsd('6 100,55'), 6100.55);
  assert.equal(parseUsd(' 1000'), 1000);
  assert.equal(parseUsd(' 600,15 '), 600.15);
  assert.equal(parseUsd('1,5'), 1.5);
  assert.equal(parseUsd('100'), 100);
  assert.equal(parseUsd('0'), 0);
});

test('parseUsd: неверные значения', () => {
  for (const bad of ['', ' ', '-5', 'abc', '1.005', '6,444.78', '1.2.3', '.5', '5.', '1e3']) {
    assert.throws(() => parseUsd(bad), /указана неверно/, `"${bad}" должно быть ошибкой`);
  }
});

test('pastMonths: месяцы года до месяца декларации', () => {
  assert.deepEqual(pastMonths('2026-01'), []);
  assert.deepEqual(pastMonths('2026-02'), ['2026-01']);
  assert.deepEqual(pastMonths('2026-04'), ['2026-01', '2026-02', '2026-03']);
  assert.equal(pastMonths('2026-12').length, 11);
  assert.equal(pastMonths('2026-12')[10], '2026-11');
});

test('monthName', () => {
  assert.equal(monthName('2026-01'), 'Январь 2026');
  assert.equal(monthName('2026-12'), 'Декабрь 2026');
});

test('pastIncomes: строка на каждый месяц, пустая сумма и 0 — месяц без дохода', () => {
  const rows = [
    { month: '2026-05', date: '2026-05-22', usd: '' },
    { month: '2026-06', date: '2026-06-22', usd: '600,15' },
    { month: '2026-07', date: '2026-07-23', usd: ' 5 200.40 ' },
    { month: '2026-08', date: '2026-08-22', usd: '0' },
    { month: '2026-09', date: '', usd: '  ' }, // без даты, но и без суммы — месяц без дохода
  ];
  assert.deepEqual(pastIncomes(rows), [
    { date: '2026-05-01', usd: 0 },
    { date: '2026-06-22', usd: 600.15 },
    { date: '2026-07-23', usd: 5200.40 },
    { date: '2026-08-01', usd: 0 },
    { date: '2026-09-01', usd: 0 },
  ]);
  assert.deepEqual(pastIncomes([]), []);
});

test('zeroIncome: запись месяца без дохода', () => {
  assert.deepEqual(zeroIncome('2026-03'), { date: '2026-03-01', usd: 0, rate: 0, gel: 0, tax_gel: 0 });
});

test('месяцы без дохода: вопрос больше не нужен, поле 15 не меняется', () => {
  let y = emptyYear(2026);
  for (const m of pastMonths('2026-09')) y = addIncome(y, zeroIncome(m));
  assert.equal(y.incomes.length, 8);
  assert.deepEqual(missingMonths(y, '2026-09'), []);
  y = addIncome(y, makeIncome('2026-09-21', 6100.55, 2.6071));
  assert.deepEqual(declarationFields(y, '2026-09'), { field15: 15904.74, field20: 15904.74 });
  assert.equal(y.total_gel, 15904.74);
});

test('addIncome: записанный месяц не перезаписывается', () => {
  let y = addIncome(emptyYear(2026), zeroIncome('2026-06'));
  assert.throws(() => addIncome(y, makeIncome('2026-06-22', 600.15, 2.7)), /уже есть запись за 2026-06: 2026-06-01, 0 USD/); // доход поверх 0
  y = addIncome(y, makeIncome('2026-07-22', 600.15, 2.7));
  assert.throws(() => addIncome(y, zeroIncome('2026-07')), /уже есть запись за 2026-07/); // 0 поверх дохода
  y = addIncome(y, zeroIncome('2026-06')); // повтор того же 0 — не ошибка
  assert.equal(y.incomes.length, 2);
});

test('prevMonth, prevMonthRange', () => {
  assert.equal(prevMonth(new Date(2026, 9, 2)), '2026-09');
  assert.equal(prevMonth(new Date(2026, 0, 15)), '2025-12');
  assert.deepEqual(prevMonthRange(new Date(2026, 9, 2)), { min: '2026-09-01', max: '2026-09-30' });
  assert.deepEqual(prevMonthRange(new Date(2026, 2, 31)), { min: '2026-02-01', max: '2026-02-28' });
  assert.deepEqual(prevMonthRange(new Date(2028, 2, 1)), { min: '2028-02-01', max: '2028-02-29' }); // високосный
  assert.deepEqual(prevMonthRange(new Date(2026, 0, 1)), { min: '2025-12-01', max: '2025-12-31' });
});

test('checkIncomeDate: только прошлый месяц', () => {
  const today = new Date(2026, 9, 2); // 2 октября 2026
  checkIncomeDate('2026-09-01', today);
  checkIncomeDate('2026-09-30', today);
  assert.throws(() => checkIncomeDate('2026-08-31', today), /дата 2026-08-31 не из прошлого месяца \(Сентябрь 2026\)/);
  assert.throws(() => checkIncomeDate('2026-10-01', today), /не из прошлого месяца/);
  assert.throws(() => checkIncomeDate('2025-09-22', today), /не из прошлого месяца/);
  assert.throws(() => checkIncomeDate('', today), /дата не указана/);
  checkIncomeDate('2025-12-22', new Date(2026, 0, 10)); // в январе — декабрь прошлого года
});

test('pastIncomes: ошибки с названием месяца', () => {
  assert.throws(() => pastIncomes([{ month: '2026-03', date: '2026-03-22', usd: 'abc' }]), /^Error: Март 2026: Сумма «abc» указана неверно/);
  assert.throws(() => pastIncomes([{ month: '2026-03', date: '', usd: '10' }]), /Март 2026: дата не указана/);
  assert.throws(() => pastIncomes([{ month: '2026-03', date: '2026-04-02', usd: '10' }]), /Март 2026: дата 2026-04-02 не в этом месяце/);
});

test('makeIncome: перевод в GEL и налог 1%', () => {
  assert.deepEqual(makeIncome('2026-09-21', 6100.55, 2.6071), {
    date: '2026-09-21', usd: 6100.55, rate: 2.6071, gel: 15904.74, tax_gel: 159.05,
  });
});

test('makeIncome: округление GEL до тетри, половина — вверх', () => {
  assert.equal(makeIncome('2026-01-05', 1, 2.605).gel, 2.61); // 2.605 без защиты даёт 2.60
  assert.equal(makeIncome('2026-01-05', 1, 2.6049).gel, 2.6);
  assert.equal(makeIncome('2026-01-05', 1.15, 1).gel, 1.15); // 1.15 * 100 = 114.999… в float
});

test('makeIncome: округление налога, половина тетри — вверх', () => {
  assert.equal(makeIncome('2026-01-05', 0.5, 1).tax_gel, 0.01); // 0.005 → 0.01
  assert.equal(makeIncome('2026-01-05', 0.49, 1).tax_gel, 0); // 0.0049 → 0
});

test('makeIncome: ноль и большая сумма', () => {
  assert.deepEqual(makeIncome('2026-01-05', 0, 2.7), { date: '2026-01-05', usd: 0, rate: 2.7, gel: 0, tax_gel: 0 });
  const big = makeIncome('2026-01-05', 1_000_000, 2.7123);
  assert.equal(big.gel, 2_712_300);
  assert.equal(big.tax_gel, 27_123);
});

test('addIncome: итоги без ошибок float', () => {
  let y = emptyYear(2026);
  y = addIncome(y, makeIncome('2026-03-01', 0.1, 1));
  y = addIncome(y, makeIncome('2026-04-01', 0.2, 1));
  assert.equal(y.total_usd, 0.3);
  assert.equal(y.total_gel, 0.3);
});

test('addIncome: сортировка по дате', () => {
  let y = emptyYear(2026);
  y = addIncome(y, makeIncome('2026-09-21', 1, 1));
  y = addIncome(y, makeIncome('2026-06-22', 1, 1));
  y = addIncome(y, makeIncome('2026-07-23', 1, 1));
  assert.deepEqual(y.incomes.map((i) => i.date), ['2026-06-22', '2026-07-23', '2026-09-21']);
});

test('addIncome: повтор (та же дата и сумма) не добавляется', () => {
  let y = emptyYear(2026);
  y = addIncome(y, makeIncome('2026-07-23', 5200.40, 2.7));
  y = addIncome(y, makeIncome('2026-07-23', 5200.40, 2.7));
  assert.equal(y.incomes.length, 1);
  assert.equal(y.total_usd, 5200.40);
});

test('addIncome: второе поступление в том же месяце — ошибка', () => {
  const y = addIncome(emptyYear(2026), makeIncome('2026-07-23', 5200.40, 2.7));
  assert.throws(() => addIncome(y, makeIncome('2026-07-23', 100, 2.7)), /уже есть запись за 2026-07: 2026-07-23, 5200.4 USD/); // та же дата
  assert.throws(() => addIncome(y, makeIncome('2026-07-01', 5200.40, 2.7)), /только одно поступление/); // тот же месяц
  assert.equal(addIncome(y, makeIncome('2026-08-01', 5200.40, 2.7)).incomes.length, 2); // соседний месяц
});

test('addIncome: не меняет исходные данные', () => {
  const y = emptyYear(2026);
  addIncome(y, makeIncome('2026-07-23', 1, 1));
  assert.deepEqual(y, emptyYear(2026));
});

test('addIncome: доход другого года — ошибка', () => {
  assert.throws(() => addIncome(emptyYear(2026), makeIncome('2025-12-22', 1, 1)), /другой год/);
  assert.throws(() => addIncome(emptyYear(2026), makeIncome('2027-01-05', 1, 1)), /другой год/);
});

test('declarationFields: поле 15 нарастающим итогом, поле 20 за месяц', () => {
  let y = emptyYear(2026);
  y = addIncome(y, makeIncome('2026-06-22', 600.15, 2.7)); // 1620.41
  y = addIncome(y, makeIncome('2026-07-01', 5200.40, 2.7)); // 14041.08, первый день месяца
  y = addIncome(y, makeIncome('2026-09-30', 6100.55, 2.6071)); // 15904.74, последний день месяца

  assert.deepEqual(declarationFields(y, '2026-05'), { field15: 0, field20: 0 }); // до первого дохода
  assert.deepEqual(declarationFields(y, '2026-06'), { field15: 1620.41, field20: 1620.41 });
  assert.deepEqual(declarationFields(y, '2026-07'), { field15: 15661.49, field20: 14041.08 });
  assert.deepEqual(declarationFields(y, '2026-08'), { field15: 15661.49, field20: 0 }); // нет дохода
  assert.deepEqual(declarationFields(y, '2026-09'), { field15: 31566.23, field20: 15904.74 });
  assert.deepEqual(declarationFields(y, '2026-12'), { field15: 31566.23, field20: 0 });
});

test('isYearData: структура файла года', () => {
  assert.equal(isYearData(emptyYear(2026), 2026), true);
  assert.equal(isYearData(addIncome(emptyYear(2026), makeIncome('2026-06-22', 1, 1)), 2026), true);
  assert.equal(isYearData(emptyYear(2025), 2026), false); // год не совпадает с именем файла
  assert.equal(isYearData({ year: 2026 }, 2026), false); // нет incomes
  assert.equal(isYearData({ year: 2026, incomes: {} }, 2026), false);
  assert.equal(isYearData({ year: 2026, incomes: [{ date: '2026-06-22', usd: 1 }] }, 2026), false); // нет gel
  assert.equal(isYearData({ year: 2026, incomes: [{ date: '22.06.2026', usd: 1, gel: 1 }] }, 2026), false);
  assert.equal(isYearData([], 2026), false);
  assert.equal(isYearData(null, 2026), false);
});

test('missingMonths: месяцы года до декларации без записи в файле', () => {
  const empty = emptyYear(2026);
  assert.deepEqual(missingMonths(empty, '2026-01'), []); // январь — прошлых месяцев нет
  assert.deepEqual(missingMonths(empty, '2026-04'), ['2026-01', '2026-02', '2026-03']);
  let y = addIncome(empty, makeIncome('2026-03-22', 1, 1));
  assert.deepEqual(missingMonths(y, '2026-05'), ['2026-01', '2026-02', '2026-04']); // пропуски вокруг записанного марта
  y = addIncome(y, zeroIncome('2026-01'));
  y = addIncome(y, zeroIncome('2026-02'));
  y = addIncome(y, makeIncome('2026-04-22', 1, 1));
  assert.deepEqual(missingMonths(y, '2026-05'), []); // запись с 0 тоже считается
  assert.deepEqual(missingMonths(y, '2026-04'), []); // месяц декларации не проверяется
});

test('declarationFields: январь нового года начинается с нуля', () => {
  assert.deepEqual(declarationFields(emptyYear(2027), '2027-01'), { field15: 0, field20: 0 });
});

// fetchRate с подменой fetch
async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}
const reply = (status, body) => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

test('fetchRate: курс из ответа NBG', async () => {
  let url;
  const body = [{ currencies: [{ code: 'USD', rate: 2.6071, validFromDate: '2026-09-19T00:00:00.000Z' }] }];
  const r = await withFetch(async (u) => ((url = u), reply(200, body)()), () => fetchRate('2026-09-21'));
  assert.deepEqual(r, { rate: 2.6071 });
  const noValidFrom = [{ currencies: [{ code: 'USD', rate: 2.6071 }] }];
  assert.deepEqual(await withFetch(reply(200, noValidFrom), () => fetchRate('2026-09-21')), { rate: 2.6071 });
  assert.match(url, /currencies=USD&date=2026-09-21$/);
});

test('fetchRate: ошибки с шагом и датой', async () => {
  const cases = [
    [async () => { throw new TypeError('Failed to fetch'); }, /нет ответа[\s\S]*2026-09-21[\s\S]*Failed to fetch/],
    [reply(500, 'Internal error'), /ошибку 500[\s\S]*2026-09-21[\s\S]*Internal error/],
    [reply(200, []), /нет курса USD[\s\S]*2026-09-21/],
    [reply(200, [{ currencies: [] }]), /нет курса USD/],
    [reply(200, [{ currencies: [{ code: 'USD', rate: 0 }] }]), /нет курса USD/],
    [reply(200, '<html>maintenance</html>'), /нет курса USD[\s\S]*maintenance/],
  ];
  for (const [fake, msg] of cases) {
    await assert.rejects(withFetch(fake, () => fetchRate('2026-09-21')), (e) => {
      assert.match(e.message, /^Шаг 3 \(курс NBG\)/);
      assert.match(e.message, msg);
      assert.match(e.message, /На RS ничего не изменено/);
      return true;
    });
  }
});
