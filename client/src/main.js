import '../style.css';
import { weaponCard, WEAPON_IDS } from '@shared/weapons.js';
import { sanitizeName } from '@shared/sanitize.js';
import { acquireSingleTabLock } from './lock.js';
import { unlockAudio } from './audio.js';
import { reasonText } from './text.js';

const menuError = document.getElementById('menu-error');
const status = document.getElementById('status');
const play = document.getElementById('play');
const nameInput = document.getElementById('name');
const form = document.getElementById('join');
const weaponLine = document.getElementById('weapon-line');
const weaponBox = document.getElementById('weapons');

let skin = 't';
let weapon = 'ak';
let lockOk = false;
let busy = false;

function showError(text) {
  if (!text) {
    menuError.hidden = true;
    menuError.textContent = '';
    return;
  }
  menuError.hidden = false;
  menuError.textContent = text;
}

function setStatus(text) {
  status.hidden = !text;
  status.textContent = text || '';
}

function selectSkin(next) {
  skin = next === 'ct' ? 'ct' : 't';
  for (const btn of document.querySelectorAll('.skin')) {
    btn.classList.toggle('is-on', btn.dataset.skin === skin);
  }
}

function selectWeapon(next) {
  if (!WEAPON_IDS.includes(next)) return;
  weapon = next;
  for (const btn of weaponBox.querySelectorAll('button')) {
    btn.classList.toggle('is-on', btn.dataset.weapon === weapon);
  }
  weaponLine.textContent = weaponCard(weapon).line;
}

for (const id of WEAPON_IDS) {
  const card = weaponCard(id);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.weapon = id;
  btn.textContent = card.name;
  if (id === weapon) btn.classList.add('is-on');
  btn.addEventListener('click', () => selectWeapon(id));
  weaponBox.append(btn);
}
weaponLine.textContent = weaponCard(weapon).line;

for (const btn of document.querySelectorAll('.skin')) {
  btn.addEventListener('click', () => selectSkin(btn.dataset.skin));
}

function hasGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

nameInput.addEventListener('input', () => {
  if (nameInput.value.length > 16) nameInput.value = [...nameInput.value].slice(0, 16).join('');
});

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (!lockOk || busy) return;
  const cleaned = sanitizeName(nameInput.value);
  if (!cleaned || typeof cleaned !== 'string') {
    showError(reasonText(cleaned && cleaned.error ? cleaned.error : 'name'));
    return;
  }
  if (!hasGL()) {
    showError(reasonText('webgl'));
    return;
  }
  unlockAudio();
  const view = document.getElementById('view');
  view.requestPointerLock?.();
  busy = true;
  play.disabled = true;
  showError('');
  setStatus('Conectando…');
  import('./match.js').then(({ startMatch }) => startMatch({
    name: cleaned,
    skin,
    weapon,
    onStatus: setStatus,
  })).then((message) => {
    document.getElementById('menu').hidden = false;
    setStatus('');
    showError(message || '');
  }).catch((err) => {
    document.getElementById('menu').hidden = false;
    document.getElementById('hud').hidden = true;
    document.getElementById('death').hidden = true;
    setStatus('');
    showError(reasonText(err?.reason || 'closed'));
  }).finally(() => {
    busy = false;
    play.disabled = !lockOk;
    if (document.pointerLockElement) document.exitPointerLock();
  });
});

acquireSingleTabLock().then((ok) => {
  lockOk = ok;
  play.disabled = !ok;
  if (!ok) showError(reasonText('tab'));
  else nameInput.focus();
});
