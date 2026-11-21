/*
  post.js — логика страницы отдельной статьи.
*/

function getQueryId() {
  return new URLSearchParams(location.search).get('id');
}

const postId = getQueryId();

// post.category/title/body приходят из data/posts.json — внешний источник
// (см. комментарий об этом в main.js), поэтому экранируются так же, как
// пользовательский ввод ниже. post.source.url дополнительно проходит через
// safeUrl(), так как это значение атрибута href, а не просто текст.
async function renderArticle(post) {
  document.title = `${post.title} — NeuroCoDinfo`;
  const counts = await Store.getReactionCounts('post', post.id);

  const safeCategory = escapeHtml(post.category);
  const safeSourceUrl = safeUrl(post.source.url);
  const safeSourceName = escapeHtml(post.source.name);
  const safeTitle = escapeHtml(post.title);
  const safeBody = post.body.map((p) => `<p>${escapeHtml(p)}</p>`).join('');

  // post.image отсутствует у демо-постов и равен null у реальных статей,
  // для которых источник не указал og:image — тот же случай, что и в
  // main.js, со всеми теми же причинами (см. подробный комментарий там).
  // loading="eager" (а не "lazy", как на главной странице) — здесь картинка
  // почти всегда видна сразу при открытии страницы статьи, откладывать её
  // загрузку не нужно.
  const imageHtml = post.image
    ? `<img class="post-image" src="${safeUrl(post.image.url)}" alt=""
            ${post.image.width ? `width="${post.image.width}"` : ''}
            ${post.image.height ? `height="${post.image.height}"` : ''}
            loading="eager" decoding="async">`
    : '';

  document.getElementById('article-root').innerHTML = `
    <div class="post-meta">
      <span class="card-category">${safeCategory}</span>
      <span class="card-dot">·</span>
      <a class="card-source" href="${safeSourceUrl}" target="_blank" rel="noopener">${safeSourceName}</a>
      <span class="card-dot">·</span>
      <span class="card-time">${timeAgo(post.publishedAt)}</span>
      <span class="card-dot">·</span>
      <span class="translated-tag">перевод RU</span>
    </div>
    <h1 class="post-title">${safeTitle}</h1>
    ${imageHtml}
    <div class="post-body">${safeBody}</div>
    <div class="action-row">
      <button class="action-btn like-btn" data-reaction-target="post:${post.id}" aria-label="Нравится">${Icons.like}<span class="count">${counts.likes}</span></button>
      <button class="action-btn dislike-btn" data-reaction-target="post:${post.id}" aria-label="Не нравится">${Icons.dislike}<span class="count">${counts.dislikes}</span></button>
      <a class="action-btn" href="#comments" aria-label="Комментарии">${Icons.comment}<span class="count" id="comment-count">0</span></a>
      <span class="action-spacer"></span>
      <button class="action-btn icon-only" id="share-btn" aria-label="Поделиться">${Icons.share}</button>
      <button class="action-btn icon-only" id="copy-link-btn" aria-label="Скопировать ссылку">${Icons.link}</button>
      <button class="action-btn icon-only" id="copy-text-btn" aria-label="Скопировать текст">${Icons.copy}</button>
    </div>
  `;
  await applyReactionStates();

  document.getElementById('share-btn').addEventListener('click', () => sharePost(post));
  document.getElementById('copy-link-btn').addEventListener('click', () => copyPostLink(post));
  document.getElementById('copy-text-btn').addEventListener('click', () => copyPostText(post));
}

