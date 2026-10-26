import {
  AFK_LIMIT,
  DT,
  HIST_LEN,
  KILLCAM_LIMIT,
  MAX_PLAYERS,
  SPAWN_SHIELD,
} from '../shared/constants.js';
import { SPAWNS } from '../shared/map.js';
import { angleDiff, eyeOf, lookVector, offsetCone, penetrates, supportHeight, traceShot } from '../shared/physics.js';
import { applyInput } from '../shared/simstep.js';
import { WEAPON_IDS, WEAPONS, damageFor, spreadOf } from '../shared/weapons.js';
import { thinkNpc } from './ai.js';

function blank(fields) {
  const weapon = fields.weapon;
  const w = WEAPONS[weapon];
  return {
    id: 0,
    name: '',
    skin: 't',
    weapon,
    isNpc: false,
    connected: true,
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0,
    recoilP: 0, recoilY: 0,
    hp: 100,
    alive: true,
    mag: w.mag,
    reserve: w.reserve,
    reloadLeft: 0,
    shotCooldown: 0,
    shotIndex: 0,
    prevButtons: 0,
    grounded: true,
    crouch: false,
    ads: false,
    spawnShield: SPAWN_SHIELD,
    lastSeq: 0,
    pending: null,
    inputAt: 0,
    rtt: 0.08,
    hist: new Array(HIST_LEN),
    histI: 0,
    safeX: 0, safeY: 0, safeZ: 0,
    afk: 0,
    lastYaw: 0,
    deadFor: 0,
    ai: null,
    _shotRecoilP: 0,
    _shotRecoilY: 0,
    ...fields,
  };
}

export class Arena {
  constructor(opts = {}) {
    this.random = opts.random || Math.random;
    this.perfectAim = !!opts.perfectAim;
    this.npcAimError = opts.npcAimError ?? 0.075;
    this.npcEnabled = opts.npcs !== false;
    this.players = new Map();
    this.npcs = new Map();
    this.events = [];
    this.kicks = [];
    this.respawns = [];
    this.fxCount = 0;
    this.tickN = 0;
    this.nextId = 1;
  }

  humanCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  everyone() {
    return [...this.players.values(), ...this.npcs.values()];
  }

  roster() {
    return this.everyone().filter((a) => a.connected && (a.alive || a.deadFor < 4)).map((a) => ({
      id: a.id,
      name: a.name,
      skin: a.skin,
      weapon: a.weapon,
      npc: a.isNpc ? 1 : 0,
    }));
  }

  pickSpawn(avoid) {
    let best = SPAWNS[0];
    let bestScore = -Infinity;
    for (let i = 0; i < SPAWNS.length; i++) {
      const s = SPAWNS[i];
      let minD = 80;
      for (let j = 0; j < avoid.length; j++) {
        const a = avoid[j];
        if (!a.alive) continue;
        minD = Math.min(minD, Math.hypot(a.x - s.x, a.z - s.z));
      }
      const score = minD + this.random() * 3;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  place(e, spawn) {
    const tries = [
      spawn,
      { x: spawn.x + 1, z: spawn.z, yaw: spawn.yaw },
      { x: spawn.x - 1, z: spawn.z, yaw: spawn.yaw },
      { x: spawn.x, z: spawn.z + 1, yaw: spawn.yaw },
      { x: spawn.x, z: spawn.z - 1, yaw: spawn.yaw },
      { x: 0, z: -20, yaw: 0 },
    ];
    for (let i = 0; i < tries.length; i++) {
      const s = tries[i];
      e.x = s.x;
      e.z = s.z;
      e.y = supportHeight(s.x, s.z, 30);
      e.yaw = s.yaw ?? spawn.yaw;
      e.pitch = 0;
      e.vx = e.vy = e.vz = 0;
      e.grounded = true;
      e.safeX = e.x;
      e.safeY = e.y;
      e.safeZ = e.z;
      e.lastYaw = e.yaw;
      if (!penetrates(e)) return;
    }
  }

  addPlayer({ name, skin, weapon }) {
    const lower = name.toLowerCase();
    for (const p of this.players.values()) {
      if (p.name.toLowerCase() === lower) return { error: 'taken' };
    }
    if (this.players.size >= MAX_PLAYERS) return { error: 'full' };
    const id = this.nextId++;
    const e = blank({ id, name, skin, weapon, isNpc: false, spawnShield: SPAWN_SHIELD });
    this.place(e, this.pickSpawn(this.everyone()));
    this.players.set(id, e);
    this.events.push({ t: 'join', id, name, skin, weapon, npc: 0 });
    return e;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.events.push({ t: 'leave', id });
  }

  pushInput(id, raw) {
    const p = this.players.get(id);
    if (!p || !p.connected) return 'gone';
    if (!raw || typeof raw !== 'object') return 'bad';
    const yaw = Number(raw.yaw);
    const pitch = Number(raw.pitch);
    const seq = raw.seq;
    const buttons = raw.b;
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return 'bad';
    if (!Number.isInteger(seq) || seq < 0 || seq > 1e15) return 'bad';
    if (!Number.isInteger(buttons) || buttons < 0 || buttons > 1023) return 'bad';
    if (seq <= p.lastSeq) return 'old';
    p.pending = {
      yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)),
      pitch: Math.min(1.45, Math.max(-1.45, pitch)),
      seq,
      buttons,
    };
    p.lastSeq = seq;
    p.inputAt = this.tickN;
    return 'ok';
  }

