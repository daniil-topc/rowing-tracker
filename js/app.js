// Главный файл: состояние приложения, отрисовка экранов и обработка нажатий.

import {
  today, addDays, sameDay, mondayIndex, monthKey, toISO, fromISO,
  formatLong, capitalize, parseTime, formatTime, formatKm, plural, MONTHS, WD_SHORT,
} from './dates.js';
import { loadAll, save } from './storage.js';
import {
  getRecord, recordMeters, recordsBetween, currentStreak, bestStreak,
  summarize, metersByMonth, detectSeason,
} from './stats.js';

const tg = window.Telegram?.WebApp;
const $ = (selector) => document.querySelector(selector);

const VIEWS = ['welcome', 'today', 'calendar', 'stats', 'day', 'water'];
const TABS = ['today', 'calendar', 'stats'];
const PROFILE_KEY = 'profile';
const MONTH_KEY = /^\d{4}-\d{2}$/;

// ---------- Состояние ----------
// Всё, что меняется, лежит в одном объекте. Экран всегда рисуется из state.
const state = {
  profile: null,         // { name: "Даня" }
  db: {},                // тренировки по месяцам (формат описан в stats.js)
  view: 'today',
  history: [],           // стек экранов для кнопки «Назад»
  calMonth: null,        // первый день месяца, открытого в календаре
  statsPeriod: 'month',  // 'week' | 'month' | 'year'
  dayDate: null,         // дата, открытая на экране «День»
  editing: false,        // карточка отметки показывает вопрос, даже если день уже отмечен
  pickedType: null,      // что выбрано в переключателе: 'w' (вода) | 'g' (зал)
  water: null,           // черновик тренировки на воде: { date, time, segments }
};

// ---------- Утилиты ----------
// Экранируем всё, что ввёл пользователь, перед вставкой в innerHTML (защита от XSS)
function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str).replace(/[&<>"']/g, (ch) => map[ch]);
}

const icon = (id, size) => `<svg width="${size}" height="${size}"><use href="#i-${id}"/></svg>`;

let toastTimer;
function showToast(text) {
  const toast = $('#toast');
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 2500);
}

function haptic() {
  if (tg?.isVersionAtLeast?.('6.1')) tg.HapticFeedback.notificationOccurred('success');
}

// ---------- Сохранение ----------
async function setRecord(date, rec) {
  const key = monthKey(date);
  const month = { ...(state.db[key] || {}) };
  if (rec) month[date.getDate()] = rec;
  else delete month[date.getDate()];

  await save(key, month);  // сначала сохраняем, потом обновляем state:
  state.db[key] = month;   // если сохранение упадёт, на экране не будет «фантомной» отметки
}

// ---------- Навигация ----------
function go(view) {
  state.history.push(state.view);
  state.view = view;
  render();
  window.scrollTo(0, 0);
}

function back() {
  state.view = state.history.pop() || 'today';
  resetMark();
  render();
}

function switchTab(tab) {
  state.history = [];
  state.view = tab;
  resetMark();
  render();
  window.scrollTo(0, 0);
}

function resetMark() {
  state.editing = false;
  state.pickedType = null;
}

// ---------- Общие куски разметки ----------
function dayClass(date) {
  const rec = getRecord(state.db, date);
  const classes = [];
  if (rec) classes.push({ w: 'water', g: 'gym', x: 'missed' }[rec.t]);
  if (sameDay(date, today())) classes.push('today');
  if (date > today()) classes.push('future');
  return classes.join(' ');
}

function dayButton(date) {
  const disabled = date > today() ? 'disabled' : '';
  return `<button class="day ${dayClass(date)}" data-action="open-day" data-date="${toISO(date)}" ${disabled}>${date.getDate()}</button>`;
}

// Какой тип выбран в переключателе Вода/Зал:
// 1) то, что пользователь нажал сам  2) тип уже сохранённой отметки  3) текущий сезон
function selectedType(date) {
  if (state.pickedType) return state.pickedType;
  const rec = getRecord(state.db, date);
  if (rec && rec.t !== 'x') return rec.t;
  return detectSeason(state.db, date);
}

// Дата, которую сейчас отмечаем: сегодня или день, открытый из календаря
const markDate = () => (state.view === 'day' ? state.dayDate : today());

