# Устройство страниц RS (проверено 2026-10-02)

Селекторы не зависят от языка (грузинский / English Version).

## Адреса

- Вход: `https://eservices.rs.ge/Login.aspx`
- Декларации: `https://decl.rs.ge/decls.aspx`.
- Вход в модуль: `https://eservices.rs.ge/Redirect.ashx?Module=DECL` (так открывает карточка Declarations, модуль ID 1 из `hsMenu.ashx/GetUserModulesAll`). Перенаправляет на `decls.aspx` и открывает сессию decl.rs.ge.
  Прямой `decls.aspx` без открытой сессии decl.rs.ge перекидывает на `eservices.rs.ge/MainPage.aspx`.
- Язык хранится в сессии decl.rs.ge, новая сессия — на грузинском. Текущий язык: `#main_footer[lang]` (`GEO` / `EN`).
  Переключить: `change_lang('EN')` (синхронный POST `sys_service.asmx/chage_language`), затем перезагрузить страницу. Кнопка `#btn_Lang` делает то же.

## Выбор декларации

- Меню слева и подвал (`#main_footer[lang]`) сайт строит скриптом после загрузки страницы (status `complete`). Их нужно ждать.
- Меню слева — jQuery UI accordion. «Monthly» (ყოველთვიური): `h3#hka1`.
- Small business (მცირე ბიზნესის საშემოსავლო გადასახადი): `td.acc_item[value="58"]`.
  Атрибут `text`: `<название>#1#202609#01.10.2024-` (`#1#` = ежемесячная).

## Период

- Поле: `#control_0_m`. Текущее значение: `#control_0_m .d_value` = `MM.YYYY` (например `09.2026`).
- Всплывающий выбор: год `td.y` (текст — год), месяц `td.m[v="9"]`, кнопка выбора `.d_ok_img`.
- Функция страницы: `ksd_set_value($('#control_0_m'), 'MM.YYYY')`, затем `control_0_m_chenge(element)` — обновляет таблицу.
- Клик по пункту 58 сбрасывает период на текущий и сам загружает таблицу. Нужно дождаться этой загрузки до смены периода, иначе её ответ перепишет таблицу.

## Таблица деклараций за период

- `#control_0_g3g` (атрибут `grid_id="3"`). Строки деклараций: `tr.must_remove.<SEQ_NUM>`.
- Статус: класс `decl_status_<код>`. `0` = saved (сохранена), `1` = Sent (отправлена).
- Загрузка: `$.ajax` POST `sys_service.asmx/get_grid_r_data`, в теле `'grid_id' : 3` и `'value': 'YYYYMM'`. Конец загрузки — событие jQuery `ajaxComplete` для этого запроса.
- Прочитать декларации без кликов: тот же POST `sys_service.asmx/get_grid_r_data` с `'grid_id' : 3` и фильтрами `gad_kod=58`, `sag_periodi=YYYYMM`, `tax_type=1` (`global: false`, чтобы не вызывать обработчики страницы). Ответ `d` — JSON-строка, `list[]` с полями `SEQ_NUM`, `STATUS` (0/1), `STATUS_TXT`. Ошибка — строка `-1:…`. Работает, даже если пункт 58 не выбран.
- Не подходят как признак загрузки: счётчик `.items_count` (обновляется не вовремя) и `$.active` (на странице висит другой запрос, значение не падает до 0).

## New return

- Кнопка: `#control_0_new` (ახალი დეკლარაცია), `onclick="control_0_create_new(this)"`.
- **Создаёт декларацию на сервере** (`call_sp(1, …)` с `V_TAX_CODE=58`, `V_TAX_PERIOD=YYYYMM`), потом открывает её (`view_decl`).

## Форма

- Открывается в окне на той же странице (не iframe): `.window_panel`. Заголовок: `.window_title_text` содержит `N:<SEQ_NUM>`.
- Период в форме: текст строки `პირველადი , 2026/09`.
- Поле 15: `.window_panel input[x_name="COL_15"]`, `onchange` ставит `col_15_changed_manualy=true` и считает итоги.
- Поле 20: `.window_panel input[x_name="COL_20"]`, `onchange` считает итоги.
- После ввода значения нужно вызвать событие `change`.
- Поле 17 и 26 считаются сайтом (readonly).
- Закрыть окно: `.window_panel .closeImg`.

## Информационное окно

При открытии формы может появиться jQuery UI dialog «გაფრთხილება!» (о строительных услугах). Закрыть: `.ui-dialog .ui-dialog-titlebar-close`.
