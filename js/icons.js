/*
  icons.js — простые линейные иконки в виде строк SVG.
  Сделаны вручную, без внешних библиотек и шрифтов иконок, чтобы сайт
  не зависел от сторонних CDN. При желании их легко заменить на полноценный
  иконный набор позже.
*/
const Icons = {
  like: `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><polygon points="10,4 17,14 3,14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,

  dislike: `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><polygon points="10,16 3,6 17,6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,

  comment: `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="2" y="3" width="16" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><polygon points="5,14 5,18 9,14" fill="currentColor"/></svg>`,

  share: `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="5" cy="10" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="15" cy="5" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="15" cy="15" r="2" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="6.8" y1="9" x2="13.2" y2="5.8" stroke="currentColor" stroke-width="1.4"/><line x1="6.8" y1="11" x2="13.2" y2="14.2" stroke="currentColor" stroke-width="1.4"/></svg>`,

  link: `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="5" cy="10" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="15" cy="10" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="7.4" y1="10" x2="12.6" y2="10" stroke="currentColor" stroke-width="1.6"/></svg>`,

  copy: `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="3" y="5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.55"/><rect x="6" y="2" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`
};