function markCard(date) {
  const rec = getRecord(state.db, date);
  const isToday = sameDay(date, today());

  // День уже отмечен — показываем результат
  if (rec && !state.editing) {
    const text = { w: `Вода · ${formatKm(recordMeters(rec))} км`, g: 'Зал', x: 'Пропуск' }[rec.t];
    const cls = { w: 'water', g: 'gym', x: 'missed' }[rec.t];
    return `
      <div class="card row">
        <div>
          <p class="caption">${isToday ? 'Сегодня отмечено' : 'Отмечено'}</p>
          <p class="headline mark-status ${cls}">${text}</p>
        </div>
        <button class="link" data-action="edit-mark">Изменить</button>
      </div>`;
  }

  // Иначе — вопрос
  const type = selectedType(date);
  return `
    <div class="card question">
      <h2 class="headline">${isToday ? 'Была тренировка сегодня?' : 'Была тренировка в этот день?'}</h2>
      <div class="segmented">
        <button class="${type === 'w' ? 'on' : ''}" data-action="pick-type" data-type="w">${icon('water', 16)}Вода</button>
        <button class="${type === 'g' ? 'on' : ''}" data-action="pick-type" data-type="g">${icon('gym', 16)}Зал</button>
      </div>
      <div class="btns">
        <button class="btn btn-yes" data-action="answer" data-yes="1">Да</button>
        <button class="btn btn-no" data-action="answer" data-yes="0">Нет</button>
      </div>
      ${rec ? '<button class="link muted" data-action="delete-mark">Удалить отметку</button>' : ''}
    </div>`;
}

function topbar(title, caption) {
  return `
    <header class="topbar">
      <button class="icon-btn" data-action="back" aria-label="Назад">${icon('back', 18)}</button>
      <div>
        <h1 class="headline">${title}</h1>
        <p class="caption">${caption}</p>
      </div>
    </header>`;
}

// ---------- Экраны ----------
function renderWelcome(el) {
  const suggested = state.profile?.name || tg?.initDataUnsafe?.user?.first_name || '';
  el.classList.add('welcome');
  el.innerHTML = `
    <div class="welcome-icon">${icon('oars', 36)}</div>
    <h1 class="title">Как тебя зовут?</h1>
    <form id="name-form" style="display:flex;flex-direction:column;gap:12px">
      <input class="name-input" name="name" maxlength="30" autocomplete="given-name" placeholder="Имя" value="${escapeHtml(suggested)}">
      <p class="error" id="name-error" hidden></p>
      <button class="btn btn-yes" type="submit">Продолжить</button>
    </form>`;
}

function renderToday(el) {
  const t = today();
  const streak = currentStreak(state.db, t);
  const best = bestStreak(state.db, t);
  const season = detectSeason(state.db, t);
  const monday = addDays(t, -mondayIndex(t));
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  el.innerHTML = `
    <div class="row" style="align-items:flex-start">
      <button class="greeting" data-action="edit-name" aria-label="Изменить имя">
        <span class="caption">${formatLong(t)}</span>
        <span class="title">Привет, ${escapeHtml(state.profile.name)}</span>
      </button>
      <span class="season ${season === 'w' ? 'water' : ''}"><i></i>Сезон: ${season === 'w' ? 'вода' : 'зал'}</span>
    </div>

    <div class="card streak">
      <div>
        <p class="caption">Текущая серия</p>
        <p class="streak-num">${streak}<small>${plural(streak, ['тренировка', 'тренировки', 'тренировок'])} подряд</small></p>
        <p class="caption">Лучшая серия: ${best}</p>
      </div>
      <svg class="flame"><use href="#i-flame"/></svg>
    </div>

    ${markCard(t)}

    <div>
      <p class="caption" style="margin-bottom:12px">Эта неделя</p>
      <div class="week">
        ${week.map((d) => `<div><p class="wd">${WD_SHORT[mondayIndex(d)]}</p>${dayButton(d)}</div>`).join('')}
      </div>
    </div>`;
}

function renderDay(el) {
  const d = state.dayDate;
  el.innerHTML = `${topbar(formatLong(d), 'Отметка за день')}${markCard(d)}`;
}

