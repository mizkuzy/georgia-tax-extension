// Сценарий «Заполнить декларацию». Без Chrome и DOM: сайт, файл, NBG и панель передаются в deps.
// deps: { today, input: { date, usd }, ui: { log, ask, pastTable }, storage: { readYear, writeYear }, fetchRate,
//         rs: { openDeclPage, listDeclarations, selectMonth, openForm, fillFields } }
import { checkIncomeDate, parseUsd, monthName, pastIncomes, zeroIncome, makeIncome, addIncome, missingMonths, declarationFields } from './core.js';

// Прошлые месяцы года без записи в файле. Нет доходов — месяцы с 0. Есть — таблица. Возвращает данные года.
async function askPastIncomes({ ui, storage, fetchRate }, data, missing) {
  const year = missing[0].slice(0, 4);
  const names = missing.map(monthName).join(', ');
  if (!(await ui.ask(`В файле ${year}.json нет записей за: ${names}. Поле 15 — сумма за весь год.\nБыли доходы в эти месяцы?`))) {
    const next = missing.reduce((d, m) => addIncome(d, zeroIncome(m)), data);
    await storage.writeYear(next);
    ui.log(`Шаг 2: месяцы ${names} записаны в ${year}.json с суммой 0.`);
    return next;
  }
  for (;;) {
    const rows = await ui.pastTable(missing);
    if (!rows) throw new Error('Шаг 2: остановлено.\nНа RS ничего не изменено.');
    try {
      let next = data;
      const lines = [];
      for (const { date, usd } of pastIncomes(rows)) {
        if (usd === 0) {
          next = addIncome(next, zeroIncome(date.slice(0, 7)));
          lines.push(`${monthName(date.slice(0, 7))}: 0`);
          continue;
        }
        const { rate } = await fetchRate(date);
        const income = makeIncome(date, usd, rate);
        next = addIncome(next, income);
        lines.push(`${date}: ${income.usd} USD × ${rate} = ${income.gel} GEL`);
      }
      await storage.writeYear(next);
      ui.log(`Шаг 2: прошлые доходы записаны в ${year}.json:\n${lines.join('\n')}`);
      return next;
    } catch (e) {
      ui.log(`${e.message}\nФайл не изменён. Исправьте таблицу и нажмите «Сохранить и продолжить» снова.`, 'err');
    }
  }
}

export async function fillDeclaration(deps) {
  const { today, input, ui, storage, fetchRate, rs } = deps;
  const nothing = 'ничего не изменено';
  let state = nothing;
  try {
    // Шаг 2. Ввод
    checkIncomeDate(input.date, today);
    const usd = parseUsd(input.usd);
    const date = input.date;
    const month = date.slice(0, 7);
    const year = Number(date.slice(0, 4));
    let data = await storage.readYear(year);
    ui.log(`Шаг 2: ${date}, ${usd} USD. В файле ${year}.json доходов: ${data.incomes.length}.`);
    const missing = missingMonths(data, month);
    if (missing.length) data = await askPastIncomes(deps, data, missing);

    // Шаг 3. Курс и расчёт
    let income = null;
    const lines = [];
    if (usd > 0) {
      const { rate } = await fetchRate(date);
      income = makeIncome(date, usd, rate);
      data = addIncome(data, income);
      lines.push(
        'Шаг 3: проверка курса.',
        `Курс NBG на ${date}: 1 USD = ${rate} GEL.`,
        `${rate} × ${income.usd} = ${income.gel.toFixed(2)} GEL.`,
        `Налог 1% = ${income.tax_gel.toFixed(2)} GEL.`,
      );
    } else {
      addIncome(data, zeroIncome(month)); // только проверка: записанный доход за месяц — ошибка
      lines.push('Шаг 3: сумма 0 — месяц без дохода, курс не нужен.');
    }
    const { field15, field20 } = declarationFields(data, month);
    lines.push(`Накопленный доход (поле 15) = ${field15.toFixed(2)}.`, `Доход в этом месяце (поле 20) = ${field20.toFixed(2)}.`);
    ui.log(lines.join('\n'));

    // Шаг 4. Страница деклараций; декларации за месяц — запросом, без кликов
    const tabId = await rs.openDeclPage();
    ui.log('Шаг 4: открыта страница деклараций RS (English).');
    const rows = await rs.listDeclarations(tabId, month);
    ui.log(`Шаг 4: деклараций за ${month}: ${rows.length}.`);

    // Шаг 5. Существующая декларация или New return. Все вопросы — до первого клика на сайте.
    const sent = rows.find((r) => r.status !== '0');
    if (sent) throw new Error(`Шаг 5: в этом месяце уже есть декларация №${sent.seq} (${sent.text}).\nНа RS ничего не изменено.`);
    let seq = null;
    if (rows.length) {
      const others = rows.length > 1 ? `\nЕщё сохранённые за этот месяц: ${rows.slice(1).map((r) => `№${r.seq}`).join(', ')}. Их расширение не трогает.` : '';
      const yes = await ui.ask(`За ${month} уже есть сохранённая декларация №${rows[0].seq}. Открыть её и заполнить поля 15 и 20?${others}`);
      if (!yes) throw new Error('Шаг 5: вы отказались открывать сохранённую декларацию.\nНа RS ничего не изменено.');
      seq = rows[0].seq;
    }
    await rs.selectMonth(tabId, month);
    ui.log(`Шаг 5: выбраны Small Business Income Declaration и период ${month}.`);
    if (!seq) state = `возможно, создан пустой черновик за ${month}`;
    const { number } = await rs.openForm(tabId, month, seq);
    state = seq ? `открыта сохранённая декларация №${number}, поля не заполнены` : `создан черновик №${number} за ${month}, поля не заполнены`;
    ui.log(`Шаг 5: ${seq ? 'открыта сохранённая' : 'создана новая'} декларация №${number}.`);

    // Шаг 6. Заполнение
    const r = await rs.fillFields(tabId, field15, field20);
    state = `в декларации №${number} заполнены поля 15 и 20, не сохранено`;
    ui.log(`Шаг 6: поле 15 = ${r.c15}, поле 20 = ${r.c20}. Сайт посчитал: поле 17 = ${r.c17}, налог (поле 26) = ${r.c26}.`);

    // Шаг 7. Запись в файл
    if (income) {
      try {
        await storage.writeYear(data);
      } catch (e) {
        throw new Error(`Шаг 7: доход не записан в файл ${year}.json.\nОшибка: ${e.message}\nЧто сделать: добавьте в файл вручную: ${JSON.stringify(income)}`);
      }
      ui.log(`Шаг 7: доход записан в ${year}.json.`);
    } else {
      ui.log('Шаг 7: месяц без дохода, файл не меняется.');
    }
    ui.log('Готово. Проверьте декларацию и отправьте её сами.', 'ok');
  } catch (e) {
    ui.log(state === nothing ? e.message : `${e.message}\n\nНа RS: ${state}.`, 'err');
  }
}
