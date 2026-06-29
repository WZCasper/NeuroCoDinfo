/*
  profile.js — логика страницы анкеты игрока.
*/

const COUNTRIES = [
  'Россия', 'Украина', 'Беларусь', 'Казахстан', 'Узбекистан', 'Армения',
  'Азербайджан', 'Грузия', 'Молдова', 'Кыргызстан', 'США', 'Канада',
  'Великобритания', 'Германия', 'Франция', 'Польша', 'Турция', 'Бразилия',
  'Аргентина', 'Мексика', 'Индия', 'Китай', 'Япония', 'Южная Корея', 'Австралия'
];
const OTHER_VALUE = '__other';

function fillCountrySelect(selected) {
  const select = document.getElementById('country-select');
  const isKnown = !selected || COUNTRIES.includes(selected);
  const options = [
    '<option value="">— не указано —</option>',
    ...COUNTRIES.map(c => `<option value="${c}">${c}</option>`),
    `<option value="${OTHER_VALUE}">Другая (указать)</option>`
  ];
  select.innerHTML = options.join('');
  select.value = isKnown ? (selected || '') : OTHER_VALUE;

  const otherInput = document.getElementById('country-other');
  if (!isKnown) {
    otherInput.hidden = false;
    otherInput.value = selected;
  }
}

document.getElementById('country-select').addEventListener('change', (e) => {
  const otherInput = document.getElementById('country-other');
  otherInput.hidden = e.target.value !== OTHER_VALUE;
  if (!otherInput.hidden) otherInput.focus();
});

function pluralize(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return few;
  return many;
}

function formatTenure(startDateStr) {
  if (!startDateStr) return null;
  const start = new Date(startDateStr);
  if (Number.isNaN(start.getTime())) return null;

  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) return null;

  const years = Math.floor(months / 12);
  const restMonths = months % 12;
  const parts = [];
  if (years > 0) parts.push(`${years} ${pluralize(years, 'год', 'года', 'лет')}`);
  if (restMonths > 0 || years === 0) parts.push(`${restMonths} ${pluralize(restMonths, 'месяц', 'месяца', 'месяцев')}`);
  return parts.join(' ') + ' в игре';
}

function renderProfileCard(profile) {
  const slot = document.getElementById('profile-card-slot');
  const hasAnything = profile.name || profile.activisionId || profile.country || profile.startDate || profile.platform || profile.favoriteModes.length;
  if (!hasAnything) {
    slot.innerHTML = '';
    return;
  }

  const tenure = formatTenure(profile.startDate);
  const avatar = profile.photoUrl
    ? `<img class="profile-avatar profile-avatar-photo" src="${profile.photoUrl}" alt="">`
    : `<span class="profile-avatar">${(profile.name || 'Г').slice(0, 1).toUpperCase()}</span>`;

  slot.innerHTML = `
    <div class="profile-card">
      <div class="profile-card-header">
        ${avatar}
        <div>
          <div class="profile-name">${profile.name || 'Безымянный оператор'}</div>
          ${profile.telegramUsername ? `<div class="profile-tag">@${profile.telegramUsername}</div>` : ''}
          ${profile.activisionId ? `<div class="profile-tag">${profile.activisionId}</div>` : ''}
        </div>
      </div>
      <div class="profile-meta-row">
        ${profile.country ? `<span class="profile-meta-item">${profile.country}</span>` : ''}
        ${profile.platform ? `<span class="profile-meta-item">${profile.platform}</span>` : ''}
        ${tenure ? `<span class="profile-meta-item">${tenure}</span>` : ''}
      </div>
      ${profile.favoriteModes.length ? `
        <div class="tag-row">
          ${profile.favoriteModes.map(m => `<span class="tag-chip">${m}</span>`).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function fillForm(profile) {
  const form = document.getElementById('profile-form');
  form.elements.name.value = profile.name || '';
  form.elements.activisionId.value = profile.activisionId || '';
  form.elements.startDate.value = profile.startDate || '';
  fillCountrySelect(profile.country);

  form.querySelectorAll('input[name=favoriteModes]').forEach(cb => {
    cb.checked = profile.favoriteModes.includes(cb.value);
  });
  form.querySelectorAll('input[name=platform]').forEach(radio => {
    radio.checked = radio.value === profile.platform;
  });
}

function readForm() {
  const form = document.getElementById('profile-form');
  const countrySelectValue = form.elements.country.value;
  const country = countrySelectValue === OTHER_VALUE
    ? form.elements.countryOther.value.trim()
    : countrySelectValue;

  const favoriteModes = [...form.querySelectorAll('input[name=favoriteModes]:checked')].map(cb => cb.value);
  const platformInput = form.querySelector('input[name=platform]:checked');

  return {
    name: form.elements.name.value.trim(),
    activisionId: form.elements.activisionId.value.trim(),
    country,
    startDate: form.elements.startDate.value,
    favoriteModes,
    platform: platformInput ? platformInput.value : ''
  };
}

function refresh() {
  const profile = Store.getProfile();
  fillForm(profile);
  renderProfileCard(profile);
}

document.getElementById('profile-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = readForm();
  Store.setProfile(data);
  renderProfileCard(Store.getProfile());
  showToast('Анкета сохранена');
});

document.getElementById('profile-clear').addEventListener('click', () => {
  if (!confirm('Очистить анкету? Это действие нельзя отменить.')) return;
  Store.clearProfile();
  refresh();
  showToast('Анкета очищена');
});

refresh();
