/*
  telegram-bot.mjs — Этап 6.

  Делает по расписанию (через GitHub Actions) две вещи:
  1. Узнаёт, в какие группы/каналы бота добавили или из каких удалили —
     через метод getUpdates и событие my_chat_member. Это событие приходит
     независимо от «режима приватности» бота, поэтому отслеживание работает
     надёжно даже без прав на чтение обычных сообщений группы.
  2. Рассылает в эти группы/каналы новые статьи из data/posts.json, которые
     ещё не публиковались.

  ЧЕСТНО ОБ ОГРАНИЧЕНИИ: это НЕ постоянно работающий сервер с вебхуком,
  который реагирует мгновенно. Это бот, который «просыпается» по расписанию
  (по умолчанию каждые 15 минут — см. .github/workflows/telegram-broadcast.yml).
  Для новостного агрегатора такая задержка не критична — это осознанный выбор,
  чтобы не требовать платный постоянно работающий сервер.

  ЕСЛИ ВИДИТЕ ОШИБКУ ПРО "webhook is active": значит для этого бота где-то
  ранее был настроен вебхук. Самое простое — открыть в браузере
  https://api.telegram.org/bot<ВАШ_ТОКЕН>/deleteWebhook один раз и повторить запуск.
*/

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTS_PATH = path.join(__dirname, '..', 'data', 'posts.json');
const STATE_PATH = path.join(__dirname, '..', 'data', 'telegram-state.json');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const MAX_BROADCAST_PER_RUN = 5;

function siteUrl() {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, '') + '/';
  const repo = process.env.GITHUB_REPOSITORY; // формат "owner/repo"
  if (repo) {
    const [owner, name] = repo.split('/');
    return `https://${owner}.github.io/${name}/`;
  }
  return 'https://example.github.io/neurocodinfo/';
}

async function loadJSON(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

async function saveJSON(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

async function callApi(method, params = {}) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description || 'неизвестная ошибка Telegram API'}`);
  return data.result;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function discoverChats(state) {
  const updates = await callApi('getUpdates', {
    offset: state.lastUpdateId + 1,
    timeout: 0,
    allowed_updates: ['my_chat_member']
  });

  for (const update of updates) {
    state.lastUpdateId = Math.max(state.lastUpdateId, update.update_id);
    const mcm = update.my_chat_member;
    if (!mcm) continue;

    const chat = mcm.chat;
    const newStatus = mcm.new_chat_member?.status;
    const existingIdx = state.chats.findIndex((c) => c.id === chat.id);

    if (newStatus === 'left' || newStatus === 'kicked') {
      if (existingIdx !== -1) {
        console.log(`Бота убрали из «${state.chats[existingIdx].title}» — удаляю из списка рассылки`);
        state.chats.splice(existingIdx, 1);
      }
      continue;
    }

    const entry = { id: chat.id, title: chat.title || chat.username || String(chat.id), type: chat.type };
    if (existingIdx === -1) {
      console.log(`Бота добавили в «${entry.title}» (${entry.type}) — добавляю в список рассылки`);
      state.chats.push(entry);
    } else {
      state.chats[existingIdx] = entry;
    }
  }
}

function formatMessage(post, base) {
  const url = `${base}post.html?id=${encodeURIComponent(post.id)}`;
  return `<b>${escapeHtml(post.title)}</b>\n\n${escapeHtml(post.excerpt)}\n\n${url}`;
}

async function broadcastNewPosts(state) {
  if (state.chats.length === 0) {
    console.log('Бот пока ни в одной группе/канале — рассылать некуда.');
    return;
  }

  const posts = await loadJSON(POSTS_PATH, []);
  const postedIds = new Set(state.postedPostIds);
  const newPosts = posts.filter((p) => !p.isDemo && !postedIds.has(p.id));
  newPosts.sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
  const toSend = newPosts.slice(0, MAX_BROADCAST_PER_RUN);

  if (toSend.length === 0) {
    console.log('Новых статей для рассылки нет.');
    return;
  }

  const base = siteUrl();
  for (const post of toSend) {
    const text = formatMessage(post, base);
    for (const chat of state.chats) {
      try {
        await callApi('sendMessage', { chat_id: chat.id, text, parse_mode: 'HTML' });
        console.log(`  → отправлено в «${chat.title}»: ${post.title}`);
      } catch (e) {
        console.error(`  ✗ не удалось отправить в «${chat.title}»: ${e.message}`);
      }
    }
    state.postedPostIds.push(post.id);
  }

  // не даём списку «уже отправленных» расти бесконечно
  if (state.postedPostIds.length > 500) {
    state.postedPostIds = state.postedPostIds.slice(-500);
  }
}

async function main() {
  if (!BOT_TOKEN) {
    console.log(
      'TELEGRAM_BOT_TOKEN не задан в секретах репозитория — пропускаю запуск. См. README, раздел про Этап 6.'
    );
    return;
  }

  const state = await loadJSON(STATE_PATH, { lastUpdateId: 0, chats: [], postedPostIds: [] });

  try {
    await discoverChats(state);
  } catch (e) {
    console.error('Не удалось обновить список чатов:', e.message);
    console.error('Рассылка по уже известным чатам продолжится в любом случае.');
  }

  await broadcastNewPosts(state);
  await saveJSON(STATE_PATH, state);

  console.log(`Готово. Сейчас бот состоит в ${state.chats.length} группах/каналах.`);
}

main().catch((e) => {
  console.error('Бот завершился с ошибкой:', e);
  process.exit(1);
});