function renderCalendar(el) {
  const first = state.calMonth;
  const t = today();
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const isCurrentMonth = monthKey(first) === monthKey(t);
  const last = new Date(first.getFullYear(), first.getMonth(), daysInMonth);
  const sum = summarize(recordsBetween(state.db, first, last));

  const cells = [];
  for (let i = 0; i < mondayIndex(first); i++) cells.push('<div class="day empty"></div>');
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(dayButton(new Date(first.getFullYear(), first.getMonth(), day)));
  }

  const summary = sum.done + sum.missed === 0
    ? '<p class="caption">В этом месяце пока нет отметок</p>'
    : `
      <div class="row">
        <div>
          <p class="caption">За ${MONTHS[first.getMonth()]}</p>
          <p class="headline" style="margin-top:4px">${sum.done} ${plural(sum.done, ['тренировка', 'тренировки', 'тренировок'])}</p>
          <p class="caption" style="margin-top:2px">Пропусков: ${sum.missed}</p>
        </div>
        <p class="title" style="color:var(--accent)">${sum.rate}%</p>
      </div>
      <div class="split">
        <div><b><i class="dot" style="background:var(--water)"></i>${sum.water} · ${formatKm(sum.waterMeters)} км</b><span class="caption">На воде</span></div>
        <div><b><i class="dot" style="background:var(--accent)"></i>${sum.gym}</b><span class="caption">В зале</span></div>
      </div>`;

  el.innerHTML = `
    <div class="row">
      <h1 class="title">${capitalize(MONTHS[first.getMonth()])} ${first.getFullYear()}</h1>
      <div style="display:flex;gap:8px">
        <button class="icon-btn" data-action="cal-move" data-step="-1" aria-label="Предыдущий месяц">${icon('back', 18)}</button>
        <button class="icon-btn" data-action="cal-move" data-step="1" aria-label="Следующий месяц" ${isCurrentMonth ? 'disabled' : ''}>${icon('next', 18)}</button>
      </div>
    </div>

    <div class="card" style="padding:16px 10px">
      <div class="grid">
        ${WD_SHORT.map((d) => `<p class="wd">${d}</p>`).join('')}
        ${cells.join('')}
      </div>
    </div>

    <div class="legend">
      <span><i class="dot" style="background:var(--water)"></i>Вода</span>
      <span><i class="dot" style="background:var(--accent)"></i>Зал</span>
      <span><i class="dot" style="background:rgba(248,113,113,.5)"></i>Пропуск</span>
    </div>

    <div class="card">${summary}</div>`;
}

function renderStats(el) {
  const t = today();
  const from = {
    week: addDays(t, -mondayIndex(t)),
    month: new Date(t.getFullYear(), t.getMonth(), 1),
    year: new Date(t.getFullYear(), 0, 1),
  }[state.statsPeriod];
  const sum = summarize(recordsBetween(state.db, from, t));

  const months = metersByMonth(state.db, t, 7);
  const max = Math.max(...months.map((m) => m.meters));
  const bestMonth = max > 0 ? months.find((m) => m.meters === max).label.toLowerCase() : null;

  const periods = [['week', 'Неделя'], ['month', 'Месяц'], ['year', 'Год']];

  el.innerHTML = `
    <h1 class="title">Статистика</h1>

    <div class="segmented on-surface">
      ${periods.map(([id, label]) => `<button class="${state.statsPeriod === id ? 'on' : ''}" data-action="period" data-period="${id}">${label}</button>`).join('')}
    </div>

    <div class="stats">
      <div class="stat"><span class="caption">Всего тренировок</span><b>${sum.done}</b></div>
      <div class="stat"><span class="caption">Посещаемость</span><b style="color:var(--accent)">${sum.rate === null ? '—' : sum.rate + '%'}</b></div>
      <div class="stat"><span class="caption">На воде</span><b style="color:var(--water)">${sum.water}<small>· ${formatKm(sum.waterMeters)} км</small></b></div>
      <div class="stat"><span class="caption">В зале</span><b>${sum.gym}</b></div>
    </div>

    <div class="card">
      <div class="row">
        <p class="caption">Километры на воде</p>
        <p class="caption">${bestMonth ? 'Лучший: ' + bestMonth : 'Пока нет данных'}</p>
      </div>
      <div class="chart">
        ${months.map((m) => {
          const height = max > 0 ? Math.round((m.meters / max) * 100) : 0;
          const title = `${formatKm(m.meters)} км`;
          return `<div class="bar ${m.meters === max && max > 0 ? 'max' : ''}" title="${title}"><i style="height:${height}%"></i><span>${m.label}</span></div>`;
        }).join('')}
      </div>
    </div>`;
}

