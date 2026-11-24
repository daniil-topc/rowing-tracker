// Подсчёты: серии, посещаемость, километры.
//
// Формат данных (db) — объект по месяцам:
// {
//   "2026-10": {
//     "14": { t: "w", s: 3520, g: [["Разминка", 1, 3000], ["", 4, 500]] },  // вода: время (сек) и отрезки [название, повторы, метры]
//     "15": { t: "g" },                                                      // зал
//     "16": { t: "x" }                                                       // пропуск (ответил «Нет»)
//   }
// }
// Дни без записи — выходные или просто не отмечены. Они не считаются пропуском.

import { monthKey, MONTHS_SHORT } from './dates.js';

export const isDone = (rec) => rec.t === 'w' || rec.t === 'g';

export function getRecord(db, date) {
  return db[monthKey(date)]?.[date.getDate()] ?? null;
}

// Сумма всех отрезков в метрах
export function recordMeters(rec) {
  return (rec.g || []).reduce((sum, [, reps, meters]) => sum + reps * meters, 0);
}

// Все записи между датами (включительно), отсортированные по дате
export function recordsBetween(db, from, to) {
  const list = [];
  for (const [key, days] of Object.entries(db)) {
    const [y, m] = key.split('-').map(Number);
    for (const [day, rec] of Object.entries(days)) {
      const date = new Date(y, m - 1, Number(day));
      if (date >= from && date <= to) list.push({ date, rec });
    }
  }
  return list.sort((a, b) => a.date - b.date);
}

const EPOCH = new Date(2000, 0, 1);

// Текущая серия: идём от последней отметки назад и считаем тренировки, пока не встретим пропуск
export function currentStreak(db, until) {
  const list = recordsBetween(db, EPOCH, until).reverse();
  let count = 0;
  for (const { rec } of list) {
    if (!isDone(rec)) break;
    count++;
  }
  return count;
}

// Лучшая серия за всё время
export function bestStreak(db, until) {
  let best = 0;
  let current = 0;
  for (const { rec } of recordsBetween(db, EPOCH, until)) {
    current = isDone(rec) ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}

// Сводка за период
export function summarize(list) {
  const result = { done: 0, missed: 0, water: 0, gym: 0, waterMeters: 0, rate: null };
  for (const { rec } of list) {
    if (rec.t === 'w') {
      result.water++;
      result.waterMeters += recordMeters(rec);
    } else if (rec.t === 'g') {
      result.gym++;
    } else {
      result.missed++;
    }
  }
  result.done = result.water + result.gym;
  const marked = result.done + result.missed;
  if (marked > 0) result.rate = Math.round((result.done / marked) * 100);
  return result;
}

// Километры на воде за последние n месяцев: [{ label: "Июл", meters: 175000 }, ...]
export function metersByMonth(db, until, n = 7) {
  const result = [];
  for (let i = n - 1; i >= 0; i--) {
    const month = new Date(until.getFullYear(), until.getMonth() - i, 1);
    const days = db[monthKey(month)] || {};
    const meters = Object.values(days)
      .filter((rec) => rec.t === 'w')
      .reduce((sum, rec) => sum + recordMeters(rec), 0);
    result.push({ label: MONTHS_SHORT[month.getMonth()], meters });
  }
  return result;
}

// Сезон: по последней отмеченной тренировке. Если отметок нет — по месяцу (апрель–октябрь — вода)
export function detectSeason(db, until) {
  const lastTraining = recordsBetween(db, EPOCH, until).reverse().find(({ rec }) => isDone(rec));
  if (lastTraining) return lastTraining.rec.t;
  const month = until.getMonth();
  return month >= 3 && month <= 9 ? 'w' : 'g';
}
