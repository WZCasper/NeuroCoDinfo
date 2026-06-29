/*
  config.js — публичные настройки сайта.

  ВАЖНО: этот файл виден всем посетителям в браузере (это обычный JS-файл
  на статическом сайте) — поэтому сюда нельзя класть токен бота или другие
  секреты. Токен бота (TELEGRAM_BOT_TOKEN) хранится отдельно, в секретах
  GitHub Actions, и сюда никогда не попадает.

  А вот supabaseUrl и supabaseAnonKey — это НЕ секреты. Supabase специально
  проектирует свой публичный ключ (его называют либо «anon key», либо,
  в новых проектах, «publishable key», вид sb_publishable_...) для
  использования прямо в браузере. Реальная защита данных обеспечивается
  правами доступа (Row Level Security) на стороне базы — см. supabase/schema.sql,
  а не секретностью этого ключа.
*/
const SITE_CONFIG = {
  // TODO (Этап 6): впишите username вашего Telegram-бота без «@», например 'NeuroCoDinfoBot'
  telegramBotUsername: 'YourBotUsername',

  // TODO (Этап 3): создайте проект на supabase.com, выполните в нём
  // supabase/schema.sql, затем впишите сюда URL проекта и публичный ключ
  // (Settings → API Keys в дашборде Supabase — подходит и «anon key», и
  // «publishable key», в зависимости от того, какой формат у вашего проекта).
  // Пока здесь стоят заглушки — сайт работает в локальном демо-режиме (localStorage).
  supabaseUrl: 'https://ВАШ_ПРОЕКТ.supabase.co',
  supabaseAnonKey: 'ВАШ_ANON_ИЛИ_PUBLISHABLE_KEY'
};
