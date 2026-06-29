/*
  store.js — слой данных сайта.

  Контент статей (заголовки, тексты) всегда приходит из data/posts.json —
  это не меняется независимо от backend'а, это зона ответственности Этапа 2.

  А вот комментарии и реакции (лайки/дизлайки) работают через ОДИН из двух
  бэкендов:
  - Supabase, если в js/config.js настроены supabaseUrl/supabaseAnonKey
    (см. SupabaseBackend.isEnabled() в js/supabase-client.js) — тогда данные
    общие для всех посетителей сайта;
  - localStorage — демо-режим, данные видны только в этом браузере. Это и
    запасной вариант, и то, что работает «из коробки» без какой-либо настройки.

  Главное: main.js и post.js обращаются только к функциям Store и не знают,
  какой бэкенд используется сейчас — переключение происходит здесь, в одном
  месте. Все функции, связанные с комментариями и реакциями, асинхронные
  (возвращают Promise) в ОБОИХ бэкендах — это специально сделано одинаково,
  чтобы остальной код не зависел от того, какой из них активен.
*/

const STORAGE_KEYS = {
  posts: 'ncdi_posts_v1',
  comments: 'ncdi_comments_v1',
  reactions: 'ncdi_reactions_v1',
  profile: 'ncdi_profile_v1'
};

