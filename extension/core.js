// Расчёты и курс NBG. Без доступа к RS и к диску.

export const TAX_PERCENT = 1;

const pad = (n) => String(n).padStart(2, '0');

// 22 число предыдущего месяца, YYYY-MM-DD.
export function defaultDate(today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth() - 1, 22);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Предыдущий месяц, YYYY-MM. Декларация подаётся только за него.
export const prevMonth = (today = new Date()) => defaultDate(today).slice(0, 7);

// Первый и последний день предыдущего месяца, YYYY-MM-DD.
export function prevMonthRange(today = new Date()) {
  const last = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
  return { min: `${prevMonth(today)}-01`, max: `${prevMonth(today)}-${pad(last)}` };
}

export function checkIncomeDate(date, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Шаг 2 (ввод): дата не указана.\nНа RS ничего не изменено.');
  const month = prevMonth(today);
  if (date.slice(0, 7) !== month) {
    throw new Error(`Шаг 2 (ввод): дата ${date} не из прошлого месяца (${monthName(month)}).\nДекларация подаётся за прошлый месяц, поэтому дата дохода должна быть с ${month}-01 по последний день этого месяца.\nНа RS ничего не изменено.`);
  }
}

// Сумма USD из поля ввода: "6100.55", "6100,55", "6 100,55". Не больше 2 знаков после запятой, не меньше 0.
export function parseUsd(text) {
  const s = String(text).replace(/[\s ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new Error(`Сумма «${text}» указана неверно.\nВведите число не меньше 0, не больше 2 знаков после запятой. Например: 6100,55 или 0.`);
  }
  return Number(s);
}

export const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const monthName = (month) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

// Месяцы года до месяца декларации: '2026-04' → ['2026-01', '2026-02', '2026-03'].
export function pastMonths(month) {
  const year = month.slice(0, 4);
  return Array.from({ length: Number(month.slice(5, 7)) - 1 }, (_, i) => `${year}-${pad(i + 1)}`);
}

// Месяц без дохода: запись с суммой 0 на 1 число. Нужна, чтобы знать, что месяц уже учтён.
export const zeroIncome = (month) => makeIncome(`${month}-01`, 0, 0);

// Строки таблицы прошлых доходов [{ month, date, usd: текст }] → [{ date, usd }], по строке на месяц.
// Пустая сумма или 0 — месяц без дохода: { date: 'YYYY-MM-01', usd: 0 }. Дата дохода должна быть в своём месяце.
export function pastIncomes(rows) {
  const result = [];
  for (const { month, date, usd: text } of rows) {
    const name = monthName(month);
    let usd = 0;
    if (String(text).trim()) {
      try {
        usd = parseUsd(text);
      } catch (e) {
        throw new Error(`${name}: ${e.message}`);
      }
    }
    if (usd === 0) {
      result.push({ date: `${month}-01`, usd: 0 });
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${name}: дата не указана.`);
    if (date.slice(0, 7) !== month) throw new Error(`${name}: дата ${date} не в этом месяце.`);
    result.push({ date, usd });
  }
  return result;
}

// Деньги считаем в целых центах/тетри, курс — в целых десятитысячных, чтобы не было ошибок округления.
const toCents = (x) => Math.round(x * 100);
const fromCents = (c) => c / 100;

export function makeIncome(date, usd, rate) {
  const usdCents = toCents(usd);
  const gelCents = Math.round((usdCents * Math.round(rate * 10000)) / 10000);
  return {
    date,
    usd: fromCents(usdCents),
    rate,
    gel: fromCents(gelCents),
    tax_gel: fromCents(Math.round((gelCents * TAX_PERCENT) / 100)),
  };
}

export function emptyYear(year) {
  return { year, incomes: [], total_usd: 0, total_gel: 0 };
}

// Добавляет доход в данные года. Такой же доход (дата + сумма) второй раз не добавляется.
// Записанный месяц (в том числе с 0) не перезаписывается — ошибка.
// ponytail: одно поступление в месяц; несколько и перезапись — открытые вопросы в ADR.
export function addIncome(yearData, income) {
  if (income.date.slice(0, 4) !== String(yearData.year)) {
    throw new Error(`Доход за ${income.date} нельзя записать в файл ${yearData.year}.json: другой год.`);
  }
  const month = income.date.slice(0, 7);
  const exists = yearData.incomes.some((i) => i.date === income.date && i.usd === income.usd);
  const sameMonth = yearData.incomes.find((i) => i.date.slice(0, 7) === month);
  if (!exists && sameMonth) {
    throw new Error(`В файле ${yearData.year}.json уже есть запись за ${month}: ${sameMonth.date}, ${sameMonth.usd} USD.\nРасширение не перезаписывает записанные месяцы и поддерживает только одно поступление в месяц.\nНа RS ничего не изменено. Если сумма в файле неверная, исправьте файл вручную.`);
  }
  const incomes = exists ? yearData.incomes : [...yearData.incomes, income].sort((a, b) => a.date.localeCompare(b.date));
  const sum = (key) => fromCents(incomes.reduce((s, i) => s + toCents(i[key]), 0));
  return { ...yearData, incomes, total_usd: sum('usd'), total_gel: sum('gel') };
}

// Файл года после JSON.parse: год совпадает с именем файла, у каждой записи дата YYYY-MM-DD и числа usd, gel.
// Файл можно править вручную, поэтому проверяем перед использованием.
export function isYearData(data, year) {
  return (
    data?.year === year &&
    Array.isArray(data.incomes) &&
    data.incomes.every((i) => /^\d{4}-\d{2}-\d{2}$/.test(i?.date) && typeof i.usd === 'number' && typeof i.gel === 'number')
  );
}

// Месяцы года до месяца декларации, за которые в файле нет записи (даже с 0). Без них поле 15 неполное.
export function missingMonths(yearData, month) {
  const recorded = new Set(yearData.incomes.map((i) => i.date.slice(0, 7)));
  return pastMonths(month).filter((m) => !recorded.has(m));
}

// Поля декларации за месяц (YYYY-MM).
// Поле 15: доход с начала года по этот месяц включительно. Поле 20: доход за этот месяц.
export function declarationFields(yearData, month) {
  const sum = (list) => fromCents(list.reduce((s, i) => s + toCents(i.gel), 0));
  return {
    field15: sum(yearData.incomes.filter((i) => i.date.slice(0, 7) <= month)),
    field20: sum(yearData.incomes.filter((i) => i.date.slice(0, 7) === month)),
  };
}

export async function fetchRate(date) {
  const url = `https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/?currencies=USD&date=${date}`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`Шаг 3 (курс NBG): нет ответа от сервера NBG.\nДата запроса: ${date}.\nОшибка: ${e.message}.\nНа RS ничего не изменено. Проверьте интернет и нажмите «Заполнить» снова.`);
  }
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Шаг 3 (курс NBG): сервер NBG вернул ошибку ${res.status}.\nДата запроса: ${date}.\nОтвет: ${body.slice(0, 300)}.\nНа RS ничего не изменено. Попробуйте позже.`);
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    data = null;
  }
  const usd = data?.[0]?.currencies?.find?.((c) => c.code === 'USD');
  if (!usd || !(usd.rate > 0)) {
    throw new Error(`Шаг 3 (курс NBG): в ответе NBG нет курса USD.\nДата запроса: ${date}.\nОтвет: ${body.slice(0, 300)}.\nНа RS ничего не изменено. Проверьте курс вручную: https://nbg.gov.ge/en/monetary-policy/currency`);
  }
  return { rate: usd.rate };
}
