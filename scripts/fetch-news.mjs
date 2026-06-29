/*
  fetch-news.mjs — собирает новые статьи с официального блога Call of Duty
  (callofduty.com/blog), переводит короткое описание на русский и дописывает
  их в data/posts.json. Запускается по расписанию через GitHub Actions
  (см. .github/workflows/fetch-news.yml).

  ЧЕСТНО О ГРАНИЦАХ ЭТОГО СКРИПТА:

  1. У callofduty.com/blog нет официального RSS/API — это проверено вручную.
     Поэтому скрипт не «подписывается» на ленту, а аккуратно разбирает HTML
     страницы блога (она отдаётся сервером с уже готовой разметкой, без
     обязательного выполнения JavaScript — это тоже проверено). Если Activision
     поменяет структуру страницы, разбор может перестать находить статьи —
     тогда нужно открыть лог запуска в GitHub Actions и поправить селекторы
     в функции getCandidateLinks().

  2. Сайт Call of Duty League (callofdutyleague.com) отдаёт почти пустой HTML
     и подгружает новости через JavaScript — для него такой простой разбор
     не работает, нужен headless-браузер (Playwright/Puppeteer). Это
     осознанно НЕ реализовано в Этапе 2 — раздел «Эспорт» из автопайплайна
     пока исключён.

  3. Публикуются короткие переводы метаописаний статей (1-2 предложения) +
     ссылка на первоисточник — НЕ полный текст статей. Это сделано
     специально, по соображениям авторского права.

  4. Скрипт уважительно относится к источнику: представляется отдельным
     User-Agent, не запрашивает больше MAX_NEW_PER_RUN новых статей за один
     запуск и делает паузу между запросами. Перед использованием в продакшене
     стоит дополнительно сверить правила в /robots.txt сайта-источника.
*/

import * as cheerio from 'cheerio';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POSTS_PATH = path.join(__dirname, '..', 'data', 'posts.json');

const BLOG_INDEX_URL = 'https://www.callofduty.com/blog';
const MAX_NEW_PER_RUN = 8;
const REQUEST_DELAY_MS = 600;
const USER_AGENT = 'NeuroCoDinfoBot/1.0 (+https://github.com/; новостной агрегатор-переводчик)';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} при загрузке ${url}`);
  return res.text();
}

// Категоризация по URL и ключевым словам в адресе статьи.
function categorize(urlPath) {
  const slug = urlPath.toLowerCase();
  if (slug.startsWith('/patchnotes/')) return 'Патчноуты';
  if (/ricochet|anti-cheat/.test(slug)) return 'Патчноуты';
  if (/battle-pass|blackcell|bundle/.test(slug)) return 'Скидки';
  return 'Новости';
}

// /blog/2026/05/slug -> дата начала месяца публикации (точный день из URL не виден)
function dateFromPath(urlPath) {
  const m = urlPath.match(/\/(\d{4})\/(\d{2})\//);
  if (!m) return new Date().toISOString();
  return new Date(`${m[1]}-${m[2]}-01T12:00:00Z`).toISOString();
}

// Стабильный id на основе URL — не меняется между запусками, поэтому лайки
// и комментарии, привязанные к посту, не «отрываются» при повторной сборке.
function stableId(url) {
  const p = new URL(url).pathname.replace(/^\/+|\/+$/g, '');
  return 'src-' + p.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

async function getCandidateLinks() {
  const html = await fetchHtml(BLOG_INDEX_URL);
  const $ = cheerio.load(html);
  const found = new Map();

  $('a[href^="/blog/"], a[href^="/patchnotes/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || !/^\/(blog|patchnotes)\/\d{4}\/\d{2}\//.test(href)) return;

    const title =
      $(el).text().trim() ||
      $(el).find('img').attr('alt') ||
      $(el).attr('aria-label') ||
      '';
    if (!title) return;

    if (!found.has(href)) found.set(href, title.trim());
  });

  return [...found.entries()].map(([href, title]) => ({
    path: href,
    url: new URL(href, 'https://www.callofduty.com').toString(),
    title
  }));
}

async function getArticleDescription(url) {
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    const description =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      '';
    return description.trim();
  } catch (e) {
    console.error(`  не удалось получить описание для ${url}: ${e.message}`);
    return '';
  }
}

// Если переменная DEEPL_API_KEY не задана — текст остаётся на языке оригинала
// (английском), сайт при этом продолжает работать, просто без перевода.
async function translateToRussian(text) {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey || !text) return text;

  // По умолчанию — бесплатный эндпоинт DeepL. Если у вас платный план,
  // замените api-free.deepl.com на api.deepl.com.
  const endpoint = process.env.DEEPL_API_URL || 'https://api-free.deepl.com/v2/translate';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ text, target_lang: 'RU' })
    });
    if (!res.ok) throw new Error(`DeepL HTTP ${res.status}`);
    const data = await res.json();
    return data.translations?.[0]?.text || text;
  } catch (e) {
    console.error(`  перевод не выполнен (${e.message}), оставляю оригинал`);
    return text;
  }
}

async function loadExistingPosts() {
  try {
    const raw = await fs.readFile(POSTS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('Не удалось прочитать data/posts.json, начинаю с пустого списка:', e.message);
    return [];
  }
}

async function main() {
  console.log('Загружаю список статей с', BLOG_INDEX_URL);
  const existing = await loadExistingPosts();
  const existingIds = new Set(existing.map((p) => p.id));

  const candidates = await getCandidateLinks();
  console.log(`Найдено ссылок на странице: ${candidates.length}`);

  const fresh = candidates.filter((c) => !existingIds.has(stableId(c.url)));
  const toProcess = fresh.slice(0, MAX_NEW_PER_RUN);
  console.log(`Новых (ещё не в posts.json): ${fresh.length}, обрабатываю в этом запуске: ${toProcess.length}`);

  const newPosts = [];
  for (const item of toProcess) {
    console.log('→', item.url);
    const rawDescription = await getArticleDescription(item.url);
    await sleep(REQUEST_DELAY_MS);

    const titleRu = await translateToRussian(item.title);
    const descriptionRu = await translateToRussian(rawDescription || item.title);

    newPosts.push({
      id: stableId(item.url),
      isDemo: false,
      pinned: false,
      category: categorize(item.path),
      title: titleRu,
      excerpt: descriptionRu,
      body: [
        descriptionRu,
        'Это краткий автоматический перевод заголовка и описания статьи. Полный текст — по ссылке на первоисточник ниже.'
      ],
      source: { name: 'callofduty.com', url: item.url },
      publishedAt: dateFromPath(item.path),
      likes: 0,
      dislikes: 0
    });
  }

  if (newPosts.length === 0) {
    console.log('Новых статей не найдено — data/posts.json не изменяется.');
    return;
  }

  // Демо-заглушки (isDemo: true) убираются из ленты при первом успешном
  // реальном запуске пайплайна. Реальные посты из прошлых запусков остаются.
  const combined = [...newPosts, ...existing.filter((p) => !p.isDemo)];

  // Три самых новых поста автоматически становятся «закреплёнными» —
  // это и есть требование «последние новости закреплены в шапке».
  combined.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  combined.forEach((p, i) => { p.pinned = i < 3; });

  await fs.writeFile(POSTS_PATH, JSON.stringify(combined, null, 2) + '\n', 'utf-8');
  console.log(`Готово. Добавлено новых статей: ${newPosts.length}. Всего в ленте: ${combined.length}.`);
}

main().catch((e) => {
  console.error('Пайплайн завершился с ошибкой:', e);
  process.exit(1);
});
