import { DT, BTN } from './constants.js';
import { WEAPONS, addRecoil } from './weapons.js';
import { moveActor } from './physics.js';

export function applyInput(e, input, dt = DT) {
  if (!e.alive) {
    e.vx = 0;
    e.vz = 0;
    e.vy = 0;
    e.prevButtons = input.buttons | 0;
    return { didShoot: false };
  }

  e.yaw = input.yaw;
  e.pitch = input.pitch;
  const buttons = input.buttons | 0;
  const w = WEAPONS[e.weapon];
  let didShoot = false;

  if (e.reloadLeft > 0) {
    e.reloadLeft -= dt;
    if (e.reloadLeft <= 0) {
      e.reloadLeft = 0;
      const need = w.mag - e.mag;
      const take = Math.min(need, e.reserve);
      e.mag += take;
      e.reserve -= take;
    }
  }

  if (e.shotCooldown > 0) e.shotCooldown = Math.max(0, e.shotCooldown - dt);

  const decay = Math.exp(-w.recover * dt);
  e.recoilP *= decay;
  e.recoilY *= decay;
  if (e.recoilP < 1e-4) e.recoilP = 0;
  if (Math.abs(e.recoilY) < 1e-4) e.recoilY = 0;

  const fireHeld = (buttons & BTN.FIRE) !== 0;
  const fireEdge = fireHeld && (e.prevButtons & BTN.FIRE) === 0;
  const want = e.reloadLeft <= 0 && (w.auto ? fireHeld : fireEdge);

  if (want && e.shotCooldown <= 1e-4 && e.mag > 0) {
    didShoot = true;
    e.mag -= 1;
    e.shotCooldown = w.interval;
    e.shotIndex += 1;
    e._shotRecoilP = e.recoilP;
    e._shotRecoilY = e.recoilY;
    addRecoil(e);
    e.spawnShield = 0;
  } else if (want && e.mag === 0 && e.reserve > 0 && e.reloadLeft <= 0) {
    e.reloadLeft = w.reload;
  }

  const reloadEdge = (buttons & BTN.RELOAD) !== 0 && (e.prevButtons & BTN.RELOAD) === 0;
  if (reloadEdge && e.reloadLeft <= 0 && e.mag < w.mag && e.reserve > 0 && !didShoot) {
    e.reloadLeft = w.reload;
  }

  if (e.spawnShield > 0) e.spawnShield = Math.max(0, e.spawnShield - dt);

  e._dt = dt;
  moveActor(e, buttons);
  e.prevButtons = buttons;
  return { didShoot };
}