// --- Тренировка на воде ---
function openWater(date) {
  const rec = getRecord(state.db, date);
  const isWater = rec?.t === 'w';
  state.water = {
    date,
    time: isWater && rec.s ? formatTime(rec.s) : '',
    segments: isWater ? rec.g.map(([name, reps, meters]) => ({ name, reps, meters })) : [],
  };
  go('water');
}

function segmentTitle({ name, reps, meters }) {
  const distance = reps > 1 ? `${reps} × ${meters} м` : `${meters} м`;
  return name ? `${name} · ${distance}` : distance;
}

function renderWater(el) {
  const w = state.water;
  el.innerHTML = `
    ${topbar('Тренировка на воде', formatLong(w.date))}

    <div class="card">
      <p class="caption">Всего пройдено</p>
      <p class="total"><span id="w-total">0</span><small>км</small></p>
      <div class="metrics">
        <label>
          <input class="time-input" id="w-time" inputmode="numeric" placeholder="мм:сс" value="${escapeHtml(w.time)}">
          <span class="caption">Время</span>
        </label>
        <div><b id="w-pace">—</b><span class="caption">Средний темп / 500 м</span></div>
      </div>
    </div>

    <div>
      <p class="caption">Отрезки</p>
      <div class="card segments">
        <div id="w-list"></div>
        <form class="seg-form" id="seg-form" autocomplete="off">
          <input name="name" placeholder="Название" maxlength="20">
          <input name="reps" type="number" inputmode="numeric" min="1" max="50" value="1" aria-label="Повторы">
          <span class="x">×</span>
          <input name="meters" type="number" inputmode="numeric" min="50" max="50000" placeholder="метры" aria-label="Дистанция в метрах">
          <button class="add-btn" type="submit" aria-label="Добавить отрезок">${icon('plus', 18)}</button>
        </form>
      </div>
    </div>

    <p class="error" id="w-error" hidden></p>
    <button class="btn btn-yes btn-save" data-action="save-water">Сохранить</button>`;
  updateWater();
}

// Обновляем только то, что зависит от данных, — чтобы не терять фокус в полях ввода
function updateWater() {
  const w = state.water;
  const meters = w.segments.reduce((sum, s) => sum + s.reps * s.meters, 0);
  const seconds = parseTime(w.time);

  $('#w-total').textContent = formatKm(meters);
  // Темп на 500 м = время / количество отрезков по 500 м
  $('#w-pace').textContent = seconds && meters ? formatTime(Math.round(seconds / (meters / 500))) : '—';

  $('#w-list').innerHTML = w.segments.length
    ? w.segments.map((s, i) => `
        <div class="seg">
          <span>${escapeHtml(segmentTitle(s))}</span>
          <span class="seg-right">${formatKm(s.reps * s.meters)} км
            <button class="icon-x" data-action="remove-seg" data-index="${i}" aria-label="Удалить отрезок">${icon('close', 16)}</button>
          </span>
        </div>`).join('')
    : '<p class="empty">Добавь отрезки: название, повторы × метры</p>';
}

function waterError(text) {
  const el = $('#w-error');
  el.textContent = text;
  el.hidden = !text;
}

async function saveWater() {
  const w = state.water;
  if (w.segments.length === 0) return waterError('Добавь хотя бы один отрезок.');

  const seconds = w.time.trim() ? parseTime(w.time) : null;
  if (w.time.trim() && !seconds) return waterError('Время в формате мм:сс или ч:мм:сс, например 58:40.');

  const rec = { t: 'w', g: w.segments.map((s) => [s.name, s.reps, s.meters]) };
  if (seconds) rec.s = seconds;

  await setRecord(w.date, rec);
  haptic();
  back();
}

// ---------- Главная отрисовка ----------
const RENDERERS = {
  welcome: renderWelcome, today: renderToday, calendar: renderCalendar,
  stats: renderStats, day: renderDay, water: renderWater,
};

