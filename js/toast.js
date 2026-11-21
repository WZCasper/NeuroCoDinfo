/*
  toast.js — короткие всплывающие уведомления снизу экрана
  («Ссылка скопирована», «Комментарий опубликован» и т.п.)

  Здесь же живут escapeHtml() и safeUrl() — две защитные функции,
  используемые по всему проекту. Файл выбран намеренно: это единственный
  js-файл, подключённый на всех трёх страницах (index.html, post.html,
  profile.html), поэтому обе функции доступны везде, где пользовательский
  или внешний текст вставляется через innerHTML, без необходимости менять
  состав <script>-тегов в HTML.

  ПРАВИЛО ПРОЕКТА: любой текст, который не задан буквально в самом шаблоне
  (т.е. пришёл от пользователя — комментарий, имя, анкета — или из внешнего
  источника — заголовок/описание статьи, собранные fetch-news.mjs), перед
  вставкой через innerHTML должен проходить через escapeHtml(). Любой URL
  из тех же источников, который становится значением атрибута href, должен
  дополнительно проходить через safeUrl() — экранирование HTML-символов не
  защищает от ссылок вида javascript:, это отдельный класс риска.
*/

// Экранирует управляющие символы HTML, чтобы пользовательский или сторонний
// текст нельзя было интерпретировать как разметку или скрипт при вставке
// через innerHTML. Порядок замен важен: амперсанд экранируется первым,
// иначе были бы задвоенно экранированы уже вставленные сущности вида &lt;.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Пропускает в href только http(s)-ссылки и относительные пути/якоря —
// отсекает javascript:, data: и другие потенциально опасные протоколы.
// Нужна отдельно от escapeHtml(), потому что опасность здесь не в HTML-
// символах (которых, например, в "javascript:alert(1)" нет), а в самом
// протоколе ссылки, который браузер выполнит при клике.
function safeUrl(value) {
  const url = String(value ?? '').trim();
  if (/^https?:\/\//i.test(url) || url.startsWith('/') || url.startsWith('?') || url.startsWith('#')) {
    return url;
  }
  return '#';
}

function showToast(message) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-visible'));
  setTimeout(() => {
    el.classList.remove('is-visible');
    setTimeout(() => el.remove(), 250);
  }, 2400);
}
