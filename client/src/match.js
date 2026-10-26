import { BTN, DT, PROTOCOL } from '@shared/constants.js';
import { applyInput } from '@shared/simstep.js';
import { spreadOf, WEAPONS } from '@shared/weapons.js';
import { createWorld } from './world.js';
import { playDie, playElim, playHit, playHurt, playReload, playShot } from './audio.js';
import { reasonText, skinLabel } from './text.js';

let world = null;
let activeStop = null;

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parse(data) {
  if (typeof data !== 'string' || data.length > 200000) return null;
  try {
    const msg = JSON.parse(data);
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
    return msg;
  } catch {
    return null;
  }
}

function connectOnce(hello, onGame) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl());
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* ignore */ }
      reject(Object.assign(new Error('timeout'), { reason: 'timeout' }));
    }, 6000);
    ws.onerror = () => {};
    ws.onclose = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(Object.assign(new Error('closed'), { reason: 'closed' }));
    };
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, ...hello }));
    };
    ws.onmessage = (ev) => {
      const msg = parse(ev.data);
      if (!msg) return;
      if (!settled) {
        if (msg.t === 'welcome') {
          settled = true;
          clearTimeout(timer);
          resolve(ws);
          onGame(msg);
          return;
        }
        if (msg.t === 'reject') {
          settled = true;
          clearTimeout(timer);
          try { ws.close(); } catch { /* ignore */ }
          reject(Object.assign(new Error(msg.reason || 'bad'), { reason: msg.reason || 'bad' }));
        }
        return;
      }
      onGame(msg);
    };
  });
}

async function connectWithRetry(hello, onGame, onStatus) {
  let last = null;
  for (let i = 0; i < 10; i++) {
    try {
      return await connectOnce(hello, onGame);
    } catch (err) {
      if (err.reason && err.reason !== 'timeout' && err.reason !== 'closed') throw err;
      last = err;
      onStatus(i === 0 ? 'Conectando…' : 'El servidor se está despertando. Puede tardar un minuto.');
      await sleep(Math.min(7000, 800 * (i + 1)));
    }
  }
  throw last || Object.assign(new Error('timeout'), { reason: 'timeout' });
}

