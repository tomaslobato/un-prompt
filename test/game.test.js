import assert from 'node:assert/strict';
import test from 'node:test';
import { WebSocket } from 'ws';
import { Arena } from '../server/arena.js';
import { createGameServer } from '../server/index.js';
import { BTN } from '../shared/constants.js';
import { SPAWNS } from '../shared/map.js';
import { eyeOf, hitboxes, penetrates, supportHeight, traceShot } from '../shared/physics.js';
import { sanitizeHello, sanitizeName } from '../shared/sanitize.js';
import { damageFor, weaponCard, WEAPONS } from '../shared/weapons.js';

function plant(p, x, z, yaw = 0) {
  p.x = x;
  p.z = z;
  p.yaw = yaw;
  p.y = supportHeight(x, z, 20);
  p.vx = p.vy = p.vz = 0;
  p.grounded = true;
  p.safeX = p.x;
  p.safeY = p.y;
  p.safeZ = p.z;
  p.spawnShield = 0;
}

function aimAt(shooter, x, y, z) {
  const eye = eyeOf(shooter);
  const dx = x - eye.x;
  const dy = y - eye.y;
  const dz = z - eye.z;
  return {
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.atan2(dy, Math.hypot(dx, dz)),
  };
}

function arena(opts = {}) {
  return new Arena({ npcs: false, perfectAim: true, random: () => 0.25, ...opts });
}

function hold(a, id, yaw, pitch, buttons, ticks, seqStart = 1) {
  let seq = seqStart;
  for (let i = 0; i < ticks; i++) {
    a.pushInput(id, { yaw, pitch, seq: seq++, b: buttons });
    a.step();
  }
  return seq;
}

test('nombres seguros', () => {
  assert.equal(sanitizeName('Ana'), 'Ana');
  assert.equal(sanitizeName('  José  '), 'José');
  assert.equal(sanitizeName('a'), null);
  assert.equal(sanitizeName('<script>alert(1)</script>'), null);
  assert.equal(sanitizeName('nombre-demasiado-largo'), null);
  assert.equal(sanitizeName('ok name'), 'ok name');
  assert.equal(sanitizeName('Sombra').error, 'reserved');
  assert.equal(sanitizeName('buitre').error, 'reserved');
  assert.equal(sanitizeName(12), null);
  assert.equal(sanitizeHello({ t: 'hello', v: 1, name: 'Ana', skin: 'ct', weapon: 'ak' }).name, 'Ana');
  assert.equal(sanitizeHello({ t: 'hello', v: 1, name: 'Ana', skin: 'x', weapon: 'ak' }).error, 'bad');
  assert.equal(sanitizeHello({ t: 'hello', v: 2, name: 'Ana', skin: 't', weapon: 'ak' }).error, 'version');
  assert.equal(Object.prototype.polluted, undefined);
});

test('daño exacto de las armas', () => {
  assert.equal(Math.ceil(100 / WEAPONS.deagle.damage), 2);
  assert.equal(Math.ceil(100 / WEAPONS.sniper.damage), 1);
  assert.equal(Math.ceil(100 / WEAPONS.ak.damage), 3);
  assert.equal(Math.ceil(100 / WEAPONS.uzi.damage), 6);
  assert.equal(damageFor('deagle', false), 50);
  assert.equal(damageFor('deagle', true), 100);
  assert.equal(damageFor('ak', false), 34);
  assert.equal(damageFor('ak', true), 100);
  assert.equal(damageFor('sniper', false), 100);
  assert.equal(damageFor('uzi', false), 17);
  assert.equal(damageFor('uzi', true), 34);
  assert.match(weaponCard('ak').line, /3 disparos/);
  assert.match(weaponCard('uzi').line, /6 disparos/);
  assert.match(weaponCard('deagle').line, /inmediata/);
  assert.match(weaponCard('sniper').line, /un disparo/);
});

test('los spawns no están dentro de la geometría', () => {
  for (const s of SPAWNS) {
    const y = supportHeight(s.x, s.z, 30);
    const dummy = { x: s.x, y, z: s.z, crouch: false, grounded: true, vy: 0 };
    assert.equal(penetrates(dummy), false, `${s.x},${s.z} y=${y}`);
  }
  assert.equal(supportHeight(0, 26, 30), 3.5);
});

