import {
  today, addDays, sameDay, mondayIndex, monthKey, toISO, fromISO,
  formatLong, capitalize, parseTime, formatTime, formatDuration, formatKm, formatDistance, parseDistance,
  plural, MONTHS, WD_SHORT,
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

const state = {
  profile: null,
  db: {},
  view: 'today',
  history: [],
  calMonth: null,
  statsPeriod: 'month',
  dayDate: null,
  editing: false,
  pickedType: null,
  water: null,
  nav: 'tab',
  flash: null,
};

// Экранирует ввод пользователя перед вставкой в innerHTML (защита от XSS)
function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str).replace(/[&<>"']/g, (ch) => map[ch]);
}

const icon = (id, size) => `<svg width="${size}" height="${size}"><use href="#i-${id}"/></svg>`;

let toastTimer;
function showToast(text) {
  const toast = $('#toast');
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

function haptic() {
  if (tg?.isVersionAtLeast?.('6.1')) tg.HapticFeedback.notificationOccurred('success');
}
function tick() {
  if (tg?.isVersionAtLeast?.('6.1')) tg.HapticFeedback.selectionChanged();
}

// Перезапускает CSS-анимацию: снять класс, вызвать reflow, вернуть класс
function replay(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

// Двигает подложку переключателя через CSS-переменную --index, без перерисовки экрана
function moveSegment(btn) {
  const group = btn.parentElement;
  const buttons = [...group.querySelectorAll('button')];
  buttons.forEach((b) => b.classList.toggle('on', b === btn));
  group.style.setProperty('--index', buttons.indexOf(btn));
}

// Сохраняет отметку дня: сначала в хранилище, потом в state.
// Если сохранение упадёт, на экране не появится отметка, которой нет в данных
async function setRecord(date, rec) {
  const key = monthKey(date);
  const month = { ...(state.db[key] || {}) };
  if (rec) month[date.getDate()] = rec;
  else delete month[date.getDate()];

  await save(key, month);
  state.db[key] = month;
}

function go(view) {
  state.history.push(state.view);
  state.view = view;
  state.nav = 'push';
  render();
  window.scrollTo(0, 0);
}

function back() {
  state.view = state.history.pop() || 'today';
  state.nav = 'pop';
  resetMark();
  render();
}

function switchTab(tab) {
  state.history = [];
  state.view = tab;
  state.nav = 'tab';
  resetMark();
  render();
  window.scrollTo(0, 0);
}

function resetMark() {
  state.editing = false;
  state.pickedType = null;
}

function dayClass(date) {
  const rec = getRecord(state.db, date);
  const classes = [];
  if (rec) classes.push({ w: 'water', g: 'gym', x: 'missed' }[rec.t]);
  if (sameDay(date, today())) classes.push('today');
  if (date > today()) classes.push('future');
  if (state.flash === toISO(date)) classes.push('pop');
  return classes.join(' ');
}

function dayButton(date) {
  const disabled = date > today() ? 'disabled' : '';
  return `<button class="day ${dayClass(date)}" data-action="open-day" data-date="${toISO(date)}" ${disabled}>${date.getDate()}</button>`;
}

// Что выбрано в «Вода/Зал»: нажатое пользователем → тип сохранённой отметки → текущий сезон
function selectedType(date) {
  if (state.pickedType) return state.pickedType;
  const rec = getRecord(state.db, date);
  if (rec && rec.t !== 'x') return rec.t;
  return detectSeason(state.db, date);
}

const markDate = () => (state.view === 'day' ? state.dayDate : today());

function markCard(date) {
  const rec = getRecord(state.db, date);
  const isToday = sameDay(date, today());
  const pop = state.flash ? 'pop' : '';

  if (rec && !state.editing) {
    const meters = recordMeters(rec);
    const water = meters ? `Вода · ${formatKm(meters)} км` : 'Вода';
    const text = { w: water, g: 'Зал', x: 'Пропуск' }[rec.t];
    const cls = { w: 'water', g: 'gym', x: 'missed' }[rec.t];
    return `
      <div class="card row ${pop}">
        <div>
          <p class="caption">${isToday ? 'Сегодня отмечено' : 'Отмечено'}</p>
          <p class="headline mark-status ${cls}">${text}</p>
        </div>
        <button class="link" data-action="edit-mark">Изменить</button>
      </div>`;
  }

  const type = selectedType(date);
  return `
    <div class="card question ${pop}">
      <h2 class="headline">${isToday ? 'Была тренировка сегодня?' : 'Была тренировка в этот день?'}</h2>
      <div class="segmented" style="--count:2;--index:${type === 'w' ? 0 : 1}">
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
        <p class="streak-num ${state.flash && state.flash !== 'edit' ? 'bump' : ''}">${streak}<small>${plural(streak, ['тренировка', 'тренировки', 'тренировок'])} подряд</small></p>
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

    <div class="card" style="padding:16px 10px;overflow:hidden">
      <div class="grid ${{ 'cal-next': 'slide-next', 'cal-prev': 'slide-prev' }[state.flash] || ''}">
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

const PERIODS = [['week', 'Неделя'], ['month', 'Месяц'], ['year', 'Год']];

// Карточки с цифрами вынесены отдельно: при смене периода обновляются только они, график не трогаем
function statCards() {
  const t = today();
  const from = {
    week: addDays(t, -mondayIndex(t)),
    month: new Date(t.getFullYear(), t.getMonth(), 1),
    year: new Date(t.getFullYear(), 0, 1),
  }[state.statsPeriod];
  const sum = summarize(recordsBetween(state.db, from, t));
  return `
    <div class="stat"><span class="caption">Всего тренировок</span><b>${sum.done}</b></div>
    <div class="stat"><span class="caption">Посещаемость</span><b style="color:var(--accent)">${sum.rate === null ? '—' : sum.rate + '%'}</b></div>
    <div class="stat"><span class="caption">На воде</span><b style="color:var(--water)">${sum.water}<small>· ${formatKm(sum.waterMeters)} км</small></b></div>
    <div class="stat"><span class="caption">В зале</span><b>${sum.gym}</b></div>`;
}

function renderStats(el) {
  const t = today();
  const months = metersByMonth(state.db, t, 7);
  const max = Math.max(...months.map((m) => m.meters));
  const bestMonth = max > 0 ? months.find((m) => m.meters === max).label.toLowerCase() : null;
  const index = PERIODS.findIndex(([id]) => id === state.statsPeriod);

  el.innerHTML = `
    <h1 class="title">Статистика</h1>

    <div class="segmented on-surface" style="--count:${PERIODS.length};--index:${index}">
      ${PERIODS.map(([id, label]) => `<button class="${state.statsPeriod === id ? 'on' : ''}" data-action="period" data-period="${id}">${label}</button>`).join('')}
    </div>

    <div class="stats" id="stat-cards">${statCards()}</div>

    <div class="card">
      <div class="row">
        <p class="caption">Километры на воде</p>
        <p class="caption">${bestMonth ? 'Лучший: ' + bestMonth : 'Пока нет данных'}</p>
      </div>
      <div class="chart">
        ${months.map((m, i) => {
          const height = max > 0 ? Math.round((m.meters / max) * 100) : 0;
          const title = `${formatKm(m.meters)} км`;
          return `<div class="bar ${m.meters === max && max > 0 ? 'max' : ''}" title="${title}" style="--i:${i}"><i style="height:${height}%"></i><span>${m.label}</span></div>`;
        }).join('')}
      </div>
    </div>`;
}

function openWater(date) {
  const rec = getRecord(state.db, date);
  const isWater = rec?.t === 'w';
  state.water = {
    date,
    time: isWater && rec.s ? formatTime(rec.s) : '',
    segments: isWater ? rec.g.map(([name, reps, meters, seconds = 0]) => ({ name, reps, meters, seconds })) : [],
  };
  go('water');
}

const distanceUnit = () => state.profile?.unit || 'km';
const segMode = () => state.profile?.segMode || 'dist';
const UNIT_LABEL = { km: 'км', m: 'м' };

function distancePlaceholder() {
  if (segMode() === 'time') return 'Дистанция (необяз.)';
  return distanceUnit() === 'km' ? '0,5' : '500';
}

// Название отрезка: "4 × 500 м", "4 × 10 мин" или "4 × 10 мин по 2,6 км"
function segmentTitle({ name, reps, meters, seconds }) {
  const amount = seconds ? formatDuration(seconds) : formatDistance(meters);
  let text = reps > 1 ? `${reps} × ${amount}` : amount;
  if (seconds && meters) text += `${reps > 1 ? ' по ' : ' · '}${formatDistance(meters)}`;
  return name ? `${name} · ${text}` : text;
}

const segmentTotal = ({ reps, meters, seconds }) => (meters ? `${formatKm(reps * meters)} км` : formatDuration(reps * seconds));

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
        <form class="seg-form ${segMode() === 'time' ? 'time' : ''}" id="seg-form" autocomplete="off">
          <div class="segmented" style="--count:2;--index:${segMode() === 'time' ? 1 : 0}">
            <button type="button" class="${segMode() === 'dist' ? 'on' : ''}" data-action="seg-mode" data-mode="dist">Дистанция</button>
            <button type="button" class="${segMode() === 'time' ? 'on' : ''}" data-action="seg-mode" data-mode="time">Время</button>
          </div>
          <input name="name" placeholder="Название (необязательно)" maxlength="20">
          <input name="reps" type="number" inputmode="numeric" min="1" max="50" value="1" aria-label="Повторы">
          <span class="x">×</span>
          <input class="time-field" name="seg-time" inputmode="numeric" placeholder="мм:сс" aria-label="Время отрезка">
          <input name="distance" inputmode="decimal" placeholder="${distancePlaceholder()}" aria-label="Дистанция">
          <button class="unit-btn" type="button" data-action="toggle-unit" aria-label="Сменить единицу: км или метры">${UNIT_LABEL[distanceUnit()]}</button>
          <button class="add-btn" type="submit" aria-label="Добавить отрезок">${icon('plus', 18)}</button>
        </form>
      </div>
    </div>

    <p class="error" id="w-error" hidden></p>
    <button class="btn btn-yes btn-save" data-action="save-water">Сохранить</button>`;
  updateWater();
}

// Обновляет только итог, темп и список отрезков, чтобы поля ввода не теряли фокус.
// Темп на 500 м = время / (метры / 500). Считаем его, только если у всех отрезков есть дистанция,
// иначе часть времени придётся на неизвестные метры и темп выйдет неправильным
function updateWater() {
  const w = state.water;
  const meters = w.segments.reduce((sum, s) => sum + s.reps * s.meters, 0);
  const seconds = parseTime(w.time);
  const allHaveDistance = w.segments.every((s) => s.meters > 0);

  const total = $('#w-total');
  const newTotal = formatKm(meters);
  if (total.textContent !== newTotal && total.textContent !== '0') replay(total, 'pulse');
  total.textContent = newTotal;
  $('#w-pace').textContent = seconds && meters && allHaveDistance ? formatTime(Math.round(seconds / (meters / 500))) : '—';

  $('#w-list').innerHTML = w.segments.length
    ? w.segments.map((s, i) => `
        <div class="seg ${i === w.justAdded ? 'row-in' : ''}">
          <span>${escapeHtml(segmentTitle(s))}</span>
          <span class="seg-right">${segmentTotal(s)}
            <button class="icon-x" data-action="remove-seg" data-index="${i}" aria-label="Удалить отрезок">${icon('close', 16)}</button>
          </span>
        </div>`).join('')
    : '<p class="empty">Добавь отрезки: повторы × дистанция или время</p>';
  w.justAdded = null;
}

function waterError(text) {
  const el = $('#w-error');
  el.textContent = text;
  el.hidden = !text;
}

// Отрезок хранится массивом: [название, повторы, метры], а у отрезка по времени
// в конце ещё секунды. Так старые записи читаются без изменений
async function saveWater() {
  const w = state.water;
  if (w.segments.length === 0) return waterError('Добавь хотя бы один отрезок.');

  const seconds = w.time.trim() ? parseTime(w.time) : null;
  if (w.time.trim() && !seconds) return waterError('Время в формате мм:сс или ч:мм:сс, например 58:40.');

  const rec = {
    t: 'w',
    g: w.segments.map((s) => (s.seconds ? [s.name, s.reps, s.meters, s.seconds] : [s.name, s.reps, s.meters])),
  };
  if (seconds) rec.s = seconds;

  await setRecord(w.date, rec);
  haptic();
  state.flash = toISO(w.date);
  back();
}

const RENDERERS = {
  welcome: renderWelcome, today: renderToday, calendar: renderCalendar,
  stats: renderStats, day: renderDay, water: renderWater,
};

let shownView = null;
let enterTimer;

// Анимация входа на экран. Класс снимаем после анимации, иначе она повторится при следующей перерисовке
function playEnter(el) {
  const cls = `enter-${state.nav}`;
  el.classList.remove('enter-tab', 'enter-push', 'enter-pop');
  void el.offsetWidth;
  el.classList.add(cls);
  clearTimeout(enterTimer);
  enterTimer = setTimeout(() => el.classList.remove(cls), 700);
}

// Главная отрисовка: рисует текущий экран из state. Анимация входа — только при смене экрана
function render() {
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== state.view;
  const isTab = TABS.includes(state.view);
  $('#tabbar').classList.toggle('away', !isTab);
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('on', tab.dataset.tab === state.view));

  const el = $(`#view-${state.view}`);
  RENDERERS[state.view](el);

  if (shownView !== state.view) playEnter(el);
  shownView = state.view;
  state.flash = null;

  if (tg?.isVersionAtLeast?.('6.1')) {
    const needBack = !isTab && state.history.length > 0;
    needBack ? tg.BackButton.show() : tg.BackButton.hide();
  }
}

const actions = {
  back,
  'edit-name': () => go('welcome'),
  'pick-type': (btn) => {
    if (btn.classList.contains('on')) return;
    state.pickedType = btn.dataset.type;
    moveSegment(btn);
    tick();
  },
  answer: async (btn) => {
    const date = markDate();
    const yes = btn.dataset.yes === '1';
    const type = selectedType(date);

    if (yes && type === 'w') return openWater(date);

    await setRecord(date, { t: yes ? 'g' : 'x' });
    haptic();
    resetMark();
    state.flash = toISO(date);
    render();
  },
  'edit-mark': () => {
    state.editing = true;
    state.flash = 'edit';
    render();
  },
  'delete-mark': async () => {
    const date = markDate();
    await setRecord(date, null);
    resetMark();
    state.flash = toISO(date);
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
    const step = Number(btn.dataset.step);
    const m = state.calMonth;
    state.calMonth = new Date(m.getFullYear(), m.getMonth() + step, 1);
    state.flash = step > 0 ? 'cal-next' : 'cal-prev';
    render();
    tick();
  },
  period: (btn) => {
    if (btn.classList.contains('on')) return;
    state.statsPeriod = btn.dataset.period;
    moveSegment(btn);
    const cards = $('#stat-cards');
    cards.innerHTML = statCards();
    replay(cards, 'swap');
    tick();
  },
  // Сначала строка уезжает, потом удаляем её из данных. Ищем по самому объекту, а не по номеру:
  // при быстром удалении нескольких строк номера сдвигаются
  'remove-seg': (btn) => {
    const row = btn.closest('.seg');
    if (row.classList.contains('row-out')) return;
    const segment = state.water.segments[Number(btn.dataset.index)];
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      const index = state.water.segments.indexOf(segment);
      if (index !== -1) state.water.segments.splice(index, 1);
      updateWater();
    };
    row.classList.add('row-out');
    row.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 300);
  },
  'save-water': saveWater,
  'toggle-unit': async (btn) => {
    const unit = distanceUnit() === 'km' ? 'm' : 'km';
    const profile = { ...state.profile, unit };
    state.profile = profile;
    btn.textContent = UNIT_LABEL[unit];
    replay(btn, 'pulse');
    tick();
    $('#seg-form').distance.placeholder = distancePlaceholder();
    await save(PROFILE_KEY, profile);
  },
  // Поля формы меняются через класс, без перерисовки: уже введённое не сбрасывается
  'seg-mode': async (btn) => {
    if (btn.classList.contains('on')) return;
    const profile = { ...state.profile, segMode: btn.dataset.mode };
    state.profile = profile;
    moveSegment(btn);
    const form = $('#seg-form');
    form.classList.toggle('time', profile.segMode === 'time');
    form.distance.placeholder = distancePlaceholder();
    waterError('');
    tick();
    await save(PROFILE_KEY, profile);
  },
};

