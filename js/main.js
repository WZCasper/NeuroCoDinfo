/*
  main.js — логика главной страницы.
*/

let currentFilter = 'all';

function renderPinned(posts) {
  const grid = document.getElementById('pinned-grid');
  const pinned = posts.filter((p) => p.pinned).slice(0, 3);
  grid.innerHTML = pinned.map((p) => `
    <a class="pinned-card" href="post.html?id=${encodeURIComponent(p.id)}">
      <span class="pinned-category">${escapeHtml(p.category)}</span>
      <span class="pinned-title">${escapeHtml(p.title)}</span>
      <span class="pinned-time">${timeAgo(p.publishedAt)}</span>
    </a>
  `).join('');
}

// Все текстовые поля статьи (title, excerpt, category, source.name) приходят
// из data/posts.json — а туда их пишет scripts/fetch-news.mjs, разбирая HTML
// стороннего сайта (callofduty.com/blog). Это внешний, не контролируемый
// нами источник, поэтому перед вставкой в innerHTML текст экранируется
// точно так же, как пользовательский ввод в комментариях (см. js/post.js) —
// разница в источнике угрозы не отменяет необходимость защиты от неё.
function articleCardTemplate(p, counts, commentCount) {
  const safeTitle = escapeHtml(p.title);
  const safeExcerpt = escapeHtml(p.excerpt);
  const safeCategory = escapeHtml(p.category);
  const safeSourceName = escapeHtml(p.source.name);

  // p.image отсутствует у демо-постов и равен null у реальных статей, для
  // которых источник не указал og:image (см. комментарий в fetch-news.mjs),
  // поэтому блок с картинкой рендерится условно: без него карточка просто
  // остаётся без иллюстрации, а не падает с ошибкой на чтении свойств null.
  // Картинка грузится напрямую с сайта-источника по ссылке — на нашем
  // GitHub Pages сам файл не хранится (см. то же объяснение в
  // fetch-news.mjs), поэтому "наш сервер" не расходует место на неё.
  // loading="lazy" откладывает загрузку картинок, которые ещё не попали
  // в видимую область экрана — так начальная загрузка страницы с лентой
  // из нескольких статей не ждёт разом всех картинок.
  // width/height заданы заранее (когда источник их указал) специально для
  // того, чтобы браузер сразу знал пропорции и не сдвигал остальную вёрстку
  // в момент, когда картинка наконец догружается (CLS, Cumulative Layout
  // Shift) — это сохраняет для него место ещё до её прихода.
  const imageHtml = p.image
    ? `<a class="card-image-link" href="post.html?id=${encodeURIComponent(p.id)}">
         <img class="card-image" src="${safeUrl(p.image.url)}" alt=""
              ${p.image.width ? `width="${p.image.width}"` : ''}
              ${p.image.height ? `height="${p.image.height}"` : ''}
              loading="lazy" decoding="async">
       </a>`
    : '';

  return `
    <article class="article-card">
      ${imageHtml}
      <div class="card-meta">
        <span class="card-category">${safeCategory}</span>
        <span class="card-dot">·</span>
        <span class="card-source">${safeSourceName}</span>
        <span class="card-dot">·</span>
        <span class="card-time">${timeAgo(p.publishedAt)}</span>
      </div>
      <h2 class="card-title"><a href="post.html?id=${encodeURIComponent(p.id)}">${safeTitle}</a></h2>
      <p class="card-excerpt">${safeExcerpt}</p>
      <div class="action-row">
        <button class="action-btn like-btn" data-reaction-target="post:${p.id}" aria-label="Нравится">${Icons.like}<span class="count">${counts.likes}</span></button>
        <button class="action-btn dislike-btn" data-reaction-target="post:${p.id}" aria-label="Не нравится">${Icons.dislike}<span class="count">${counts.dislikes}</span></button>
        <a class="action-btn" href="post.html?id=${encodeURIComponent(p.id)}#comments" aria-label="Комментарии">${Icons.comment}<span class="count">${commentCount}</span></a>
        <span class="action-spacer"></span>
        <button class="action-btn icon-only" data-action="share" data-id="${p.id}" aria-label="Поделиться">${Icons.share}</button>
        <button class="action-btn icon-only" data-action="copy-link" data-id="${p.id}" aria-label="Скопировать ссылку">${Icons.link}</button>
        <button class="action-btn icon-only" data-action="copy-text" data-id="${p.id}" aria-label="Скопировать текст">${Icons.copy}</button>
      </div>
    </article>
  `;
}

// Загружает счётчики лайков и комментариев ОДНИМ пакетным запросом на все
// посты сразу (а не по отдельному запросу на каждую карточку) — важно при
// настоящем backend'е, чтобы открытие главной страницы не превращалось
// в десятки запросов.
async function renderFeed(posts) {
  const list = document.getElementById('feed-list');
  const filtered = currentFilter === 'all' ? posts : posts.filter((p) => p.category === currentFilter);

  if (filtered.length === 0) {
    list.innerHTML = `<p class="empty-state">Пока нет новостей в этой категории.</p>`;
    return;
  }

  const ids = filtered.map((p) => p.id);
  const [reactionCounts, commentCounts] = await Promise.all([
    Store.getReactionCountsBulk('post', ids),
    Store.getCommentCounts(ids)
  ]);

  list.innerHTML = filtered
    .map((p) => articleCardTemplate(p, reactionCounts.get(p.id), commentCounts.get(p.id) || 0))
    .join('');

  await applyReactionStates();
}

async function refresh() {
  const posts = Store.getPosts();
  renderPinned(posts);
  await renderFeed(posts);
}

document.addEventListener('click', (e) => {
  const actionBtn = e.target.closest('[data-action]');
  if (actionBtn) {
    const post = Store.getPost(actionBtn.dataset.id);
    const action = actionBtn.dataset.action;
    if (action === 'share') sharePost(post);
    if (action === 'copy-link') copyPostLink(post);
    if (action === 'copy-text') copyPostText(post);
  }

  const navLink = e.target.closest('.nav-link');
  if (navLink) {
    e.preventDefault();
    document.querySelectorAll('.nav-link').forEach((l) => l.classList.remove('is-active'));
    navLink.classList.add('is-active');
    currentFilter = navLink.dataset.filter;
    renderFeed(Store.getPosts());
  }
});

const demoBanner = document.getElementById('demo-banner');
const demoBannerClose = document.getElementById('demo-banner-close');
if (demoBannerClose) {
  demoBannerClose.addEventListener('click', () => demoBanner.remove());
}

const botLink = document.getElementById('bot-add-link');
if (botLink) {
  botLink.href = `https://t.me/${encodeURIComponent(SITE_CONFIG.telegramBotUsername)}?startgroup=true`;
}

Store.init().then(refresh);