  spawnNpc() {
    const used = new Set([...this.npcs.values()].map((n) => n.name));
    const name = ['Sombra', 'Buitre'].find((n) => !used.has(n)) || `Recluta${this.nextId}`;
    const weapon = WEAPON_IDS[Math.floor(this.random() * WEAPON_IDS.length)];
    const id = this.nextId++;
    const e = blank({
      id, name, skin: this.random() < 0.5 ? 't' : 'ct', weapon,
      isNpc: true, spawnShield: 0.6,
    });
    const avoid = this.everyone();
    this.place(e, this.pickSpawn(avoid));
    this.npcs.set(id, e);
    this.events.push({ t: 'join', id, name, skin: e.skin, weapon, npc: 1 });
    return e;
  }

  clearNpcs() {
    if (!this.npcs.size && !this.respawns.length) return;
    for (const n of this.npcs.values()) this.events.push({ t: 'leave', id: n.id });
    this.npcs.clear();
    this.respawns.length = 0;
  }

  updateNpcs() {
    if (!this.npcEnabled) {
      this.clearNpcs();
      return;
    }
    if (this.humanCount() !== 1) {
      this.clearNpcs();
      return;
    }
    const due = [];
    for (let i = 0; i < this.respawns.length; i++) {
      if (this.respawns[i] <= this.tickN) due.push(i);
    }
    if (due.length) {
      this.respawns = this.respawns.filter((t) => t > this.tickN);
      for (let i = 0; i < due.length; i++) this.spawnNpc();
    }
    let alive = 0;
    for (const n of this.npcs.values()) if (n.alive) alive++;
    const pending = this.respawns.length;
    if (alive + pending < 2 && this.npcs.size === 0 && pending === 0) {
      this.spawnNpc();
      this.spawnNpc();
    }
  }

  queueNpcRespawn() {
    if (!this.npcEnabled || this.humanCount() !== 1) return;
    this.respawns.push(this.tickN + 5 * 60);
  }

  saveHist(a) {
    a.hist[a.histI] = { tick: this.tickN, x: a.x, y: a.y, z: a.z, crouch: !!a.crouch };
    a.histI = (a.histI + 1) % HIST_LEN;
  }

  sampleHist(a, tick) {
    let best = null;
    for (let i = 0; i < a.hist.length; i++) {
      const h = a.hist[i];
      if (!h || h.tick > tick) continue;
      if (!best || h.tick > best.tick) best = h;
    }
    if (!best) return { x: a.x, y: a.y, z: a.z, crouch: a.crouch };
    return best;
  }

  pushFx(ev) {
    if (this.fxCount >= 48) return;
    this.fxCount++;
    this.events.push(ev);
  }

