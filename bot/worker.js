// Мини-бот для Cloudflare Workers.
// На /start присылает приветствие и кнопку, которая открывает Mini App.
//
// Как это работает без токена в коде:
// Telegram сам присылает каждое сообщение боту сюда (webhook, POST-запрос с JSON).
// В ответ на этот запрос можно вернуть JSON с полем method, и Telegram сам выполнит
// это действие (здесь sendMessage). Поэтому воркер ничего не отправляет в Telegram сам,
// а значит, ему не нужен токен. Токен нужен только один раз, чтобы подключить webhook.

const APP_URL = 'https://daniil-topc.github.io/rowing-tracker/';

// Кнопка под сообщением. Поле web_app открывает Mini App прямо внутри Telegram
// (такие кнопки работают только в личном чате с ботом).
const openButton = {
  inline_keyboard: [[{ text: 'Открыть трекер', web_app: { url: APP_URL } }]],
};

function welcomeText(name) {
  const hello = name ? `Привет, ${name}! 🚣` : 'Привет! 🚣';
  return [
    hello,
    '',
    'Это трекер тренировок по гребле.',
    'Отмечай тренировки на воде и в зале, считай километры и держи серию.',
    '',
    'Жми кнопку ниже, чтобы открыть приложение.',
  ].join('\n');
}

const HINT_TEXT = 'Все тренировки ведутся в приложении. Открыть его можно кнопкой ниже.';

export default {
  async fetch(request) {
    // Если открыть адрес воркера в браузере (GET), просто покажем, что он жив
    if (request.method !== 'POST') return new Response('Бот работает');

    // Битый JSON не должен ронять воркер
    const update = await request.json().catch(() => null);
    const msg = update?.message;

    // Отвечаем только на сообщения в личке. На всё остальное (группы, правки сообщений и т.д.)
    // просто говорим Telegram «принято», иначе он будет присылать это обновление повторно
    if (!msg || msg.chat?.type !== 'private') return new Response('ok');

    const isStart = msg.text?.startsWith('/start');

    return Response.json({
      method: 'sendMessage',
      chat_id: msg.chat.id,
      text: isStart ? welcomeText(msg.from?.first_name) : HINT_TEXT,
      reply_markup: openButton,
    });
  },
};