const Store = (() => {

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error('Store: не удалось прочитать', key, e);
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('Store: не удалось сохранить', key, e);
    }
  }

  function backendIsSupabase() {
    return typeof SupabaseBackend !== 'undefined' && SupabaseBackend.isEnabled();
  }

  // --- Посты (контент) — всегда из data/posts.json, см. комментарий выше ---

  // Подгружаются заново при каждом открытии страницы: data/posts.json
  // регулярно обновляется автопайплайном (Этап 2), и посетители должны
  // видеть свежие новости, а не застывшую версию из своего первого визита.
  async function init() {
    try {
      const res = await fetch('data/posts.json', { cache: 'no-store' });
      const freshPosts = await res.json();
      writeJSON(STORAGE_KEYS.posts, freshPosts);
    } catch (e) {
      console.error(
        'Store: не удалось загрузить data/posts.json (используется последняя сохранённая копия, если есть). ' +
        'Если вы открыли index.html напрямую через file:// — браузер блокирует такую загрузку, ' +
        'запустите локальный сервер (например, "npx serve ." или "python3 -m http.server"), см. README.md.',
        e
      );
      if (readJSON(STORAGE_KEYS.posts, null) === null) writeJSON(STORAGE_KEYS.posts, []);
    }
    if (readJSON(STORAGE_KEYS.comments, null) === null) writeJSON(STORAGE_KEYS.comments, {});
  }

  function getPosts() {
    const posts = readJSON(STORAGE_KEYS.posts, []);
    return [...posts].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.publishedAt) - new Date(a.publishedAt);
    });
  }

  function getPost(id) {
    return getPosts().find((p) => p.id === id) || null;
  }

  // --- Локальный бэкенд для комментариев и реакций (демо-режим) ---
  // В локальном режиме «весь мир» — это один браузер, поэтому количество
  // реакций всегда 0 или 1 (отреагировал/не отреагировал этот посетитель).
  // Это не баг, а честное отражение того, что демо-режим однопользовательский.

  function reactionKey(targetType, targetId) {
    return `${targetType}:${targetId}`;
  }

  function localGetMyReaction(targetType, targetId) {
    const reactions = readJSON(STORAGE_KEYS.reactions, {});
    return reactions[reactionKey(targetType, targetId)] || null;
  }

  function localSetMyReaction(targetType, targetId, value) {
    const reactions = readJSON(STORAGE_KEYS.reactions, {});
    const key = reactionKey(targetType, targetId);
    if (value === null) delete reactions[key];
    else reactions[key] = value;
    writeJSON(STORAGE_KEYS.reactions, reactions);
  }

  function localGetReactionCounts(targetType, targetId) {
    const mine = localGetMyReaction(targetType, targetId);
    return { likes: mine === 'like' ? 1 : 0, dislikes: mine === 'dislike' ? 1 : 0 };
  }

  function localToggleReaction(targetType, targetId, type) {
    const current = localGetMyReaction(targetType, targetId);
    const next = current === type ? null : type;
    localSetMyReaction(targetType, targetId, next);
    return next;
  }

  function localGetComments(postId) {
    const all = readJSON(STORAGE_KEYS.comments, {});
    const list = all[postId] || [];
    return list.map((c) => ({ ...c, ...localGetReactionCounts('comment', c.id) }));
  }

  function localAddComment(postId, { author, text, parentId = null }) {
    const all = readJSON(STORAGE_KEYS.comments, {});
    if (!all[postId]) all[postId] = [];
    const comment = {
      id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      postId,
      parentId,
      author: (author && author.trim()) || 'Гость',
      text: text.trim(),
      createdAt: new Date().toISOString()
    };
    all[postId].push(comment);
    writeJSON(STORAGE_KEYS.comments, all);
    return { ...comment, likes: 0, dislikes: 0 };
  }

  function localGetCommentCounts(postIds) {
    const all = readJSON(STORAGE_KEYS.comments, {});
    const map = new Map();
    postIds.forEach((id) => map.set(id, (all[id] || []).length));
    return map;
  }

  // --- Единый интерфейс: делегирует в Supabase или в локальные функции выше ---

  async function getComments(postId) {
    return backendIsSupabase() ? SupabaseBackend.getComments(postId) : localGetComments(postId);
  }

  async function getCommentCounts(postIds) {
    return backendIsSupabase() ? SupabaseBackend.getCommentCounts(postIds) : localGetCommentCounts(postIds);
  }

  async function addComment(postId, payload) {
    return backendIsSupabase() ? SupabaseBackend.addComment(postId, payload) : localAddComment(postId, payload);
  }

  async function getReactionCounts(targetType, targetId) {
    return backendIsSupabase()
      ? SupabaseBackend.getReactionCounts(targetType, targetId)
      : localGetReactionCounts(targetType, targetId);
  }

  async function getReactionCountsBulk(targetType, targetIds) {
    if (backendIsSupabase()) return SupabaseBackend.getReactionCountsBulk(targetType, targetIds);
    const map = new Map();
    targetIds.forEach((id) => map.set(id, localGetReactionCounts(targetType, id)));
    return map;
  }

  async function getMyReaction(targetType, targetId) {
    return backendIsSupabase()
      ? SupabaseBackend.getMyReaction(targetType, targetId)
      : localGetMyReaction(targetType, targetId);
  }

  async function getMyReactionsBulk(targetType, targetIds) {
    if (backendIsSupabase()) return SupabaseBackend.getMyReactionsBulk(targetType, targetIds);
    const map = new Map();
    targetIds.forEach((id) => {
      const mine = localGetMyReaction(targetType, id);
      if (mine) map.set(id, mine);
    });
    return map;
  }

  async function toggleReaction(targetType, targetId, type) {
    return backendIsSupabase()
      ? SupabaseBackend.toggleReaction(targetType, targetId, type)
      : localToggleReaction(targetType, targetId, type);
  }

  // --- Анкета пользователя (Этап 5) ---
  // Остаётся локальной даже после подключения Supabase — у анкеты пока нет
  // смысла быть общей без настоящего аккаунта (см. Этап 4). Когда появится
  // вход через соцсети, это естественное место для следующего переключения.
  const DEFAULT_PROFILE = {
    name: '',
    activisionId: '',
    country: '',
    startDate: '',
    favoriteModes: [],
    platform: '',
    photoUrl: '',
    telegramUsername: ''
  };

  function getProfile() {
    return { ...DEFAULT_PROFILE, ...readJSON(STORAGE_KEYS.profile, {}) };
  }

  function setProfile(patch) {
    const next = { ...getProfile(), ...patch };
    writeJSON(STORAGE_KEYS.profile, next);
    return next;
  }

  function clearProfile() {
    writeJSON(STORAGE_KEYS.profile, DEFAULT_PROFILE);
  }

  function getGuestName() {
    return getProfile().name || '';
  }

  function setGuestName(name) {
    setProfile({ name: name || '' });
  }

  return {
    init,
    getPosts,
    getPost,
    getComments,
    getCommentCounts,
    addComment,
    getReactionCounts,
    getReactionCountsBulk,
    getMyReaction,
    getMyReactionsBulk,
    toggleReaction,
    getProfile,
    setProfile,
    clearProfile,
    getGuestName,
    setGuestName
  };
})();
