-- NeuroCoDinfo — схема Supabase для комментариев и лайков/дизлайков (Этап 3).
--
-- Как применить: в дашборде Supabase откройте SQL Editor → New query →
-- вставьте весь этот файл целиком → Run. Можно выполнять повторно без вреда
-- (используются "if not exists" и "or replace" везде, где это возможно).
--
-- ЧТО ОСОЗНАННО НЕ ВКЛЮЧЕНО СЮДА: таблица постов. Сами статьи (заголовок,
-- текст, источник) живут в data/posts.json в git-репозитории — это работает
-- и не нуждается в базе данных. Здесь нужны только две вещи, которые
-- обязательно должны быть общими для всех посетителей: комментарии и реакции.
--
-- ЧЕСТНО ОБ ОГРАНИЧЕНИИ: пока нет настоящей авторизации (Этап 4), у нас нет
-- способа надёжно доказать, что "voter_id" или "device_id" принадлежит тому,
-- кто его прислал — это просто случайный идентификатор браузера. Политики
-- ниже разрешают анонимным посетителям лайкать/комментировать (это прямое
-- требование задачи), но НЕ защищают от того, что технически продвинутый
-- человек может подделать чужой device_id и, например, снять чужой лайк.
-- Это нормальное и осознанное ограничение анонимной системы — когда появится
-- Этап 4 (вход через соцсети), voter_id нужно заменить на auth.uid(), а
-- политики update/delete — на "using (voter_id = auth.uid()::text)".

create extension if not exists pgcrypto;

-- ===================== Комментарии =====================

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  post_id text not null,
  parent_id uuid references comments(id) on delete cascade,
  author text not null default 'Гость',
  text text not null check (char_length(text) between 1 and 2000),
  device_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists comments_post_id_idx on comments (post_id);

-- Простая защита от спама: не больше одного комментария с одного устройства
-- раз в 10 секунд. Это не панацея (анонимный device_id легко подделать),
-- но отсекает случайный флуд и совсем простых ботов.
create or replace function enforce_comment_rate_limit() returns trigger as $$
begin
  if exists (
    select 1 from comments
    where device_id = new.device_id
      and created_at > now() - interval '10 seconds'
  ) then
    raise exception 'Слишком часто. Подождите немного перед следующим комментарием.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists comments_rate_limit on comments;
create trigger comments_rate_limit
  before insert on comments
  for each row execute function enforce_comment_rate_limit();

-- ===================== Реакции (лайки/дизлайки) =====================
-- Один человек (один voter_id) — максимум одна реакция на одну и ту же
-- статью или комментарий. "Снять лайк" = удалить строку, "переключить на
-- дизлайк" = обновить поле reaction. Именно это и делает upsert в коде.

create table if not exists reactions (
  target_type text not null check (target_type in ('post', 'comment')),
  target_id text not null,
  voter_id text not null,
  reaction text not null check (reaction in ('like', 'dislike')),
  created_at timestamptz not null default now(),
  primary key (target_type, target_id, voter_id)
);

create index if not exists reactions_target_idx on reactions (target_type, target_id);

-- ===================== Права доступа (Row Level Security) =====================

alter table comments enable row level security;
alter table reactions enable row level security;

drop policy if exists comments_select_all on comments;
create policy comments_select_all on comments for select using (true);

drop policy if exists comments_insert_anyone on comments;
create policy comments_insert_anyone on comments for insert with check (true);

drop policy if exists reactions_select_all on reactions;
create policy reactions_select_all on reactions for select using (true);

drop policy if exists reactions_insert_anyone on reactions;
create policy reactions_insert_anyone on reactions for insert with check (true);

drop policy if exists reactions_update_anyone on reactions;
create policy reactions_update_anyone on reactions for update using (true) with check (true);

drop policy if exists reactions_delete_anyone on reactions;
create policy reactions_delete_anyone on reactions for delete using (true);