export async function startMatch({ name, skin, weapon, onStatus }) {
  const canvas = document.getElementById('view');
  if (!world) {
    try {
      world = createWorld(canvas, {
        onLost() {
          activeStop?.(reasonText('webgl'));
        },
      });
    } catch {
      throw Object.assign(new Error('webgl'), { reason: 'webgl' });
    }
  }
  const early = [];
  let onGame = (msg) => early.push(msg);
  onStatus('Conectando…');
  const ws = await connectWithRetry({ name, skin, weapon }, (msg) => onGame(msg), onStatus);
  return new Promise((resolve) => {
    const hud = document.getElementById('hud');
    const menu = document.getElementById('menu');
    const death = document.getElementById('death');
    const hint = document.getElementById('hint');
    const scope = document.getElementById('scope');
    const cross = document.getElementById('cross');
    const stack = document.getElementById('elim-stack');
    const hitmarker = document.getElementById('hitmarker');
    const dmg = document.getElementById('dmg');
    const vignette = document.getElementById('vignette');
    const teach = document.getElementById('teach');
    const ac = new AbortController();
    const opt = { signal: ac.signal };
    const keys = new Set();
    let fireDown = false;
    let aimDown = false;
    let forceFire = false;
    let seq = 1;
    let acc = 0;
    let last = performance.now();
    let raf = 0;
    let finished = false;
    let dying = false;
    let intentional = false;
    let myId = 0;
    let flash = 0;
    let hitTimer = 0;
    let beat = 0;
    const welcome = early.find((m) => m.t === 'welcome') || { x: 0, y: 0, z: 0, yaw: 0, mag: WEAPONS[weapon].mag, reserve: WEAPONS[weapon].reserve, id: 0 };
    myId = welcome.id;
    let aimYaw = Number.isFinite(welcome.yaw) ? welcome.yaw : 0;
    let aimPitch = 0;
    const me = {
      x: welcome.x, y: welcome.y, z: welcome.z,
      vx: 0, vy: 0, vz: 0,
      yaw: aimYaw, pitch: 0,
      recoilP: 0, recoilY: 0,
      hp: 100, alive: true,
      mag: welcome.mag, reserve: welcome.reserve,
      reloadLeft: 0, shotCooldown: 0, shotIndex: 0,
      prevButtons: 0, grounded: true, crouch: false, ads: false,
      spawnShield: 2, weapon,
      safeX: welcome.x, safeY: welcome.y, safeZ: welcome.z,
    };

    menu.hidden = true;
    hud.hidden = false;
    death.hidden = true;
    scope.hidden = true;
    teach.hidden = false;
    setTimeout(() => { if (teach) teach.hidden = true; }, 8000);

    function stop(message) {
      if (finished) return;
      finished = true;
      intentional = true;
      if (activeStop === stop) activeStop = null;
      ac.abort();
      clearInterval(beat);
      cancelAnimationFrame(raf);
      try { ws.close(); } catch { /* ignore */ }
      if (document.pointerLockElement) document.exitPointerLock();
      keys.clear();
      world.setKillcam(0);
      world.clear();
      hud.hidden = true;
      death.hidden = true;
      scope.hidden = true;
      hint.hidden = true;
      stack.replaceChildren();
      resolve(message || '');
    }
    activeStop = stop;

    function buttons() {
      let b = 0;
      if (keys.has('KeyW')) b |= BTN.F;
      if (keys.has('KeyS')) b |= BTN.B;
      if (keys.has('KeyA')) b |= BTN.L;
      if (keys.has('KeyD')) b |= BTN.R;
      if (keys.has('Space')) b |= BTN.JUMP;
      if (keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC')) b |= BTN.CROUCH;
      if (keys.has('ShiftLeft') || keys.has('ShiftRight')) b |= BTN.SPRINT;
      if (fireDown || forceFire || keys.has('KeyF')) b |= BTN.FIRE;
      if (keys.has('KeyR')) b |= BTN.RELOAD;
      if (aimDown) b |= BTN.ADS;
      return b;
    }

    function send(obj) {
      if (ws.readyState !== 1) return;
      if (ws.bufferedAmount > 65536) return;
      ws.send(JSON.stringify(obj));
    }

    function tick() {
      if (!me.alive || dying) return;
      if (keys.has('ArrowLeft')) aimYaw += DT * 1.7;
      if (keys.has('ArrowRight')) aimYaw -= DT * 1.7;
      if (keys.has('ArrowUp')) aimPitch += DT * 1.15;
      if (keys.has('ArrowDown')) aimPitch -= DT * 1.15;
      aimPitch = Math.max(-1.45, Math.min(1.45, aimPitch));
      const clean = {
        yaw: Math.atan2(Math.sin(aimYaw), Math.cos(aimYaw)),
        pitch: aimPitch,
        seq: seq++,
        buttons: buttons(),
      };
      aimYaw = clean.yaw;
      const beforeMag = me.mag;
      const beforeReload = me.reloadLeft;
      let shot = false;
      try {
        shot = applyInput(me, clean, DT).didShoot;
      } catch (err) {
        console.error(err);
        stop('closed');
        return;
      }
      if (shot) {
        playShot(weapon);
        flash = 0.05;
      }
      if (beforeReload <= 0 && me.reloadLeft > 0) playReload();
      send({ t: 'in', yaw: clean.yaw, pitch: clean.pitch, seq: clean.seq, b: clean.buttons });
    }

    function applySnap(s) {
      if (!s || !Number.isFinite(s.x)) return;
      const err = Math.hypot(s.x - me.x, s.z - me.z);
      const yerr = Math.abs(s.y - me.y);
      if (err > 1.3 || yerr > 1.5) {
        me.x = s.x; me.y = s.y; me.z = s.z;
        me.vx = s.vx; me.vy = s.vy; me.vz = s.vz;
        me.grounded = !!s.g;
      } else if (err > 0.22 || yerr > 0.35) {
        me.x += (s.x - me.x) * 0.28;
        me.y += (s.y - me.y) * 0.28;
        me.z += (s.z - me.z) * 0.28;
      }
      me.hp = s.hp;
      me.mag = s.mag;
      me.reserve = s.reserve;
      me.reloadLeft = s.rl;
      me.shotCooldown = s.sc;
      me.shotIndex = s.si;
      me.recoilP += (s.rp - me.recoilP) * 0.65;
      me.recoilY += (s.ry - me.recoilY) * 0.65;
      me.spawnShield = s.sh || 0;
      me.alive = !!s.a;
      if (s.sx != null) { me.safeX = s.sx; me.safeY = s.sy; me.safeZ = s.sz; }
      if (Array.isArray(s.p)) world.sync(s.p);
      const ping = document.getElementById('ping');
      if (ping) ping.textContent = Number.isFinite(s.ms) ? `${s.ms} ms` : '—';
      if (Array.isArray(s.e)) {
        for (let i = 0; i < s.e.length; i++) handleEvent(s.e[i]);
      }
    }

    function handleEvent(ev) {
      if (!ev || typeof ev !== 'object') return;
      if (ev.t === 'fx') {
        world.addTracer(ev);
        if (ev.id !== myId) playShot(ev.w, 0.45);
        return;
      }
      if (ev.t === 'hit' && ev.s === myId) {
        playHit(!!ev.h);
        hitmarker.classList.remove('on', 'head');
        void hitmarker.offsetWidth;
        if (ev.h) hitmarker.classList.add('head');
        hitmarker.classList.add('on');
        clearTimeout(hitTimer);
        hitTimer = setTimeout(() => hitmarker.classList.remove('on'), 90);
        return;
      }
      if (ev.t === 'hit' && ev.v === myId) {
        playHurt();
        vignette.classList.add('hurt');
        setTimeout(() => vignette.classList.remove('hurt'), 140);
        const dx = (ev.x || 0) - me.x;
        const dz = (ev.z || 0) - me.z;
        const facing = Math.atan2(-dx, -dz);
        const rel = Math.atan2(Math.sin(facing - aimYaw), Math.cos(facing - aimYaw));
        dmg.style.transform = `rotate(${rel}rad)`;
        dmg.classList.remove('on');
        void dmg.offsetWidth;
        dmg.classList.add('on');
        return;
      }
      if (ev.t === 'die' && ev.v === myId) {
        beginDeath(ev);
        return;
      }
      if (ev.t === 'die' && ev.s === myId && ev.v !== myId) {
        pushElim(ev.vn);
        playElim();
      }
    }

    function pushElim(name) {
      const row = document.createElement('div');
      row.className = 'elim';
      const lead = document.createElement('span');
      lead.textContent = 'Eliminaste a ';
      const who = document.createElement('b');
      who.textContent = String(name || 'alguien').slice(0, 24);
      row.append(lead, who);
      stack.append(row);
      while (stack.childElementCount > 4) stack.firstElementChild.remove();
      setTimeout(() => row.remove(), 2400);
    }

    function beginDeath(ev) {
      if (dying) return;
      dying = true;
      me.alive = false;
      fireDown = false;
      aimDown = false;
      keys.clear();
      if (document.pointerLockElement) document.exitPointerLock();
      world.setKillcam(ev.s);
      document.getElementById('killer-name').textContent = String(ev.n || 'desconocido').slice(0, 24);
      const wname = WEAPONS[ev.w]?.name || 'Arma';
      document.getElementById('killer-meta').textContent = `${wname} · ${skinLabel(ev.sk)}`;
      death.hidden = false;
      hint.hidden = true;
      scope.hidden = true;
      cross.hidden = true;
      playDie();
    }

    function paint() {
      const hp = Math.max(0, Math.round(me.hp));
      const bar = document.getElementById('hp-bar');
      const num = document.getElementById('hp-num');
      bar.style.width = `${hp}%`;
      num.textContent = String(hp);
      vignette.classList.toggle('low', hp > 0 && hp <= 35);
      document.getElementById('mag').textContent = String(me.mag);
      document.getElementById('reserve').textContent = String(me.reserve);
      document.getElementById('weapon-name').textContent = WEAPONS[weapon].name;
      const stateLine = document.getElementById('state-line');
      if (!me.alive) stateLine.textContent = '';
      else if (me.reloadLeft > 0) stateLine.textContent = 'Recargando';
      else if (me.spawnShield > 0.05) stateLine.textContent = 'Protegido';
      else if (me.mag === 0 && me.reserve === 0) stateLine.textContent = 'Sin munición';
      else stateLine.textContent = '';
      const gap = 6 + spreadOf({ ...me, ads: aimDown, weapon }) * 380;
      cross.style.setProperty('--gap', `${Math.max(3, Math.min(28, gap))}px`);
      cross.className = weapon === 'uzi' ? 'uzi' : weapon === 'sniper' ? 'sniper' : weapon === 'deagle' ? 'deagle' : 'ak';
      const scoped = me.alive && weapon === 'sniper' && aimDown && !dying;
      scope.hidden = !scoped;
      cross.hidden = scoped || dying;
      const locked = document.pointerLockElement === canvas;
      hint.hidden = !me.alive || dying || locked;
    }

    function frame(now) {
      if (finished) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!document.hidden && me.alive && !dying) {
        acc += dt;
        let n = 0;
        while (acc >= DT && n < 5) {
          acc -= DT;
          tick();
          n += 1;
        }
      } else {
        acc = 0;
      }
      if (flash > 0) flash = Math.max(0, flash - dt);
      world.render(dt, {
        x: me.x, y: me.y, z: me.z,
        vx: me.vx, vz: me.vz,
        aimYaw, aimPitch,
        recoilP: me.recoilP, recoilY: me.recoilY,
        crouch: me.crouch, ads: aimDown ? 1 : 0,
        alive: me.alive && !dying, grounded: me.grounded,
        weapon, flash,
      });
      paint();
      raf = requestAnimationFrame(frame);
    }

    onGame = (msg) => {
      if (finished || !msg) return;
      if (msg.t === 'snap') applySnap(msg);
      else if (msg.t === 'ping') send({ t: 'pong', n: msg.n });
      else if (msg.t === 'kick') stop(reasonText(msg.reason || 'kick'));
      else if (msg.t === 'welcome') { /* already applied */ }
    };
    for (let i = 0; i < early.length; i++) onGame(early[i]);

    ws.addEventListener('close', () => {
      if (!intentional) stop(reasonText('closed'));
    }, opt);

    beat = setInterval(() => send({ t: 'hb' }), 4000);

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.repeat) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      keys.add(e.code);
    }, opt);
    window.addEventListener('keyup', (e) => { keys.delete(e.code); }, opt);
    window.addEventListener('blur', () => { keys.clear(); fireDown = false; aimDown = false; }, opt);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), opt);
    canvas.addEventListener('mousedown', (e) => {
      if (finished || dying || !me.alive) return;
      if (e.button === 2) {
        aimDown = true;
        if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
        return;
      }
      if (e.button !== 0) return;
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
        return;
      }
      fireDown = true;
    }, opt);
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) fireDown = false;
      if (e.button === 2) aimDown = false;
    }, opt);
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas || dying || !me.alive) return;
      const scoped = weapon === 'sniper' && aimDown;
      const sens = 0.00215 * (scoped ? 0.34 : aimDown ? 0.72 : 1);
      aimYaw -= e.movementX * sens;
      aimPitch -= e.movementY * sens;
      aimPitch = Math.max(-1.45, Math.min(1.45, aimPitch));
    }, opt);
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas) {
        fireDown = false;
        aimDown = false;
      }
    }, opt);
    document.getElementById('back-menu').addEventListener('click', () => stop(''), opt);
    document.getElementById('quit').addEventListener('click', () => stop(''), opt);

    if (import.meta.env.DEV) {
      window.__sector = {
        pos: () => ({ x: me.x, y: me.y, z: me.z, yaw: aimYaw, pitch: aimPitch, hp: me.hp, mag: me.mag, alive: me.alive }),
        look: (yaw, pitch) => { aimYaw = yaw; aimPitch = pitch; },
        holdFire: (v) => { forceFire = !!v; },
        others: () => world.list(),
        fps: () => world.fps(),
        draws: () => world.draws(),
      };
    }

    raf = requestAnimationFrame(frame);
  });
}
