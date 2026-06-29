/*
  common.js — общие функции, используемые и на главной странице, и на странице статьи.
*/

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
}

function postUrl(id) {
  const base = location.origin + location.pathname.replace(/index\.html$|post\.html$/, '');
  return `${base}post.html?id=${encodeURIComponent(id)}`;
}

async function sharePost(post) {
  const url = postUrl(post.id);
  if (navigator.share) {
    try {
      await navigator.share({ title: post.title, text: post.excerpt, url });
    } catch (_) {
      // пользователь закрыл системное окно — это нормально, ничего не делаем
    }
  } else {
    await navigator.clipboard.writeText(url);
    showToast('Ссылка скопирована — отправьте её куда нужно');
  }
}

async function copyPostLink(post) {
  await navigator.clipboard.writeText(postUrl(post.id));
  showToast('Ссылка скопирована');
}

async function copyPostText(post) {
  const text = `${post.title}\n\n${post.body.join('\n\n')}\n\nИсточник: ${post.source.url}`;
  await navigator.clipboard.writeText(text);
  showToast('Текст статьи скопирован');
}

// Подсвечивает кнопки лайка/дизлайка, на которые уже нажал текущий посетитель.
// Делает это одним пакетным запросом на посты и одним на комментарии —
// а не отдельным запросом на каждую кнопку, это важно при реальном backend'е.
async function applyReactionStates() {
  const buttons = [...document.querySelectorAll('[data-reaction-target]')];
  if (buttons.length === 0) return;

  const idsByType = { post: new Set(), comment: new Set() };
  buttons.forEach((btn) => {
    const [type, id] = btn.dataset.reactionTarget.split(':');
    if (idsByType[type]) idsByType[type].add(id);
  });

  const [myPostReactions, myCommentReactions] = await Promise.all([
    Store.getMyReactionsBulk('post', [...idsByType.post]),
    Store.getMyReactionsBulk('comment', [...idsByType.comment])
  ]);

  buttons.forEach((btn) => {
    const [type, id] = btn.dataset.reactionTarget.split(':');
    const mine = type === 'post' ? myPostReactions.get(id) : myCommentReactions.get(id);
    const isLike = btn.classList.contains('like-btn');
    btn.classList.toggle('is-active', (isLike && mine === 'like') || (!isLike && mine === 'dislike'));
  });
}

// Единый обработчик кликов по лайкам/дизлайкам — работает и для постов, и для
// комментариев, и на главной, и на странице статьи. После переключения реакции
// обновляет напрямую только счётчики у пары кнопок этого конкретного поста/
// комментария — без перерисовки всей страницы.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-reaction-target]');
  if (!btn || btn.disabled) return;

  const target = btn.dataset.reactionTarget; // например "post:src-blog-2026-05-..."
  const [type, id] = target.split(':');
  const reaction = btn.classList.contains('like-btn') ? 'like' : 'dislike';

  const pairButtons = [...document.querySelectorAll('[data-reaction-target]')]
    .filter((b) => b.dataset.reactionTarget === target);
  pairButtons.forEach((b) => { b.disabled = true; });

  try {
    await Store.toggleReaction(type, id, reaction);
    const [counts, mine] = await Promise.all([
      Store.getReactionCounts(type, id),
      Store.getMyReaction(type, id)
    ]);
    pairButtons.forEach((b) => {
      const isLike = b.classList.contains('like-btn');
      const countEl = b.querySelector('.count');
      if (countEl) countEl.textContent = isLike ? counts.likes : counts.dislikes;
      b.classList.toggle('is-active', (isLike && mine === 'like') || (!isLike && mine === 'dislike'));
    });
  } catch (err) {
    console.error('Не удалось обновить реакцию:', err);
    showToast('Не получилось сохранить реакцию — попробуйте ещё раз');
  } finally {
    pairButtons.forEach((b) => { b.disabled = false; });
  }
});
