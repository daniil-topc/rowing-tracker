// Работа с датами и форматированием. Без побочных эффектов — только чистые функции.

export const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MONTHS_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const WEEKDAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
export const WD_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// Сегодня без часов и минут — чтобы сравнивать только даты
export function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export const sameDay = (a, b) => a.getTime() === b.getTime();

// getDay(): 0 = воскресенье. Нам нужна неделя с понедельника: Пн = 0 ... Вс = 6
export const mondayIndex = (date) => (date.getDay() + 6) % 7;

// Ключ месяца для хранилища: "2026-10"
export const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

// Дата <-> строка "2026-10-14" (для data-атрибутов в разметке)
export const toISO = (d) => `${monthKey(d)}-${String(d.getDate()).padStart(2, '0')}`;
export function fromISO(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// "Вторник, 24 ноября"
export const formatLong = (d) => `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;

export const capitalize = (s) => s[0].toUpperCase() + s.slice(1);

// "58:40" или "1:05:30" -> секунды. Неправильный формат -> null
export function parseTime(str) {
  const parts = str.trim().split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d{1,2}$/.test(p))) return null;
  const nums = parts.map(Number);
  const [h, m, s] = nums.length === 3 ? nums : [0, ...nums];
  if (m > 59 || s > 59) return null;
  const total = h * 3600 + m * 60 + s;
  return total > 0 ? total : null;
}

// секунды -> "58:40" или "1:05:30"
export function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// метры -> "11", "11,5" или "1,25" (км). Лишние нули в конце убираем
export function formatKm(meters) {
  const km = meters / 1000;
  return Number.isInteger(km) ? String(km) : km.toFixed(2).replace(/0+$/, '').replace('.', ',');
}

// Дистанция отрезка: до километра — в метрах, дальше — в километрах. 500 -> "500 м", 2000 -> "2 км"
export const formatDistance = (meters) => (meters < 1000 ? `${meters} м` : `${formatKm(meters)} км`);

// Ввод пользователя -> метры. Понимает запятую: "0,5" км -> 500. Ошибка -> null
export function parseDistance(value, unit) {
  const num = Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0) return null;
  const meters = Math.round(unit === 'km' ? num * 1000 : num);
  return meters > 0 && meters <= 100000 ? meters : null;
}

// Русские окончания: 1 тренировка, 2 тренировки, 5 тренировок
export function plural(n, [one, few, many]) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}