// Один обработчик кликов на весь документ (делегирование): кнопки перерисовываются, а он остаётся
document.addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-action], [data-tab]');
  if (!btn || btn.disabled) return;
  if (btn.dataset.tab) {
    if (btn.dataset.tab !== state.view) tick();
    return switchTab(btn.dataset.tab);
  }

  try {
    await actions[btn.dataset.action]?.(btn);
  } catch (error) {
    showToast(error.message || 'Не удалось сохранить');
  }
});

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;

  if (form.id === 'name-form') {
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

  if (form.id === 'seg-form') {
    const isTime = segMode() === 'time';
    const reps = Number(form.reps.value);
    const timeField = form.elements.namedItem('seg-time');
    const seconds = isTime ? parseTime(timeField.value) : 0;
    const distanceText = form.distance.value.trim();
    const meters = isTime && !distanceText ? 0 : parseDistance(distanceText, distanceUnit());

    if (!Number.isInteger(reps) || reps < 1) return waterError('Укажи количество повторов: 1 или больше.');
    if (isTime && !seconds) return waterError('Время отрезка в формате мм:сс, например 10:00 или 0:30.');
    if (meters === null) {
      return waterError(distanceUnit() === 'km'
        ? 'Укажи дистанцию в километрах, например 2 или 0,5.'
        : 'Укажи дистанцию в метрах, например 500.');
    }
    waterError('');
    state.water.segments.push({ name: form.elements.namedItem('name').value.trim(), reps, meters, seconds });
    state.water.justAdded = state.water.segments.length - 1;
    form.reset();
    updateWater();
    (isTime ? timeField : form.distance).focus();
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'w-time') {
    state.water.time = event.target.value;
    updateWater();
  }
});

// Запуск: настройка Telegram, загрузка данных, при первом запуске — экран с вопросом об имени
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

  state.view = state.profile?.name ? 'today' : 'welcome';
  render();
}

init();
