// Хранилище данных.
// В Telegram — CloudStorage: у каждого пользователя своё, синхронизируется между устройствами.
// В обычном браузере (когда разрабатываем) — localStorage.
// Остальной код не знает, какое хранилище работает: он вызывает только loadAll / save.

const tg = window.Telegram?.WebApp;

// initData пустой, если страница открыта не из Telegram
const useCloud = Boolean(tg?.initData && tg.isVersionAtLeast?.('6.9'));

const LOCAL_PREFIX = 'rt_';
const MAX_VALUE_LENGTH = 4096; // лимит Telegram на одно значение

// CloudStorage работает через колбэки. Оборачиваем в Promise, чтобы писать await
function cloud(method, ...args) {
  return new Promise((resolve, reject) => {
    tg.CloudStorage[method](...args, (error, result) => (error ? reject(new Error(error)) : resolve(result)));
  });
}

function parse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Загружает всё сразу: { "profile": {...}, "2026-10": {...}, ... }
export async function loadAll() {
  const result = {};

  if (useCloud) {
    const keys = await cloud('getKeys');
    if (keys.length === 0) return result;
    const values = await cloud('getItems', keys);
    for (const key of keys) result[key] = parse(values[key]);
    return result;
  }

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith(LOCAL_PREFIX)) {
      result[key.slice(LOCAL_PREFIX.length)] = parse(localStorage.getItem(key));
    }
  }
  return result;
}

// Сохраняет значение по ключу. null или пустой объект — удаляет ключ
export async function save(key, data) {
  const isEmpty = data === null || Object.keys(data).length === 0;

  if (isEmpty) {
    if (useCloud) await cloud('removeItem', key);
    else localStorage.removeItem(LOCAL_PREFIX + key);
    return;
  }

  const value = JSON.stringify(data);
  if (value.length > MAX_VALUE_LENGTH) {
    throw new Error('Слишком много данных за месяц. Попробуй сократить названия отрезков.');
  }

  if (useCloud) await cloud('setItem', key, value);
  else localStorage.setItem(LOCAL_PREFIX + key, value);
}

export const storageName = useCloud ? 'Telegram CloudStorage' : 'localStorage';
