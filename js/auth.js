/*
  auth.js — вход через Telegram (Этап 4).

  Почему только Telegram, а не «вход через Activision»: у Activision НЕТ
  публичного OAuth-провайдера для сторонних сайтов (это проверено) — есть
  только программа «approved partners/licensees» для крупных компаний,
  а не самостоятельная регистрация приложения, как у VK/Google/Telegram.
  Подделывать страницу входа Activision и просить пользователей вводить туда
  пароль от настоящего аккаунта — недопустимо и опасно для самих игроков,
  поэтому это не реализовано даже как "заглушка". Activision ID на сайте —
  это поле в анкете (profile.html), которое игрок указывает сам, без проверки.

  Как работает вход через Telegram:
  1. Виджет Telegram (telegram-widget.js) показывает кнопку и сам общается
     с серверами Telegram — никаких паролей через наш сайт не передаётся.
  2. После подтверждения Telegram вызывает handleTelegramAuth(user) с данными
     пользователя и подписью (hash).
  3. Мы отправляем эти данные в Supabase Edge Function telegram-login, которая
     проверяет подпись с помощью секретного токена бота (этот токен никогда
     не попадает в браузер) и возвращает подтверждённые данные.
  4. Подтверждённые данные сохраняются в localStorage и используются как
     устойчивая личность для анкеты, лайков и комментариев — подробности
     в js/supabase-client.js (см. getDeviceId) и README.
*/

const TELEGRAM_USER_KEY = 'ncdi_telegram_user';

function getStoredTelegramUser() {
  try {
    const raw = localStorage.getItem(TELEGRAM_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function supabaseIsConfigured() {
  return Boolean(
    typeof SITE_CONFIG !== 'undefined' &&
    SITE_CONFIG.supabaseUrl &&
    !SITE_CONFIG.supabaseUrl.includes('ВАШ_ПРОЕКТ')
  );
}

function renderAuthArea() {
  const area = document.getElementById('auth-area');
  if (!area) return;

  const user = getStoredTelegramUser();

  if (user) {
    area.innerHTML = `
      <div class="auth-chip">
        ${user.photoUrl
          ? `<img class="auth-avatar" src="${user.photoUrl}" alt="">`
          : `<span class="auth-avatar auth-avatar-fallback">${(user.firstName || 'T').slice(0, 1).toUpperCase()}</span>`}
        <span class="auth-name">${user.firstName || 'Игрок'}</span>
        <button class="text-btn" id="auth-logout" type="button">Выйти</button>
      </div>
    `;
    document.getElementById('auth-logout').addEventListener('click', logoutTelegram);
    return;
  }

  if (!supabaseIsConfigured()) {
    area.innerHTML = `<span class="auth-pending">Вход через Telegram появится после настройки backend</span>`;
    return;
  }

  area.innerHTML = '<span id="telegram-login-slot"></span>';
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://telegram.org/js/telegram-widget.js?22';
  script.setAttribute('data-telegram-login', SITE_CONFIG.telegramBotUsername);
  script.setAttribute('data-size', 'medium');
  script.setAttribute('data-radius', '8');
  script.setAttribute('data-userpic', 'false');
  script.setAttribute('data-onauth', 'handleTelegramAuth(user)');
  document.getElementById('telegram-login-slot').appendChild(script);
}

async function handleTelegramAuth(user) {
  if (!supabaseIsConfigured()) {
    showToast('Вход через Telegram появится после настройки Supabase (Этап 3)');
    return;
  }

  try {
    const res = await fetch(`${SITE_CONFIG.supabaseUrl}/functions/v1/telegram-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user)
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      console.error('Telegram login: проверка не пройдена', data.error);
      showToast(data.error || 'Не удалось подтвердить вход через Telegram');
      return;
    }

    const profile = data.profile;
    localStorage.setItem(TELEGRAM_USER_KEY, JSON.stringify(profile));

    const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
    Store.setProfile({
      name: fullName || Store.getProfile().name,
      photoUrl: profile.photoUrl || '',
      telegramUsername: profile.username || ''
    });

    showToast(`Вы вошли как ${profile.firstName}`);
    renderAuthArea();
  } catch (e) {
    console.error('Telegram login: ошибка запроса', e);
    showToast('Не получилось связаться с сервером входа. Попробуйте позже.');
  }
}

function logoutTelegram() {
  localStorage.removeItem(TELEGRAM_USER_KEY);
  showToast('Вы вышли из аккаунта Telegram');
  renderAuthArea();
}

renderAuthArea();
