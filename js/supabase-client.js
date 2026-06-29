/*
  supabase-client.js — обёртка над Supabase JS SDK для комментариев и лайков.

  Включается автоматически, как только в js/config.js будут вписаны
  настоящие supabaseUrl и supabaseAnonKey (вместо заглушек). До этого момента
  SUPABASE_ENABLED равен false, и store.js продолжает работать в локальном
  демо-режиме на localStorage — ничего не ломается.
*/

const SUPABASE_ENABLED = Boolean(
  typeof SITE_CONFIG !== 'undefined' &&
  SITE_CONFIG.supabaseUrl &&
  SITE_CONFIG.supabaseAnonKey &&
  !SITE_CONFIG.supabaseUrl.includes('ВАШ_ПРОЕКТ') &&
  typeof supabase !== 'undefined'
);

const supabaseClient = SUPABASE_ENABLED
  ? supabase.createClient(SITE_CONFIG.supabaseUrl, SITE_CONFIG.supabaseAnonKey)
  : null;

// Идентификатор "голосующего" для лайков/комментариев. Если посетитель вошёл
// через Telegram (см. js/auth.js), используется подтверждённый telegram_id —
// он не теряется при очистке localStorage и одинаков на разных устройствах,
// где выполнен вход в один Telegram-аккаунт. Если вход не выполнен — обычный
// случайный идентификатор браузера, как и раньше.
function getDeviceId() {
  const telegramUser = getTelegramUser();
  if (telegramUser) return 'tg_' + telegramUser.id;

  const KEY = 'ncdi_device_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : 'dev_' + Date.now() + '_' + Math.random().toString(36).slice(2));
    localStorage.setItem(KEY, id);
  }
  return id;
}

function getTelegramUser() {
  try {
    const raw = localStorage.getItem('ncdi_telegram_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function rowToComment(row) {
  return {
    id: row.id,
    postId: row.post_id,
    parentId: row.parent_id,
    author: row.author,
    text: row.text,
    createdAt: row.created_at,
    likes: 0,
    dislikes: 0
  };
}

function emptyCounts() {
  return { likes: 0, dislikes: 0 };
}

const SupabaseBackend = {
  isEnabled() {
    return SUPABASE_ENABLED;
  },

  async getComments(postId) {
    const { data, error } = await supabaseClient
      .from('comments')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) { console.error('Supabase getComments:', error.message); return []; }

    const comments = data.map(rowToComment);
    if (comments.length === 0) return comments;

    const counts = await this.getReactionCountsBulk('comment', comments.map((c) => c.id));
    comments.forEach((c) => {
      const found = counts.get(c.id) || emptyCounts();
      c.likes = found.likes;
      c.dislikes = found.dislikes;
    });
    return comments;
  },

  async getCommentCounts(postIds) {
    const map = new Map(postIds.map((id) => [id, 0]));
    if (postIds.length === 0) return map;

    const { data, error } = await supabaseClient
      .from('comments')
      .select('post_id')
      .in('post_id', postIds);
    if (error) { console.error('Supabase getCommentCounts:', error.message); return map; }

    data.forEach((row) => map.set(row.post_id, (map.get(row.post_id) || 0) + 1));
    return map;
  },

  async addComment(postId, { author, text, parentId = null }) {
    const { data, error } = await supabaseClient
      .from('comments')
      .insert({
        post_id: postId,
        parent_id: parentId,
        author: (author && author.trim()) || 'Гость',
        text: text.trim(),
        device_id: getDeviceId()
      })
      .select()
      .single();
    if (error) { console.error('Supabase addComment:', error.message); throw error; }
    return rowToComment(data);
  },

  async getReactionCounts(targetType, targetId) {
    const bulk = await this.getReactionCountsBulk(targetType, [targetId]);
    return bulk.get(targetId) || emptyCounts();
  },

  async getReactionCountsBulk(targetType, targetIds) {
    const map = new Map(targetIds.map((id) => [id, emptyCounts()]));
    if (targetIds.length === 0) return map;

    const { data, error } = await supabaseClient
      .from('reactions')
      .select('target_id, reaction')
      .eq('target_type', targetType)
      .in('target_id', targetIds);
    if (error) { console.error('Supabase getReactionCountsBulk:', error.message); return map; }

    data.forEach((row) => {
      const entry = map.get(row.target_id) || emptyCounts();
      if (row.reaction === 'like') entry.likes += 1;
      else entry.dislikes += 1;
      map.set(row.target_id, entry);
    });
    return map;
  },

  async getMyReaction(targetType, targetId) {
    const bulk = await this.getMyReactionsBulk(targetType, [targetId]);
    return bulk.get(targetId) || null;
  },

  async getMyReactionsBulk(targetType, targetIds) {
    const map = new Map();
    if (targetIds.length === 0) return map;

    const { data, error } = await supabaseClient
      .from('reactions')
      .select('target_id, reaction')
      .eq('target_type', targetType)
      .eq('voter_id', getDeviceId())
      .in('target_id', targetIds);
    if (error) { console.error('Supabase getMyReactionsBulk:', error.message); return map; }

    data.forEach((row) => map.set(row.target_id, row.reaction));
    return map;
  },

  async toggleReaction(targetType, targetId, type) {
    const voterId = getDeviceId();
    const current = await this.getMyReaction(targetType, targetId);

    if (current === type) {
      const { error } = await supabaseClient
        .from('reactions')
        .delete()
        .eq('target_type', targetType)
        .eq('target_id', targetId)
        .eq('voter_id', voterId);
      if (error) console.error('Supabase toggleReaction (delete):', error.message);
      return null;
    }

    const { error } = await supabaseClient
      .from('reactions')
      .upsert({ target_type: targetType, target_id: targetId, voter_id: voterId, reaction: type });
    if (error) console.error('Supabase toggleReaction (upsert):', error.message);
    return type;
  }
};