function render() {
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== state.view;
  const isTab = TABS.includes(state.view);
  $('#tabbar').hidden = !isTab;
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('on', tab.dataset.tab === state.view));

  RENDERERS[state.view]($(`#view-${state.view}`));

  // Системная кнопка «Назад» в шапке Telegram
  if (tg?.isVersionAtLeast?.('6.1')) {
    const needBack = !isTab && state.history.length > 0;
    needBack ? tg.BackButton.show() : tg.BackButton.hide();
  }
}

// ---------- Обработчики ----------
// Один обработчик на весь документ (делегирование): кнопки перерисовываются, а он остаётся
const actions = {
  back,
  'edit-name': () => go('welcome'),
  'pick-type': (btn) => {
    state.pickedType = btn.dataset.type;
    render();
  },
  answer: async (btn) => {
    const date = markDate();
    const yes = btn.dataset.yes === '1';
    const type = selectedType(date);

    if (yes && type === 'w') return openWater(date);  // для воды сначала подробности

    await setRecord(date, { t: yes ? 'g' : 'x' });
    haptic();
    resetMark();
    render();
  },
  'edit-mark': () => {
    state.editing = true;
    render();
  },
  'delete-mark': async () => {
    await setRecord(markDate(), null);
    resetMark();
    render();
  },
  'open-day': (btn) => {
    const date = fromISO(btn.dataset.date);
    if (sameDay(date, today())) return switchTab('today');
    state.dayDate = date;
    resetMark();
    go('day');
  },
  'cal-move': (btn) => {
    const m = state.calMonth;
    state.calMonth = new Date(m.getFullYear(), m.getMonth() + Number(btn.dataset.step), 1);
    render();
  },
  period: (btn) => {
    state.statsPeriod = btn.dataset.period;
    render();
  },
  'remove-seg': (btn) => {
    state.water.segments.splice(Number(btn.dataset.index), 1);
    updateWater();
  },
  'save-water': saveWater,
};

document.addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-action], [data-tab]');
  if (!btn || btn.disabled) return;
  if (btn.dataset.tab) return switchTab(btn.dataset.tab);

  try {
    await actions[btn.dataset.action]?.(btn);
  } catch (error) {
    showToast(error.message || 'Не удалось сохранить');
  }
});

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;

  // Имя
  if (form.id === 'name-form') {
    // form.name — это атрибут name самой формы, поэтому поле берём через elements
    const name = form.elements.namedItem('name').value.trim();
    const error = $('#name-error');
    if (!name) {
      error.textContent = 'Напиши имя, чтобы продолжить.';
      error.hidden = false;
      return;
    }
    try {
      const profile = { ...state.profile, name };
      await save(PROFILE_KEY, profile);
      state.profile = profile;
      $('#view-welcome').classList.remove('welcome');
      switchTab('today');
    } catch (err) {
      showToast(err.message || 'Не удалось сохранить');
    }
    return;
  }

  // Новый отрезок
  if (form.id === 'seg-form') {
    const reps = Number(form.reps.value);
    const meters = Number(form.meters.value);
    if (!Number.isInteger(reps) || reps < 1 || !Number.isInteger(meters) || meters <= 0) {
      return waterError('Укажи повторы и дистанцию в метрах целыми числами.');
    }
    waterError('');
    state.water.segments.push({ name: form.elements.namedItem('name').value.trim(), reps, meters });
    form.reset();
    updateWater();
    form.meters.focus();
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'w-time') {
    state.water.time = event.target.value;
    updateWater();
  }
});

// ---------- Запуск ----------
async function init() {
  if (tg) {
    tg.ready();
    tg.expand();
    if (tg.isVersionAtLeast?.('6.1')) {
      tg.setHeaderColor('#0A0A0B');
      tg.setBackgroundColor('#0A0A0B');
      tg.BackButton.onClick(back);
    }
    if (tg.isVersionAtLeast?.('7.10')) tg.setBottomBarColor('#0A0A0B');
  }

  const t = today();
  state.calMonth = new Date(t.getFullYear(), t.getMonth(), 1);

  try {
    const all = await loadAll();
    state.profile = all[PROFILE_KEY] || null;
    for (const [key, value] of Object.entries(all)) {
      if (MONTH_KEY.test(key) && value) state.db[key] = value;
    }
  } catch {
    showToast('Не удалось загрузить данные');
  }

  // Первый запуск — спрашиваем имя
  state.view = state.profile?.name ? 'today' : 'welcome';
  render();
}

init();