test('rayos a cabeza, cuerpo, muro y rampa', () => {
  const shooter = { id: 1, x: 0, y: 0, z: 0, crouch: false, alive: true };
  const target = { id: 2, x: 0, y: 0, z: -8, crouch: false, alive: true };
  const eye = eyeOf(shooter);
  const head = aimAt(shooter, target.x, hitboxes(target).head.y, target.z);
  const body = aimAt(shooter, target.x, target.y + 0.9, target.z);
  const headHit = traceShot(eye, { x: -Math.sin(head.yaw) * Math.cos(head.pitch), y: Math.sin(head.pitch), z: -Math.cos(head.yaw) * Math.cos(head.pitch) }, [target], 1, 40);
  const bodyDir = { x: -Math.sin(body.yaw) * Math.cos(body.pitch), y: Math.sin(body.pitch), z: -Math.cos(body.yaw) * Math.cos(body.pitch) };
  const bodyHit = traceShot(eye, bodyDir, [target], 1, 40);
  assert.equal(headHit?.head, true, 'cabeza');
  assert.equal(bodyHit?.type, 'actor');
  assert.equal(bodyHit?.head, false, 'cuerpo');

  const crouched = { ...target, crouch: true };
  const miss = traceShot(eye, { x: 0, y: 0, z: -1 }, [crouched], 1, 40);
  assert.equal(miss, null);

  const behind = { id: 3, x: -20, y: 0, z: -44, crouch: false, alive: true };
  const coverEye = { x: -20, y: 1.58, z: -30 };
  const cover = traceShot(coverEye, { x: 0, y: 0, z: -1 }, [behind], 1, 40);
  assert.equal(cover?.type, 'wall');

  const over = traceShot({ x: 0, y: 6, z: 42 }, { x: 0, y: 0, z: -1 }, [], 0, 30);
  assert.equal(over, null);
  const into = traceShot({ x: 0, y: 1.2, z: 43 }, { x: 0, y: 0, z: -1 }, [], 0, 30);
  assert.equal(into?.type, 'wall');
});

test('movimiento: velocidad, muros, rampa, escaleras y cajas', () => {
  const a = arena();
  const p = a.addPlayer({ name: 'Ana', skin: 't', weapon: 'ak' });
  plant(p, 0, -20, -Math.PI / 2);
  hold(a, p.id, -Math.PI / 2, 0, BTN.F, 60);
  const walked = p.x - 0;
  assert.ok(walked > 3.6 && walked < 5.3, `camina ${walked}`);

  const b = arena();
  const q = b.addPlayer({ name: 'Bea', skin: 'ct', weapon: 'ak' });
  plant(q, -10, -20, -Math.PI / 2);
  hold(b, q.id, -Math.PI / 2, 0, BTN.F | BTN.SPRINT, 60);
  const ran = q.x - (-10);
  assert.ok(ran > 5.4 && ran < 7.2, `corre ${ran}`);

  const c = arena();
  const r = c.addPlayer({ name: 'Cio', skin: 't', weapon: 'ak' });
  plant(r, 30, -20, -Math.PI / 2);
  hold(c, r.id, -Math.PI / 2, 0, BTN.F | BTN.SPRINT, 180);
  assert.ok(r.x < 45.9 && r.x > 44.5, `muro ${r.x}`);
  assert.equal(penetrates(r), false);

  const d = arena();
  const s = d.addPlayer({ name: 'Dio', skin: 't', weapon: 'ak' });
  plant(s, 0, 42, 0);
  hold(d, s.id, 0, 0, BTN.F, 180);
  assert.ok(s.y > 3 && s.z < 36, `rampa y=${s.y} z=${s.z}`);

  const e = arena();
  const t = e.addPlayer({ name: 'Eva', skin: 'ct', weapon: 'ak' });
  plant(t, 8, 40, 0);
  hold(e, t.id, 0, 0, BTN.L, 90);
  assert.ok(t.x > 4.15, `atraviesa rampa x=${t.x}`);
  assert.ok(t.y < 0.4, `sube de lado y=${t.y}`);

  const f = arena();
  const u = f.addPlayer({ name: 'Fae', skin: 't', weapon: 'ak' });
  plant(u, 0, 14, Math.PI);
  hold(f, u.id, Math.PI, 0, BTN.F, 90);
  assert.ok(u.z < 17.9 && u.y < 0.6, `plataforma z=${u.z} y=${u.y}`);

  const g = arena();
  const v = g.addPlayer({ name: 'Geo', skin: 't', weapon: 'ak' });
  plant(v, -39, 8, Math.PI);
  hold(g, v.id, Math.PI, 0, BTN.F, 240);
  assert.ok(v.y > 1.4, `escaleras y=${v.y} z=${v.z}`);

  const h = arena();
  const w = h.addPlayer({ name: 'Hua', skin: 'ct', weapon: 'ak' });
  w.x = -5;
  w.z = 11;
  w.y = 3;
  w.vy = 0;
  w.grounded = false;
  w.safeX = 0;
  w.safeY = 0;
  w.safeZ = -20;
  w.spawnShield = 0;
  hold(h, w.id, 0, 0, 0, 80);
  assert.ok(Math.abs(w.y - 1) < 0.05, `caja y=${w.y}`);

  const i = arena();
  const zed = i.addPlayer({ name: 'Ivo', skin: 't', weapon: 'ak' });
  plant(zed, -20, 1, Math.PI);
  let seq = 1;
  for (let n = 0; n < 120; n++) {
    const jump = n % 20 === 0 ? BTN.JUMP : 0;
    i.pushInput(zed.id, { yaw: 0, pitch: 0, seq: seq++, b: BTN.F | jump });
    i.step();
  }
  assert.ok(zed.y < 1.2, `contenedor y=${zed.y}`);
});

