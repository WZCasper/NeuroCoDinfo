/*
  toast.js — короткие всплывающие уведомления снизу экрана
  («Ссылка скопирована», «Комментарий опубликован» и т.п.)
*/
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
