import {
  CROUCH_EYE,
  CROUCH_H,
  CROUCH_SPEED,
  GRAVITY,
  JUMP_V,
  PLAYER_RADIUS,
  SPEED_CAP,
  SPRINT_SPEED,
  STAND_EYE,
  STAND_H,
  STEP_H,
  WALK_SPEED,
  BTN,
} from './constants.js';
import { BOXES, PLAY_MAX, PLAY_MIN, RAMPS } from './map.js';

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function flatForward(yaw) {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

export function flatRight(yaw) {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

export function lookVector(yaw, pitch) {
  const cp = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cp,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cp,
  };
}

export function angleDiff(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

export function norm(x, y, z) {
  const l = Math.hypot(x, y, z);
  if (l < 1e-8) return { x: 0, y: 0, z: -1 };
  return { x: x / l, y: y / l, z: z / l };
}

export function bodyHeight(e) {
  return e.crouch ? CROUCH_H : STAND_H;
}

export function eyeOf(e) {
  return {
    x: e.x,
    y: e.y + (e.crouch ? CROUCH_EYE : STAND_EYE),
    z: e.z,
  };
}

export function rampSurface(r, x, z) {
  if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) return null;
  const span = r.along === 'z' ? r.maxZ - r.minZ : r.maxX - r.minX;
  if (span <= 0) return null;
  const u = r.along === 'z' ? (z - r.minZ) / span : (x - r.minX) / span;
  return r.highAt === 'min'
    ? r.yHigh + (r.yLow - r.yHigh) * u
    : r.yLow + (r.yHigh - r.yLow) * u;
}

export function supportHeight(x, z, feetY) {
  let g = 0;
  const limit = feetY + STEP_H;
  for (let i = 0; i < BOXES.length; i++) {
    const b = BOXES[i];
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    if (b.maxY <= limit && b.maxY >= g) g = b.maxY;
  }
  for (let i = 0; i < RAMPS.length; i++) {
    const h = rampSurface(RAMPS[i], x, z);
    if (h != null && h <= limit && h >= g) g = h;
  }
  return g;
}

function pushOutOfRect(e, minX, maxX, minZ, maxZ) {
  const left = e.x - minX;
  const right = maxX - e.x;
  const back = e.z - minZ;
  const front = maxZ - e.z;
  const m = Math.min(left, right, back, front);
  const R = PLAYER_RADIUS + 0.001;
  if (m === left) e.x = minX - R;
  else if (m === right) e.x = maxX + R;
  else if (m === back) e.z = minZ - R;
  else e.z = maxZ + R;
}

function pushBoxes(e) {
  const R = PLAYER_RADIUS;
  const height = bodyHeight(e);
  let pushed = false;
  for (let i = 0; i < BOXES.length; i++) {
    const b = BOXES[i];
    const feet = e.y;
    const head = e.y + height;
    if (head <= b.minY + 0.001) continue;
    if (feet >= b.maxY - 0.05) continue;
    if (e.grounded && e.vy <= 0 && feet >= b.maxY - STEP_H) continue;
    const cx = clamp(e.x, b.minX, b.maxX);
    const cz = clamp(e.z, b.minZ, b.maxZ);
    const dx = e.x - cx;
    const dz = e.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= R * R) continue;
    pushed = true;
    if (d2 < 1e-10) pushOutOfRect(e, b.minX, b.maxX, b.minZ, b.maxZ);
    else {
      const d = Math.sqrt(d2);
      const push = R - d + 0.001;
      e.x += (dx / d) * push;
      e.z += (dz / d) * push;
    }
  }
  return pushed;
}