function blast(a, shooter, target, y, shots) {
  shooter.spawnShield = 0;
  let seq = shooter.lastSeq;
  for (let n = 0; n < shots; n++) {
    const aim = aimAt(shooter, target.x, y, target.z);
    shooter.recoilP = 0;
    shooter.recoilY = 0;
    shooter.shotCooldown = 0;
    a.pushInput(shooter.id, { yaw: aim.yaw, pitch: aim.pitch, seq: ++seq, b: 0 });
    a.step();
    shooter.recoilP = 0;
    shooter.recoilY = 0;
    shooter.shotCooldown = 0;
    a.pushInput(shooter.id, { yaw: aim.yaw, pitch: aim.pitch, seq: ++seq, b: BTN.FIRE });
    a.step();
    if (!target.alive) break;
  }
}

test('impactos, cadencia, recarga y escudo', () => {
  const a = arena();
  const s = a.addPlayer({ name: 'Sol', skin: 't', weapon: 'deagle' });
  const v = a.addPlayer({ name: 'Vega', skin: 'ct', weapon: 'ak' });
  plant(s, 0, 0, 0);
  plant(v, 0, -8, 0);
  blast(a, s, v, hitboxes(v).head.y, 1);
  assert.equal(v.hp, 0);

  const a2 = arena();
  const s2 = a2.addPlayer({ name: 'Sol', skin: 't', weapon: 'deagle' });
  const v2 = a2.addPlayer({ name: 'Vega', skin: 'ct', weapon: 'ak' });
  plant(s2, 0, 0, 0);
  plant(v2, 0, -8, 0);
  blast(a2, s2, v2, v2.y + 0.9, 1);
  assert.equal(v2.hp, 50);
  blast(a2, s2, v2, v2.y + 0.9, 1);
  assert.equal(v2.hp, 0);

  const a3 = arena();
  const s3 = a3.addPlayer({ name: 'Sol', skin: 't', weapon: 'ak' });
  const v3 = a3.addPlayer({ name: 'Vega', skin: 'ct', weapon: 'ak' });
  plant(s3, 0, 0, 0);
  plant(v3, 0, -8, 0);
  blast(a3, s3, v3, v3.y + 0.9, 2);
  assert.equal(v3.alive, true);
  assert.equal(v3.hp, 32);
  blast(a3, s3, v3, v3.y + 0.9, 1);
  assert.equal(v3.hp, 0);

  const a4 = arena();
  const s4 = a4.addPlayer({ name: 'Sol', skin: 't', weapon: 'ak' });
  const v4 = a4.addPlayer({ name: 'Vega', skin: 'ct', weapon: 'ak' });
  plant(s4, 0, 0, 0);
  plant(v4, 0, -8, 0);
  blast(a4, s4, v4, hitboxes(v4).head.y, 1);
  assert.equal(v4.hp, 0);

  const a5 = arena();
  const s5 = a5.addPlayer({ name: 'Sol', skin: 't', weapon: 'sniper' });
  const v5 = a5.addPlayer({ name: 'Vega', skin: 'ct', weapon: 'ak' });
  plant(s5, 0, 0, 0);
  plant(v5, 0, -8, 0);
  blast(a5, s5, v5, v5.y + 0.9, 1);
  assert.equal(v5.hp, 0);

  const a6 = arena();
  const s6 = a6.addPlayer({ name: 'Sol', skin: 't', weapon: 'uzi' });
  const v6 = a6.addPlayer({ name: 'Vega', skin: 'ct', weapon: 'ak' });
  plant(s6, 0, 0, 0);
  plant(v6, 0, -8, 0);
  blast(a6, s6, v6, v6.y + 0.9, 5);
  assert.equal(v6.hp, 15);
  blast(a6, s6, v6, v6.y + 0.9, 1);
  assert.equal(v6.hp, 0);

  const a7 = arena();
  const s7 = a7.addPlayer({ name: 'Sol', skin: 't', weapon: 'uzi' });
  const v7 = a7.addPlayer({ name: 'Vega', skin: 'ct', weapon: 'ak' });
  plant(s7, 0, 0, 0);
  plant(v7, 0, -8, 0);
  blast(a7, s7, v7, hitboxes(v7).head.y, 1);
  assert.equal(v7.hp, 66);
  assert.equal(v7.alive, true);

  const rate = arena();
  const gun = rate.addPlayer({ name: 'Sol', skin: 't', weapon: 'ak' });
  plant(gun, 0, -20, 0);
  const mag0 = gun.mag;
  hold(rate, gun.id, 0, 0, BTN.FIRE, 60);
  const akShots = mag0 - gun.mag;
  assert.ok(akShots >= 8 && akShots <= 12, `ak ${akShots}`);

  const semi = arena();
  const deag = semi.addPlayer({ name: 'Sol', skin: 't', weapon: 'deagle' });
  plant(deag, 0, -20, 0);
  hold(semi, deag.id, 0, 0, BTN.FIRE, 60);
  assert.equal(7 - deag.mag, 1);

  const smg = arena();
  const uzi = smg.addPlayer({ name: 'Sol', skin: 't', weapon: 'uzi' });
  plant(uzi, 0, -20, 0);
  hold(smg, uzi.id, 0, 0, BTN.FIRE, 60);
  const uziShots = 32 - uzi.mag;
  assert.ok(uziShots >= 12 && uziShots <= 17, `uzi ${uziShots}`);

  const rel = arena();
  const loader = rel.addPlayer({ name: 'Sol', skin: 't', weapon: 'deagle' });
  plant(loader, 0, -20, 0);
  loader.mag = 0;
  loader.reserve = 10;
  rel.pushInput(loader.id, { yaw: 0, pitch: 0, seq: 1, b: BTN.RELOAD });
  rel.step();
  for (let i = 0; i < 40; i++) {
    rel.pushInput(loader.id, { yaw: 0, pitch: 0, seq: i + 2, b: BTN.FIRE });
    rel.step();
  }
  assert.equal(loader.mag, 0);
  for (let i = 0; i < 90; i++) rel.step();
  assert.equal(loader.mag, 7);
  assert.equal(loader.reserve, 3);

  const sh = arena();
  const atk = sh.addPlayer({ name: 'Sol', skin: 't', weapon: 'sniper' });
  const vic = sh.addPlayer({ name: 'Vega', skin: 'ct', weapon: 'ak' });
  plant(atk, 0, 0, 0);
  plant(vic, 0, -8, 0);
  vic.spawnShield = 2;
  blast(sh, atk, vic, vic.y + 0.9, 1);
  assert.equal(vic.hp, 100);
});

