export const WEAPON_IDS = ['deagle', 'sniper', 'ak', 'uzi'];

export const WEAPONS = {
  deagle: {
    id: 'deagle',
    name: 'Desert Eagle',
    damage: 50,
    headDamage: 100,
    headInstant: true,
    mag: 7,
    reserve: 35,
    interval: 0.38,
    reload: 1.75,
    auto: false,
    scope: false,
    spread: 0.007,
    spreadAds: 0.004,
    recoilPitch: 0.055,
    recover: 7,
    pattern: [0.012, -0.014, 0.01, -0.012, 0.008, -0.01, 0.006],
    range: 90,
  },
  sniper: {
    id: 'sniper',
    name: 'Sniper',
    damage: 100,
    headDamage: 100,
    headInstant: false,
    mag: 5,
    reserve: 20,
    interval: 1.25,
    reload: 2.8,
    auto: false,
    scope: true,
    spread: 0.09,
    spreadAds: 0.0012,
    recoilPitch: 0.12,
    recover: 3.2,
    pattern: [0.02, -0.015, 0.018, -0.02, 0.012],
    range: 200,
  },
  ak: {
    id: 'ak',
    name: 'AK-47',
    damage: 34,
    headDamage: 100,
    headInstant: true,
    mag: 30,
    reserve: 90,
    interval: 0.1,
    reload: 2.15,
    auto: true,
    scope: false,
    spread: 0.012,
    spreadAds: 0.006,
    recoilPitch: 0.0135,
    recover: 9,
    pattern: [0, 0.004, -0.005, 0.009, -0.011, 0.013, -0.008, 0.006, -0.012, 0.01],
    range: 150,
  },
  uzi: {
    id: 'uzi',
    name: 'Uzi',
    damage: 17,
    headDamage: 34,
    headInstant: false,
    mag: 32,
    reserve: 96,
    interval: 0.067,
    reload: 1.55,
    auto: true,
    scope: false,
    spread: 0.03,
    spreadAds: 0.016,
    recoilPitch: 0.008,
    recover: 8,
    pattern: [0, 0.01, -0.012, 0.014, -0.016, 0.012, -0.01, 0.015, -0.013, 0.008],
    range: 52,
  },
};

export function damageFor(weaponId, head) {
  const w = WEAPONS[weaponId];
  if (!w) return 0;
  if (weaponId === 'sniper') return 100;
  if (head && w.headInstant) return 100;
  if (head) return w.headDamage;
  return w.damage;
}

export function spreadOf(e) {
  const w = WEAPONS[e.weapon];
  if (!w) return 0.05;
  const speed = Math.hypot(e.vx || 0, e.vz || 0);
  let s = w.scope
    ? (e.ads && e.grounded && speed < 1.4 ? w.spreadAds : w.spread)
    : (e.ads ? w.spreadAds : w.spread);
  if (!e.grounded) s *= 2.5;
  else if (speed > 3.2) s *= 1.65;
  if (e.crouch && e.grounded) s *= 0.75;
  s += Math.min(0.08, (e.recoilP || 0) * 0.35);
  return s;
}

export function addRecoil(e) {
  const w = WEAPONS[e.weapon];
  const i = Math.max(0, e.shotIndex - 1) % w.pattern.length;
  e.recoilP = Math.min(0.28, e.recoilP + w.recoilPitch);
  e.recoilY += w.pattern[i];
}

export function weaponCard(id) {
  const w = WEAPONS[id];
  const shots = Math.ceil(100 / w.damage);
  let line = shots === 1
    ? 'Elimina de un disparo en cualquier parte.'
    : `Elimina en ${shots} disparos al cuerpo.`;
  if (w.headInstant) line += ' Cabeza: eliminación inmediata.';
  else if (id === 'uzi') line += ' Un tiro a la cabeza no basta.';
  line += ` Cargador de ${w.mag}.`;
  return { id, name: w.name, line };
}