function pushRamps(e) {
  const R = PLAYER_RADIUS;
  let pushed = false;
  for (let i = 0; i < RAMPS.length; i++) {
    const r = RAMPS[i];
    const cx = clamp(e.x, r.minX, r.maxX);
    const cz = clamp(e.z, r.minZ, r.maxZ);
    const dx = e.x - cx;
    const dz = e.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= R * R) continue;
    const h = rampSurface(r, cx, cz);
    if (h == null) continue;
    if (e.y >= h - 0.15) continue;
    if (e.grounded && e.vy <= 0 && e.y >= h - STEP_H) continue;
    pushed = true;
    if (d2 < 1e-10) pushOutOfRect(e, r.minX, r.maxX, r.minZ, r.maxZ);
    else {
      const d = Math.sqrt(d2);
      const push = R - d + 0.001;
      e.x += (dx / d) * push;
      e.z += (dz / d) * push;
    }
  }
  return pushed;
}

export function penetrates(e) {
  const R = PLAYER_RADIUS * 0.75;
  const head = e.y + bodyHeight(e);
  for (let i = 0; i < BOXES.length; i++) {
    const b = BOXES[i];
    if (head <= b.minY + 0.02) continue;
    if (e.y >= b.maxY - 0.08) continue;
    const cx = clamp(e.x, b.minX, b.maxX);
    const cz = clamp(e.z, b.minZ, b.maxZ);
    const dx = e.x - cx;
    const dz = e.z - cz;
    if (dx * dx + dz * dz >= R * R) continue;
    if (e.grounded && e.y >= b.maxY - STEP_H) continue;
    return true;
  }
  for (let i = 0; i < RAMPS.length; i++) {
    const h = rampSurface(RAMPS[i], e.x, e.z);
    if (h == null) continue;
    if (e.y < h - 0.25 && !(e.grounded && e.y >= h - STEP_H)) return true;
  }
  return false;
}

function collide(e) {
  for (let i = 0; i < 4; i++) {
    const a = pushBoxes(e);
    const b = pushRamps(e);
    if (!a && !b) break;
  }
}

export function moveActor(e, buttons) {
  const dt = e._dt;
  const crouch = (buttons & BTN.CROUCH) !== 0;
  e.crouch = crouch;
  e.ads = (buttons & BTN.ADS) !== 0;
  const sprint = (buttons & BTN.SPRINT) !== 0 && !crouch && (buttons & BTN.F) !== 0 && (buttons & BTN.B) === 0;
  let speed = crouch ? CROUCH_SPEED : sprint ? SPRINT_SPEED : WALK_SPEED;
  if (e.ads) speed *= 0.75;

  const f = flatForward(e.yaw);
  const r = flatRight(e.yaw);
  let wx = 0;
  let wz = 0;
  if (buttons & BTN.F) { wx += f.x; wz += f.z; }
  if (buttons & BTN.B) { wx -= f.x; wz -= f.z; }
  if (buttons & BTN.R) { wx += r.x; wz += r.z; }
  if (buttons & BTN.L) { wx -= r.x; wz -= r.z; }
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }

  const accel = e.grounded ? 70 : 14;
  const k = 1 - Math.exp(-accel * dt);
  e.vx += (wx * speed - e.vx) * k;
  e.vz += (wz * speed - e.vz) * k;
  if (e.grounded && wx === 0 && wz === 0) {
    const fr = Math.exp(-10 * dt);
    e.vx *= fr;
    e.vz *= fr;
  }
  const hs = Math.hypot(e.vx, e.vz);
  if (hs > SPEED_CAP) {
    e.vx = (e.vx / hs) * SPEED_CAP;
    e.vz = (e.vz / hs) * SPEED_CAP;
  }

  e.x += e.vx * dt;
  collide(e);
  e.z += e.vz * dt;
  collide(e);

  const jump = (buttons & BTN.JUMP) !== 0 && (e.prevButtons & BTN.JUMP) === 0;
  if (jump && e.grounded) {
    e.vy = JUMP_V;
    e.grounded = false;
    e.y += 0.02;
  }

  if (!e.grounded) {
    e.vy -= GRAVITY * dt;
    if (e.vy < -32) e.vy = -32;
    e.y += e.vy * dt;
  }

  const g = supportHeight(e.x, e.z, e.y);
  if (e.vy <= 0 && g >= e.y && g - e.y <= STEP_H) {
    e.y = g;
    e.vy = 0;
    e.grounded = true;
  } else if (e.vy <= 0 && e.y <= g + 0.03) {
    e.y = g;
    e.vy = 0;
    e.grounded = true;
  } else if (e.y > g + 0.05) {
    e.grounded = false;
  } else {
    e.y = g;
    e.vy = 0;
    e.grounded = true;
  }

  e.x = clamp(e.x, PLAY_MIN + PLAYER_RADIUS, PLAY_MAX - PLAYER_RADIUS);
  e.z = clamp(e.z, PLAY_MIN + PLAYER_RADIUS, PLAY_MAX - PLAYER_RADIUS);
  if (e.y < -2 || e.y > 20) {
    e.y = 0;
    e.vy = 0;
    e.grounded = true;
  }

  if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.z)) {
    e.x = e.safeX || 0;
    e.y = e.safeY || 0;
    e.z = e.safeZ || 0;
    e.vx = e.vy = e.vz = 0;
    return;
  }

  if (penetrates(e)) {
    e.x = e.safeX;
    e.y = e.safeY;
    e.z = e.safeZ;
    e.vx = e.vy = e.vz = 0;
    e.grounded = true;
    if (penetrates(e)) {
      e.x = 0;
      e.z = 0;
      e.y = supportHeight(0, 0, 4);
    }
  } else if (e.grounded) {
    e.safeX = e.x;
    e.safeY = e.y;
    e.safeZ = e.z;
  }
}