test('un jugador genera dos NPCs y dos jugadores no', () => {
  const a = new Arena({ random: () => 0.2, npcAimError: 0 });
  const p = a.addPlayer({ name: 'Ana', skin: 't', weapon: 'ak' });
  a.step();
  assert.equal(a.npcs.size, 2);
  const names = [...a.npcs.values()].map((n) => n.name).sort();
  assert.deepEqual(names, ['Buitre', 'Sombra']);
  const q = a.addPlayer({ name: 'Bea', skin: 'ct', weapon: 'uzi' });
  a.step();
  assert.equal(a.npcs.size, 0);
  a.removePlayer(q.id);
  a.step();
  assert.equal(a.npcs.size, 2);

  const fight = new Arena({ random: () => 0.99, npcAimError: 0, perfectAim: true });
  const hero = fight.addPlayer({ name: 'Ana', skin: 'ct', weapon: 'ak' });
  fight.step();
  plant(hero, 0, -20, 0);
  let index = 0;
  for (const npc of fight.npcs.values()) {
    plant(npc, index === 0 ? 2 : -2, -14, 0);
    npc.spawnShield = 0;
    index += 1;
  }
  for (let i = 0; i < 240; i++) fight.step();
  assert.ok(hero.hp < 100, `los NPC no hicieron daño, hp=${hero.hp}`);

  const keep = new Arena({ random: () => 0.4, npcAimError: 0 });
  const solo = keep.addPlayer({ name: 'Ana', skin: 't', weapon: 'ak' });
  keep.step();
  const npc = [...keep.npcs.values()][0];
  npc.weapon = 'sniper';
  npc.mag = 0;
  npc.reserve = 0;
  plant(solo, 0, -20, 0);
  plant(npc, 0, -16, 0);
  for (let i = 0; i < 200; i++) keep.step();
  const dist = Math.hypot(npc.x - solo.x, npc.z - solo.z);
  assert.ok(dist > 8, `distancia ${dist}`);
});

