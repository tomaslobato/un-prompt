import { BTN, CROUCH_EYE, CROUCH_H, STAND_EYE, STAND_H } from '../shared/constants.js';
import { WAYPOINTS } from '../shared/map.js';
import { angleDiff, eyeOf, flatForward, flatRight, penetrates, rayWorld, supportHeight } from '../shared/physics.js';
import { WEAPONS } from '../shared/weapons.js';

const RANGE = {
  deagle: { min: 7, max: 16, shoot: 26 },
  sniper: { min: 16, max: 34, shoot: 64 },
  ak: { min: 9, max: 22, shoot: 38 },
  uzi: { min: 4.5, max: 12, shoot: 18 },
};

let openWays = null;

function waypoints() {
  if (openWays) return openWays;
  openWays = WAYPOINTS.filter((w) => {
    const y = supportHeight(w.x, w.z, 20);
    return !penetrates({ x: w.x, y, z: w.z, crouch: false, grounded: true, vy: 0 });
  });
  return openWays;
}

function sees(ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.25) return true;
  const hit = rayWorld({ x: ax, y: ay, z: az }, { x: dx / len, y: dy / len, z: dz / len }, len);
  return !hit || hit.t > len - 0.35;
}

export function thinkNpc(npc, humans, rng, aimError) {
  const living = humans.filter((h) => h.alive && h.connected !== false);
  const target = living[0] || humans.find((h) => h.connected !== false) || null;
  if (!npc.ai) {
    npc.ai = { strafe: 1, strafeT: 0, react: 0.45, errY: 0, errP: 0, way: null, wayT: 0 };
  }
  const ai = npc.ai;
  if (!target) return { yaw: npc.yaw, pitch: npc.pitch, seq: 0, buttons: 0 };

  const dx = target.x - npc.x;
  const dz = target.z - npc.z;
  const dist = Math.hypot(dx, dz) || 0.001;
  const eye = eyeOf(npc);
  const aimY = target.y + (target.crouch ? CROUCH_H : STAND_H) * 0.7;
  const los = target.alive && sees(eye.x, eye.y, eye.z, target.x, aimY, target.z);
  const pref = RANGE[npc.weapon] || RANGE.ak;

  ai.strafeT -= 1 / 60;
  if (ai.strafeT <= 0) {
    ai.strafe = rng() < 0.5 ? -1 : 1;
    ai.strafeT = 0.7 + rng() * 1.3;
    ai.errY = (rng() * 2 - 1) * aimError;
    ai.errP = (rng() * 2 - 1) * aimError * 0.65;
  }

  let gx = target.x;
  let gz = target.z;
  if (target.alive && (!los || dist > pref.max + 4)) {
    ai.wayT -= 1 / 60;
    if (!ai.way || ai.wayT <= 0) {
      let best = null;
      let bestScore = Infinity;
      const ways = waypoints();
      for (let i = 0; i < ways.length; i++) {
        const w = ways[i];
        const wy = supportHeight(w.x, w.z, 20) + STAND_EYE;
        if (!sees(eye.x, eye.y, eye.z, w.x, wy, w.z)) continue;
        const d1 = Math.hypot(npc.x - w.x, npc.z - w.z);
        const d2 = Math.hypot(target.x - w.x, target.z - w.z);
        const score = d1 + d2 * 1.15;
        if (score < bestScore) { bestScore = score; best = w; }
      }
      ai.way = best;
      ai.wayT = 1.1;
    }
    if (ai.way && Math.hypot(npc.x - ai.way.x, npc.z - ai.way.z) > 1.5) {
      gx = ai.way.x;
      gz = ai.way.z;
    }
  }

  let mx = 0;
  let mz = 0;
  if (!target.alive) {
    mx = 0;
    mz = 0;
  } else if (!los || dist > pref.max) {
    const ddx = gx - npc.x;
    const ddz = gz - npc.z;
    const dl = Math.hypot(ddx, ddz) || 1;
    mx = ddx / dl;
    mz = ddz / dl;
  } else if (dist < pref.min) {
    mx = -dx / dist;
    mz = -dz / dist;
  } else {
    mx = (-dz / dist) * ai.strafe;
    mz = (dx / dist) * ai.strafe;
    const mid = (pref.min + pref.max) * 0.5;
    const push = dist > mid ? -0.45 : 0.45;
    mx += (dx / dist) * push;
    mz += (dz / dist) * push;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
  }

  if (target.alive && Math.hypot(npc.vx, npc.vz) < 0.25 && (mx !== 0 || mz !== 0)) {
    ai.stuck = (ai.stuck || 0) + 1;
    if (ai.stuck > 20) {
      mx += ai.strafe;
      mz += 0.5;
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml;
      mz /= ml;
    }
  } else ai.stuck = 0;

  const wantYaw = Math.atan2(-dx, -dz);
  const wantPitch = Math.atan2(aimY - eye.y, dist);
  const yaw = wantYaw - npc.recoilY * 0.55 + (target.alive ? ai.errY : 0);
  const pitch = Math.max(-1.2, Math.min(1.2, wantPitch - npc.recoilP * 0.55 + (target.alive ? ai.errP : 0)));

  const f = flatForward(yaw);
  const rgt = flatRight(yaw);
  const localF = mx * f.x + mz * f.z;
  const localR = mx * rgt.x + mz * rgt.z;
  let buttons = 0;
  if (localF > 0.3) buttons |= BTN.F;
  else if (localF < -0.3) buttons |= BTN.B;
  if (localR > 0.3) buttons |= BTN.R;
  else if (localR < -0.3) buttons |= BTN.L;
  if (dist > pref.max || !los) buttons |= BTN.SPRINT;

  if (!los) ai.react = Math.max(ai.react, 0.2);
  else ai.react -= 1 / 60;

  const aligned = Math.abs(angleDiff(wantYaw, npc.yaw + npc.recoilY)) < 0.22
    && Math.abs(wantPitch - (npc.pitch + npc.recoilP)) < 0.2;
  const canShoot = target.alive && los && dist < pref.shoot && aligned && ai.react <= 0 && npc.reloadLeft <= 0 && npc.mag > 0;
  if (canShoot) {
    const semi = !WEAPONS[npc.weapon].auto;
    if (!semi || ((npc.prevButtons & BTN.FIRE) === 0 && npc.shotCooldown <= 1e-4)) buttons |= BTN.FIRE;
  }
  if (npc.weapon === 'sniper' && los && dist > 8) buttons |= BTN.ADS;
  if (npc.mag === 0 && npc.reserve > 0) buttons |= BTN.RELOAD;

  return { yaw, pitch, seq: 0, buttons };
}