export function hitboxes(a) {
  const h = bodyHeight(a);
  const headR = 0.18;
  const headY = a.y + h - headR * 0.85;
  return {
    head: { x: a.x, y: headY, z: a.z },
    headR,
    a: { x: a.x, y: a.y + 0.28, z: a.z },
    b: { x: a.x, y: headY - headR - 0.02, z: a.z },
    bodyR: 0.3,
  };
}

export function raySphere(o, d, c, r) {
  const ocx = o.x - c.x;
  const ocy = o.y - c.y;
  const ocz = o.z - c.z;
  const b = ocx * d.x + ocy * d.y + ocz * d.z;
  const c2 = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
  const h = b * b - c2;
  if (h < 0) return null;
  const s = Math.sqrt(h);
  const t0 = -b - s;
  if (t0 > 1e-4) return t0;
  const t1 = -b + s;
  if (t1 > 1e-4) return t1;
  return null;
}

export function rayCapsule(o, d, a, b, r) {
  const bax = b.x - a.x;
  const bay = b.y - a.y;
  const baz = b.z - a.z;
  const oax = o.x - a.x;
  const oay = o.y - a.y;
  const oaz = o.z - a.z;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * d.x + bay * d.y + baz * d.z;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = d.x * oax + d.y * oay + d.z * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const aa = baba - bard * bard;
  const bb = baba * rdoa - baoa * bard;
  const cc = baba * oaoa - baoa * baoa - r * r * baba;
  const hh = bb * bb - aa * cc;
  if (hh >= 0 && Math.abs(aa) > 1e-8) {
    const t = (-bb - Math.sqrt(hh)) / aa;
    const y = baoa + t * bard;
    if (t > 1e-4 && y > 0 && y < baba) return t;
  }
  const capA = raySphere(o, d, a, r);
  const capB = raySphere(o, d, b, r);
  if (capA == null) return capB;
  if (capB == null) return capA;
  return Math.min(capA, capB);
}

function aabbInterval(o, d, min, max, maxT) {
  let t0 = 0;
  let t1 = maxT;
  const oxyz = [o.x, o.y, o.z];
  const dxyz = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dxyz[i]) < 1e-8) {
      if (oxyz[i] < min[i] || oxyz[i] > max[i]) return null;
      continue;
    }
    let a = (min[i] - oxyz[i]) / dxyz[i];
    let b = (max[i] - oxyz[i]) / dxyz[i];
    if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t1 < t0) return null;
  }
  if (t1 < 0) return null;
  return [t0, t1];
}