test('el servidor ignora posición y entrada inválida', () => {
  const a = arena();
  const p = a.addPlayer({ name: 'Ana', skin: 't', weapon: 'ak' });
  plant(p, 0, -20, 0);
  const x = p.x;
  assert.equal(a.pushInput(p.id, { x: 999, y: 40, yaw: 0, pitch: 0, seq: 1, b: 0 }), 'ok');
  a.step();
  assert.ok(Math.abs(p.x - x) < 0.25, p.x);
  assert.equal(a.pushInput(p.id, { yaw: Number.NaN, pitch: 0, seq: 2, b: 0 }), 'bad');
  assert.equal(a.pushInput(p.id, { yaw: 0, pitch: 0, seq: 1, b: 0 }), 'old');
  const full = arena();
  for (let i = 0; i < 10; i++) {
    const added = full.addPlayer({ name: `P${i}a`, skin: 't', weapon: 'ak' });
    assert.equal(typeof added.id, 'number');
  }
  assert.equal(full.addPlayer({ name: 'Otro', skin: 't', weapon: 'ak' }).error, 'full');
  assert.equal(full.addPlayer({ name: 'P0a', skin: 'ct', weapon: 'uzi' }).error, 'taken');
});

function watch(ws) {
  ws.inbox = [];
  ws.cursor = 0;
  ws.on('error', () => {});
  ws.on('message', (buf) => {
    try { ws.inbox.push(JSON.parse(buf.toString())); } catch { /* ignore */ }
  });
  return ws;
}

function once(ws, pred, ms = 1500) {
  for (let i = ws.cursor || 0; i < ws.inbox.length; i++) {
    if (pred(ws.inbox[i])) {
      ws.cursor = i + 1;
      return Promise.resolve(ws.inbox[i]);
    }
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    const onMsg = () => {
      for (let i = ws.cursor || 0; i < ws.inbox.length; i++) {
        if (pred(ws.inbox[i])) {
          ws.cursor = i + 1;
          clearTimeout(timer);
          ws.off('message', onMsg);
          resolve(ws.inbox[i]);
          return;
        }
      }
    };
    ws.on('message', onMsg);
    onMsg();
  });
}