// c.author и c.text — свободный пользовательский ввод из формы комментария
// (post.html, #comment-composer) или формы ответа (replyFormTemplate ниже).
// Без escapeHtml() здесь был хранимый XSS: любой посетитель мог вставить
// <script>/<img onerror=...> в комментарий, и это выполнилось бы у каждого,
// кто откроет статью при подключённом общем backend'е (Supabase). Это
// самое важное место во всём проекте, где нужно экранирование.
function commentTemplate(c, replies) {
  const safeAuthor = escapeHtml(c.author);
  const safeAuthorInitial = escapeHtml(c.author.slice(0, 1).toUpperCase());
  const safeText = escapeHtml(c.text);
  return `
    <div class="comment" id="comment-${c.id}">
      <div class="comment-header">
        <span class="comment-avatar">${safeAuthorInitial}</span>
        <span class="comment-author">${safeAuthor}</span>
        <span class="comment-time">${timeAgo(c.createdAt)}</span>
      </div>
      <p class="comment-body">${safeText}</p>
      <div class="comment-actions">
        <button class="action-btn like-btn" data-reaction-target="comment:${c.id}" aria-label="Нравится">${Icons.like}<span class="count">${c.likes || 0}</span></button>
        <button class="action-btn dislike-btn" data-reaction-target="comment:${c.id}" aria-label="Не нравится">${Icons.dislike}<span class="count">${c.dislikes || 0}</span></button>
        <button class="text-btn reply-toggle" data-id="${c.id}" type="button">Ответить</button>
      </div>
      <div class="reply-form-slot" id="reply-form-${c.id}"></div>
      <div class="comment-replies">
        ${replies.map((r) => commentTemplate(r, [])).join('')}
      </div>
    </div>
  `;
}

function replyFormTemplate(parentId) {
  return `
    <form class="reply-form" data-parent-id="${parentId}">
      <textarea required placeholder="Ваш ответ" rows="2"></textarea>
      <div class="form-row">
        <button type="submit" class="btn-secondary">Ответить</button>
        <button type="button" class="text-btn reply-cancel">Отмена</button>
      </div>
    </form>
  `;
}

async function renderComments() {
  const all = await Store.getComments(postId);
  const topLevel = all.filter((c) => !c.parentId);
  const byParent = {};
  all.forEach((c) => {
    if (c.parentId) (byParent[c.parentId] = byParent[c.parentId] || []).push(c);
  });

  const list = document.getElementById('comment-list');
  list.innerHTML = topLevel.length
    ? topLevel.map((c) => commentTemplate(c, byParent[c.id] || [])).join('')
    : `<p class="empty-state">Будьте первым, кто оставит комментарий.</p>`;

  const countEl = document.getElementById('comment-count');
  if (countEl) countEl.textContent = all.length;
  await applyReactionStates();
}

document.addEventListener('click', (e) => {
  const toggle = e.target.closest('.reply-toggle');
  if (toggle) {
    const slot = document.getElementById(`reply-form-${toggle.dataset.id}`);
    slot.innerHTML = slot.innerHTML ? '' : replyFormTemplate(toggle.dataset.id);
  }

  const cancel = e.target.closest('.reply-cancel');
  if (cancel) {
    const slot = cancel.closest('[id^="reply-form-"]');
    if (slot) slot.innerHTML = '';
  }
});

document.addEventListener('submit', async (e) => {
  const composer = e.target.closest('#comment-composer');
  const replyForm = e.target.closest('.reply-form');
  if (!composer && !replyForm) return;

  e.preventDefault();
  const form = composer || replyForm;
  const submitBtn = form.querySelector('button[type=submit]');
  const textarea = composer ? composer.querySelector('[name=text]') : replyForm.querySelector('textarea');
  if (!textarea.value.trim()) return;

  if (submitBtn) submitBtn.disabled = true;
  try {
    if (composer) {
      const nameInput = composer.querySelector('[name=author]');
      Store.setGuestName(nameInput.value);
      await Store.addComment(postId, { author: nameInput.value, text: textarea.value });
      textarea.value = '';
      showToast('Комментарий опубликован');
    } else {
      const guestName = Store.getGuestName() || 'Гость';
      await Store.addComment(postId, {
        author: guestName,
        text: textarea.value,
        parentId: replyForm.dataset.parentId
      });
      showToast('Ответ опубликован');
    }
    await renderComments();
  } catch (err) {
    console.error('Не удалось опубликовать комментарий:', err);
    showToast('Не получилось опубликовать. Попробуйте через несколько секунд.');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

Store.init().then(async () => {
  const post = Store.getPost(postId);
  if (!post) {
    document.getElementById('article-root').innerHTML =
      `<p class="empty-state">Статья не найдена. <a href="index.html">Вернуться на главную</a></p>`;
    return;
  }
  await renderArticle(post);
  await renderComments();
  const nameField = document.querySelector('#comment-composer [name=author]');
  if (nameField) nameField.value = Store.getGuestName();
});