export function rayWorld(o, d, maxT) {
  let best = null;
  if (d.y < -1e-6) {
    const t = -o.y / d.y;
    if (t > 1e-3 && t < maxT) best = { t, type: 'wall' };
  }
  for (let i = 0; i < BOXES.length; i++) {
    const b = BOXES[i];
    const iv = aabbInterval(o, d, [b.minX, b.minY, b.minZ], [b.maxX, b.maxY, b.maxZ], maxT);
    if (!iv) continue;
    const t = iv[0] > 1e-3 ? iv[0] : (iv[1] > 1e-3 && iv[0] < 0 ? null : iv[0]);
    if (t == null || t <= 1e-3 || t >= maxT) continue;
    if (!best || t < best.t) best = { t, type: 'wall' };
  }
  for (let i = 0; i < RAMPS.length; i++) {
    const r = RAMPS[i];
    const top = Math.max(r.yLow, r.yHigh);
    const iv = aabbInterval(o, d, [r.minX, 0, r.minZ], [r.maxX, top, r.maxZ], maxT);
    if (!iv) continue;
    const start = Math.max(0, iv[0]);
    const end = Math.min(maxT, iv[1]);
    if (end < start) continue;
    const steps = Math.max(1, Math.ceil((end - start) / 0.12));
    for (let s = 0; s <= steps; s++) {
      const t = start + ((end - start) * s) / steps;
      if (t <= 1e-3) continue;
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      const z = o.z + d.z * t;
      const h = rampSurface(r, x, z);
      if (h != null && y >= -0.01 && y <= h + 0.02) {
        if (!best || t < best.t) best = { t, type: 'wall' };
        break;
      }
    }
  }
  return best;
}

export function traceShot(origin, dir, actors, excludeId, maxDist) {
  const d = norm(dir.x, dir.y, dir.z);
  let bestT = maxDist;
  let best = null;
  const wall = rayWorld(origin, d, maxDist);
  if (wall && wall.t < bestT) {
    bestT = wall.t;
    best = {
      type: 'wall',
      t: wall.t,
      head: false,
      actor: null,
      point: { x: origin.x + d.x * wall.t, y: origin.y + d.y * wall.t, z: origin.z + d.z * wall.t },
    };
  }
  for (let i = 0; i < actors.length; i++) {
    const a = actors[i];
    if (!a || a.id === excludeId || !a.alive) continue;
    const hb = hitboxes(a);
    const th = raySphere(origin, d, hb.head, hb.headR);
    const tb = rayCapsule(origin, d, hb.a, hb.b, hb.bodyR);
    let t = null;
    let head = false;
    if (th != null && th < bestT) { t = th; head = true; }
    if (tb != null && tb < bestT) {
      if (t == null || tb < t - 0.05) {
        t = tb;
        head = false;
      } else if (Math.abs(tb - t) <= 0.08) {
        t = Math.min(tb, t);
        head = true;
      }
    }
    if (t != null && t < bestT) {
      bestT = t;
      best = {
        type: 'actor',
        t,
        head,
        actor: a,
        point: { x: origin.x + d.x * t, y: origin.y + d.y * t, z: origin.z + d.z * t },
      };
    }
  }
  return best;
}

export function offsetCone(dir, spread, rnd) {
  if (!(spread > 0)) return norm(dir.x, dir.y, dir.z);
  const theta = Math.PI * 2 * rnd();
  const radius = spread * Math.sqrt(rnd());
  const up = Math.abs(dir.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let rx = dir.y * up.z - dir.z * up.y;
  let ry = dir.z * up.x - dir.x * up.z;
  let rz = dir.x * up.y - dir.y * up.x;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  const ux = ry * dir.z - rz * dir.y;
  const uy = rz * dir.x - rx * dir.z;
  const uz = rx * dir.y - ry * dir.x;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return norm(
    dir.x + (rx * c + ux * s) * radius,
    dir.y + (ry * c + uy * s) * radius,
    dir.z + (rz * c + uz * s) * radius,
  );
}
