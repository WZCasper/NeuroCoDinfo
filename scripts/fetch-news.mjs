/*
  fetch-news.mjs — собирает новые статьи с CharlieINTEL (charlieintel.com/news/),
  переводит короткое описание на русский и дописывает их в data/posts.json.
  Запускается по расписанию через GitHub Actions
  (см. .github/workflows/fetch-news.yml).

  ПОЧЕМУ ИСТОЧНИК — CHARLIEINTEL, А НЕ ОФИЦИАЛЬНЫЙ БЛОГ CALL OF DUTY:

  Раньше источником был callofduty.com/blog. Это честно работало в коде —
  парсинг был корректным, — но столкнулось с проблемой, которую невозможно
  исправить на уровне кода: callofduty.com принимает TCP-соединение и даже
  TLS-рукопожатие от раннеров GitHub Actions, но затем НИКОГДА не присылает
  ответ — соединение зависает и обрывается по таймауту. Диагностика
  (отдельный временный workflow с curl -v) показала: тот же самый запрос с
  инфраструктуры Anthropic проходит мгновенно, а с IP-адресов Microsoft/Azure
  (на которых и работают GitHub-hosted раннеры) — зависает. Это классический
  приём анти-бот защиты уровня крупного издателя (Activision), который
  "отмалчивается" на подозрительные облачные IP вместо явного отказа кодом
  403 — так работу бота сложнее отличить от обычного сетевого сбоя.

  Самостоятельный хостинг раннера (self-hosted runner) решил бы проблему
  по-настоящему, но требует постоянно доступного компьютера — а весь этот
  проект должен работать целиком через инфраструктуру GitHub, без этого
  условия. Поэтому вместо официального блога используется CharlieINTEL
  (charlieintel.com) — крупный, давно существующий (с 2011 года) англоязычный
  сайт новостей именно про Call of Duty, который при той же проверке (curl -v
  с GitHub-hosted раннера) отвечает мгновенно и без проблем.

  ЧЕСТНО О ГРАНИЦАХ ЭТОГО СКРИПТА:

  1. У charlieintel.com нет официального RSS/API — это тоже проверено
     вручную. Поэтому скрипт, как и раньше, аккуратно разбирает HTML
     страницы категории "News" (она отдаётся сервером с уже готовой
     разметкой, без обязательного выполнения JavaScript). Если сайт
     поменяет структуру страницы, разбор может перестать находить статьи —
     тогда нужно открыть лог запуска в GitHub Actions и поправить селекторы
     в функции getCandidateLinks().

  2. CharlieINTEL — независимое СМИ, а не официальный канал Activision.
     Это обычная практика для агрегаторов новостей об играх (большинство
     крупных игровых франшиз имеют именно такие специализированные
     сайты-источники, а не только официальный блог издателя), но это не то
     же самое, что первоисточник. Ссылка на оригинальную статью всегда
     указывается явно в поле source.url каждого поста.

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

// Категория "News" на CharlieINTEL — здесь только настоящие новости
// (обновления, патчи, анонсы), без гайдов по оружию и настройкам, которые
// на этом сайте вынесены в отдельные категории ("Call of Duty",
// "Call of Duty: Warzone" и т.д.) и сюда не попадают.
const BLOG_INDEX_URL = 'https://www.charlieintel.com/news/';
const SITE_ORIGIN = 'https://www.charlieintel.com';
const MAX_NEW_PER_RUN = 8;
const REQUEST_DELAY_MS = 600;
// Раньше запрос ничем не ограничивался по времени, и Node.js (точнее, его
// встроенный HTTP-клиент undici) ждал ответа ровно 5 минут (300 секунд —
// это задокументированное дефолтное значение headersTimeout в undici)
// прежде чем сам оборвать соединение с ошибкой UND_ERR_HEADERS_TIMEOUT.
// Таймаут ниже сокращает ожидание до разумного предела, а REQUEST_RETRIES
// даёт ещё несколько попыток с паузой — на случай обычного временного
// сетевого сбоя (не связанного с анти-бот блокировкой, которая и привела
// к смене источника — см. объяснение в начале файла).
const REQUEST_TIMEOUT_MS = 20_000;
const REQUEST_RETRIES = 3;
const RETRY_DELAY_MS = 3_000;
// ВАЖНО: значение HTTP-заголовка должно состоять только из ASCII-символов
// (код ≤ 255) — это требование самой спецификации HTTP, а не особенность
// Node.js. Кириллица здесь приводит к TypeError ещё до сетевого запроса.
const USER_AGENT = 'NeuroCoDinfoBot/1.0 (+https://github.com/; news aggregator and translator bot)';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ПОЧЕМУ ЗДЕСЬ ДВА РАЗНЫХ СЦЕНАРИЯ НЕУДАЧИ, И ПОЧЕМУ ОНИ ОБРАБОТАНЫ ПО-РАЗНОМУ:
//
// 1. Сервер ОТВЕТИЛ, но кодом ошибки (res.ok === false — 403, 429, 500...).
//    Повторять такой запрос несколько раз подряд обычно бессмысленно: если
//    сайт блокирует запрос по User-Agent или превышен лимит частоты, второй
//    и третий запрос почти наверняка получат тот же ответ. Поэтому здесь
//    попытки НЕ повторяются — ошибка бросается сразу, с диагностикой
//    (res.statusText и начало тела ответа).
//
// 2. Сервер НЕ ОТВЕТИЛ вовсе — fetch() сам бросил исключение: таймаут
//    (AbortError, когда сработал наш REQUEST_TIMEOUT_MS) или сетевой сбой
//    (TypeError: fetch failed). Такая проблема часто временная, поэтому
//    здесь попытки ПОВТОРЯЮТСЯ до REQUEST_RETRIES раз с паузой
//    RETRY_DELAY_MS между ними.
async function fetchHtml(url) {
  let lastNetworkError;

  for (let attempt = 1; attempt <= REQUEST_RETRIES; attempt += 1) {
    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (networkErr) {
      lastNetworkError = networkErr;
      console.warn(
        `Попытка ${attempt}/${REQUEST_RETRIES}: не удалось получить ответ от ${url} ` +
        `(${networkErr.message}).` +
        (attempt < REQUEST_RETRIES ? ` Повтор через ${RETRY_DELAY_MS / 1000} с...` : '')
      );
      if (attempt < REQUEST_RETRIES) await sleep(RETRY_DELAY_MS);
      continue;
    }

    if (!res.ok) {
      const bodyPreview = await res.text().catch(() => '');
      throw new Error(
        `HTTP ${res.status} ${res.statusText} при загрузке ${url}` +
        (bodyPreview ? ` — начало ответа сервера: ${bodyPreview.slice(0, 200).replace(/\s+/g, ' ')}` : '')
      );
    }
    return res.text();
  }

  throw new Error(
    `Не удалось загрузить ${url} после ${REQUEST_RETRIES} попыток: ${lastNetworkError.message}`
  );
}

// Категоризация по URL статьи. CharlieINTEL использует отдельные разделы
// сайта для Warzone/Black Ops 6, которые видны прямо в пути — это надёжнее
// старой логики по ключевым словам в slug, которая была рассчитана на
// структуру путей callofduty.com и для нового источника не подходит.
function categorize(urlPath) {
  const slug = urlPath.toLowerCase();
  if (slug.startsWith('/call-of-duty-warzone/')) return 'Варзон';
  if (slug.startsWith('/call-of-duty-black-ops-6/')) return 'Патчноуты';
  if (/battle-pass|bundle|skin-pack/.test(slug)) return 'Скидки';
  return 'Новости';
}

// Стабильный id на основе URL — не меняется между запусками, поэтому лайки
// и комментарии, привязанные к посту, не «отрываются» при повторной сборке.
function stableId(url) {
  const p = new URL(url).pathname.replace(/^\/+|\/+$/g, '');
  return 'src-' + p.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

// Страница категории /news/ на CharlieINTEL — это WordPress-сайт, и каждая
// карточка статьи там оформлена как ссылка на путь вида
// /какой-то-раздел/slug-ЧИСЛО/ (число — внутренний ID поста в WordPress,
// а не дата, в отличие от старого источника callofduty.com/blog, где дата
// была прямо в URL — поэтому точная дата публикации теперь берётся из
// мета-тега article:published_time на странице самой статьи, см.
// getArticleDetails ниже).
//
// Страницы категорий ("/news/", "/call-of-duty/" и подобные) отличаются от
// страниц статей тем, что их путь — это ровно один сегмент без числа в
// конце. Регулярное выражение ниже требует: один или несколько сегментов
// пути, последний из которых заканчивается на "-" и число — это и есть
// признак страницы конкретной статьи, а не раздела сайта.
const ARTICLE_PATH_RE = /^\/[a-z0-9-]+\/[a-z0-9-]+-\d+\/?$/i;

async function getCandidateLinks() {
  const html = await fetchHtml(BLOG_INDEX_URL);
  const $ = cheerio.load(html);
  // Каждый pathname хранит ОБА варианта заголовка, какие встретились:
  // text (из обычной текстовой ссылки-заголовка) и altText (из alt
  // картинки-превью). В итоговый список идёт text, если он хоть раз
  // встретился, иначе — altText. Простого "первого найденного значения"
  // здесь недостаточно: на странице категории карточка статьи устроена как
  // ДВЕ отдельные ссылки на один и тот же href — сначала картинка-ссылка
  // с alt, затем отдельная текстовая ссылка с полным заголовком статьи
  // (это подтверждено на реальной структуре сайта). Если брать первое
  // найденное значение как есть, результатом стал бы менее точный alt
  // картинки вместо куда более информативного текста заголовка —
  // проверено отдельным тестом на реальном HTML с сайта, который это
  // поймал.
  const found = new Map();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    let pathname;
    try {
      pathname = new URL(href, SITE_ORIGIN).pathname;
    } catch {
      return;
    }
    if (!ARTICLE_PATH_RE.test(pathname)) return;

    const text = $(el).text().trim();
    const altText = $(el).find('img').attr('alt')?.trim() || '';
    if (!text && !altText) return;

    const prev = found.get(pathname) || { text: '', altText: '' };
    found.set(pathname, {
      text: prev.text || text,
      altText: prev.altText || altText
    });
  });

  return [...found.entries()]
    .map(([pathname, { text, altText }]) => ({
      path: pathname,
      url: new URL(pathname, SITE_ORIGIN).toString(),
      title: text || altText
    }))
    .filter((item) => item.title);
}

// Возвращает и короткое описание статьи, и точную дату публикации —
// обе вещи берутся с одной и той же загруженной страницы статьи, чтобы не
// делать лишний повторный запрос только ради даты.
async function getArticleDetails(url) {
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const description =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      '';

    const publishedTime = $('meta[property="article:published_time"]').attr('content');
    const publishedAt = publishedTime && !Number.isNaN(new Date(publishedTime).getTime())
      ? new Date(publishedTime).toISOString()
      : new Date().toISOString();

    return { description: description.trim(), publishedAt };
  } catch (e) {
    console.error(`  не удалось получить данные статьи ${url}: ${e.message}`);
    return { description: '', publishedAt: new Date().toISOString() };
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
    const { description: rawDescription, publishedAt } = await getArticleDetails(item.url);
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
      source: { name: 'charlieintel.com', url: item.url },
      publishedAt,
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