function openClient(port, hello) {
  const ws = watch(new WebSocket(`ws://127.0.0.1:${port}/ws`));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('open timeout')), 1500);
    ws.once('open', () => {
      ws.send(JSON.stringify({ t: 'hello', v: 1, ...hello }));
      clearTimeout(timer);
      resolve(ws);
    });
  });
}

test('como mucho cuatro conexiones por IP', async () => {
  const server = await createGameServer({ host: '127.0.0.1', port: 0 });
  const sockets = [];
  try {
    for (let i = 0; i < 4; i++) {
      const ws = await openClient(server.port, { name: `Casa${i}`, skin: 't', weapon: 'ak' });
      sockets.push(ws);
      const msg = await once(ws, (m) => m.t === 'welcome' || m.t === 'reject');
      assert.equal(msg.t, 'welcome');
    }
    const extra = watch(new WebSocket(`ws://127.0.0.1:${server.port}/ws`));
    sockets.push(extra);
    const msg = await once(extra, (m) => m.t === 'reject');
    assert.equal(msg.reason, 'ip');
  } finally {
    for (const ws of sockets) {
      try { ws.close(); } catch { /* ignore */ }
    }
    await server.close();
  }
});

test('protocolo: rechazos, NPCs, dos jugadores y basura', async () => {
  const server = await createGameServer({ host: '127.0.0.1', port: 0 });
  const sockets = [];
  try {
    const health = await fetch(`http://127.0.0.1:${server.port}/health`);
    assert.equal(await health.text(), 'ok');

    const bad = await openClient(server.port, { name: '<script>alert(1)</script>', skin: 't', weapon: 'ak' });
    sockets.push(bad);
    const rejected = await once(bad, (m) => m.t === 'reject');
    assert.equal(rejected.reason, 'name');
    bad.close();

    const ana = await openClient(server.port, { name: 'Ana', skin: 't', weapon: 'deagle' });
    sockets.push(ana);
    const welcome = await once(ana, (m) => m.t === 'welcome');
    assert.equal(welcome.id > 0, true);
    const solo = await once(ana, (m) => m.t === 'snap' && m.p.filter((p) => p.npc).length === 2);
    assert.equal(solo.p.filter((p) => p.npc).length, 2);

    const bea = await openClient(server.port, { name: 'Bea', skin: 'ct', weapon: 'sniper' });
    sockets.push(bea);
    await once(bea, (m) => m.t === 'welcome');
    const both = await once(ana, (m) => m.t === 'snap' && m.p.some((p) => p.name === 'Bea') && m.p.every((p) => !p.npc));
    assert.equal(both.p.some((p) => p.name === 'Bea'), true);

    ana.send('{{{');
    ana.send(JSON.stringify({ t: 'nope' }));
    ana.send(JSON.stringify({ t: 'in', yaw: 1e9, pitch: 99, seq: 1, b: 99999 }));
    const still = await once(ana, (m) => m.t === 'snap');
    assert.equal(still.t, 'snap');

    const raw = watch(new WebSocket(`ws://127.0.0.1:${server.port}/ws`));
    sockets.push(raw);
    await new Promise((resolve, reject) => {
      raw.once('open', resolve);
      raw.once('error', reject);
    });
    raw.send('{"t":"hello","v":1,"name":"Nico","skin":"t","weapon":"ak","__proto__":{"polluted":true}}');
    const nico = await once(raw, (m) => m.t === 'welcome' || m.t === 'reject');
    assert.equal(nico.t, 'welcome');
    assert.equal(Object.prototype.polluted, undefined);
    raw.close();
    bea.close();
    const back = await once(ana, (m) => m.t === 'snap' && m.p.filter((p) => p.npc).length === 2, 1500);
    assert.equal(back.p.filter((p) => p.npc).length, 2);
  } finally {
    for (const ws of sockets) {
      try { ws.close(); } catch { /* ignore */ }
    }
    await server.close();
  }
});