  resolveShot(shooter) {
    const rewind = Math.min(0.15, Math.max(0, shooter.rtt * 0.5));
    const frames = Math.round(rewind / DT);
    const targetTick = this.tickN - frames;
    const actors = [];
    const all = this.everyone();
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      if (a.id === shooter.id || !a.alive) continue;
      const h = frames <= 0 ? a : this.sampleHist(a, targetTick);
      actors.push({
        id: a.id,
        x: h.x,
        y: h.y,
        z: h.z,
        crouch: frames <= 0 ? a.crouch : h.crouch,
        alive: true,
        ref: a,
      });
    }
    const eye = eyeOf(shooter);
    const dir = lookVector(
      shooter.yaw + (shooter._shotRecoilY || 0),
      shooter.pitch + (shooter._shotRecoilP || 0),
    );
    const spread = this.perfectAim ? 0 : spreadOf(shooter);
    const aim = offsetCone(dir, spread, this.random);
    const range = WEAPONS[shooter.weapon].range;
    const hit = traceShot(eye, aim, actors, shooter.id, range);
    const endDist = hit ? hit.t : Math.min(range, 70);
    const end = hit
      ? hit.point
      : { x: eye.x + aim.x * endDist, y: eye.y + aim.y * endDist, z: eye.z + aim.z * endDist };
    this.pushFx({
      t: 'fx',
      id: shooter.id,
      x: eye.x, y: eye.y, z: eye.z,
      tx: end.x, ty: end.y, tz: end.z,
      w: shooter.weapon,
    });
    if (!hit || hit.type !== 'actor' || !hit.actor?.ref) return;
    const victim = hit.actor.ref;
    if (!victim.alive) return;
    if (shooter.isNpc && victim.isNpc) return;
    if (victim.spawnShield > 0) return;
    const dmg = damageFor(shooter.weapon, hit.head);
    victim.hp = Math.max(0, victim.hp - dmg);
    this.events.push({
      t: 'hit',
      v: victim.id,
      s: shooter.id,
      h: hit.head ? 1 : 0,
      d: dmg,
      x: shooter.x,
      z: shooter.z,
    });
    if (victim.hp <= 0) {
      victim.alive = false;
      victim.hp = 0;
      victim.deadFor = 0;
      victim.vx = victim.vy = victim.vz = 0;
      this.events.push({
        t: 'die',
        v: victim.id,
        s: shooter.id,
        n: shooter.name,
        vn: victim.name,
        w: shooter.weapon,
        sk: shooter.skin,
        x: victim.x,
        y: victim.y,
        z: victim.z,
      });
      if (victim.isNpc) this.queueNpcRespawn();
    }
  }

  guard(e) {
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.z)) {
      this.place(e, SPAWNS[0]);
      e.vx = e.vy = e.vz = 0;
    }
  }

  step() {
    this.tickN++;
    const shots = [];
    for (const p of this.players.values()) {
      if (!p.connected) continue;
      if (!p.alive) {
        p.deadFor += DT;
        p.vx = p.vy = p.vz = 0;
        if (p.deadFor > KILLCAM_LIMIT) {
          this.kicks.push({ id: p.id, reason: 'spectate' });
          p.connected = false;
        }
        continue;
      }
      let input = p.pending || { yaw: p.yaw, pitch: p.pitch, seq: p.lastSeq, buttons: 0 };
      if (p.pending && this.tickN - p.inputAt > 20) {
        input = { yaw: p.pending.yaw, pitch: p.pending.pitch, seq: p.pending.seq, buttons: 0 };
        p.pending = input;
      }
      const active = input.buttons !== 0 || Math.abs(angleDiff(input.yaw, p.lastYaw)) > 0.012;
      if (active) p.afk = 0;
      else p.afk += DT;
      p.lastYaw = input.yaw;
      if (p.afk > AFK_LIMIT) {
        this.kicks.push({ id: p.id, reason: 'afk' });
        p.connected = false;
        continue;
      }
      const result = applyInput(p, input, DT);
      if (result.didShoot) shots.push(p);
      this.guard(p);
    }

    this.updateNpcs();

    const humans = [...this.players.values()];
    for (const n of this.npcs.values()) {
      if (!n.alive) {
        n.deadFor += DT;
        continue;
      }
      const input = thinkNpc(n, humans, this.random, this.npcAimError);
      const result = applyInput(n, input, DT);
      if (result.didShoot) shots.push(n);
      this.guard(n);
    }

    for (let i = 0; i < shots.length; i++) this.resolveShot(shots[i]);

    for (const a of this.everyone()) {
      if (a.alive) this.saveHist(a);
    }

    for (const n of [...this.npcs.values()]) {
      if (!n.alive && n.deadFor > 3.5) this.npcs.delete(n.id);
    }
  }

  pullKicks() {
    const k = this.kicks;
    this.kicks = [];
    return k;
  }

  buildSnap(id) {
    const you = this.players.get(id);
    if (!you) return null;
    const others = [];
    for (const a of this.everyone()) {
      if (a.id === id) continue;
      if (!a.alive && a.deadFor > 4) continue;
      const pitch = Math.max(-1.45, Math.min(1.45, a.pitch + a.recoilP));
      others.push({
        id: a.id,
        x: a.x, y: a.y, z: a.z,
        vx: a.vx, vz: a.vz,
        yaw: a.yaw + a.recoilY,
        pitch,
        hp: a.hp,
        a: a.alive ? 1 : 0,
        cr: a.crouch ? 1 : 0,
        w: a.weapon,
        sk: a.skin,
        npc: a.isNpc ? 1 : 0,
        name: a.name,
      });
    }
    return {
      t: 'snap',
      k: this.tickN,
      seq: you.lastSeq,
      x: you.x, y: you.y, z: you.z,
      vx: you.vx, vy: you.vy, vz: you.vz,
      g: you.grounded ? 1 : 0,
      hp: you.hp,
      mag: you.mag,
      reserve: you.reserve,
      rl: you.reloadLeft,
      sc: you.shotCooldown,
      si: you.shotIndex,
      rp: you.recoilP,
      ry: you.recoilY,
      sh: you.spawnShield,
      a: you.alive ? 1 : 0,
      cr: you.crouch ? 1 : 0,
      sx: you.safeX, sy: you.safeY, sz: you.safeZ,
      ms: Math.round((you.rtt || 0) * 1000),
      p: others,
    };
  }
}
