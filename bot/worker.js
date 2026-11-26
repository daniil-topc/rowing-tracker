const APP_URL = 'https://daniil-topc.github.io/rowing-tracker/';

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
  // Telegram присылает сюда каждое сообщение (webhook). Отвечаем JSON с method: 'sendMessage',
  // и сообщение отправляет сам Telegram. Поэтому токен в коде не нужен
  async fetch(request) {
    if (request.method !== 'POST') return new Response('Бот работает');

    const update = await request.json().catch(() => null);
    const msg = update?.message;

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
