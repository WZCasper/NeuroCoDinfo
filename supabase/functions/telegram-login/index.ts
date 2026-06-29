// supabase/functions/telegram-login/index.ts
//
// Edge Function для входа через Telegram (Этап 4).
//
// Зачем это нужно отдельной функцией, а не прямо в браузере: проверка
// подписи Telegram ОБЯЗАТЕЛЬНО требует токен бота как секретный ключ.
// Токен бота нельзя класть в браузерный JS (его увидит кто угодно и сможет
// подделывать чужие входы) — поэтому проверка происходит здесь, на сервере
// Supabase, где токен лежит как секрет Edge Function, а не как обычный
// бот пишет update'ы.
//
// Эта функция НЕ использует Supabase SDK и не пишет в базу — она получает
// данные от виджета Telegram Login, проверяет подлинность подписи и просто
// возвращает подтверждённые данные пользователя обратно в браузер. Дальше
// браузер сам сохраняет эти данные как свою "подтверждённую личность"
// (см. js/auth.js и getDeviceId() в js/supabase-client.js).
//
// ЧЕСТНО О ГРАНИЦАХ: это не превращает посетителя в полноценного
// авторизованного пользователя Supabase Auth (auth.uid() тут не участвует).
// RLS-политики в supabase/schema.sql остаются такими же открытыми, как и для
// анонимных посетителей. Что меняется — у вошедшего через Telegram появляется
// СТАБИЛЬНЫЙ идентификатор (telegram_id), который не пропадёт при очистке
// localStorage или смене браузера на телефоне с тем же Telegram-аккаунтом
// (после повторного входа), плюс настоящее имя и аватар вместо "Гостя".
// Полная привязка к auth.uid() и более строгие RLS-политики — это следующий,
// более сложный шаг, который стоит делать отдельно и тестировать на реальном
// проекте (в README есть пометка об этом).

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, x-client-info, apikey'
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}

async function hmacSha256Hex(keyBytes: ArrayBuffer, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toHex(sig);
}

// Алгоритм — ровно такой, как описан в официальной документации Telegram
// (core.telegram.org/widgets/login, раздел "Checking authorization").
async function verifyTelegramAuth(payload: Record<string, unknown>, botToken: string): Promise<boolean> {
  const { hash, ...fields } = payload;
  if (typeof hash !== 'string' || !hash) return false;

  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');

  const secretKey = await sha256(botToken);
  const expectedHex = await hmacSha256Hex(secretKey, dataCheckString);
  return expectedHex === hash;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Метод не поддерживается' }, 405);

  if (!BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN не задан в секретах Edge Function');
    return jsonResponse({ error: 'Вход через Telegram временно не настроен на сервере' }, 500);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'Некорректный запрос' }, 400);
  }

  const ok = await verifyTelegramAuth(payload, BOT_TOKEN);
  if (!ok) {
    return jsonResponse({ error: 'Подпись Telegram не прошла проверку' }, 401);
  }

  // Защита от повторного использования старых данных (replay): отклоняем
  // авторизацию старше суток, как и рекомендует документация Telegram.
  const authDate = Number(payload.auth_date);
  const ageSeconds = Date.now() / 1000 - authDate;
  if (!authDate || ageSeconds > 86400 || ageSeconds < -60) {
    return jsonResponse({ error: 'Данные авторизации устарели, попробуйте войти ещё раз' }, 401);
  }

  const profile = {
    id: String(payload.id ?? ''),
    firstName: String(payload.first_name ?? ''),
    lastName: String(payload.last_name ?? ''),
    username: String(payload.username ?? ''),
    photoUrl: String(payload.photo_url ?? '')
  };

  if (!profile.id) return jsonResponse({ error: 'В данных авторизации нет id пользователя' }, 400);

  return jsonResponse({ ok: true, profile });
});
