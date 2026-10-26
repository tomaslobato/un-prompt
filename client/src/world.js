import {
  Color,
  Fog,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  SRGBColorSpace,
  Group,
  BufferGeometry,
  Float32BufferAttribute,
  LineSegments,
  LineBasicMaterial,
  DoubleSide,
} from 'three';
import { buildBody, buildGun, buildMapGeometry } from './geo.js';
import { CROUCH_EYE, STAND_EYE } from '@shared/constants.js';
import { flatForward, lookVector, norm, rayWorld } from '@shared/physics.js';

const painted = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
const tracerMat = new LineBasicMaterial({ color: 0xffe2a8 });
const flashMat = new MeshBasicMaterial({ color: 0xfff1c2 });

const bodyCache = new Map();
const gunCache = new Map();

function bodyGeometry(skin) {
  const key = skin === 'ct' ? 'ct' : 't';
  if (!bodyCache.has(key)) bodyCache.set(key, buildBody(key));
  return bodyCache.get(key);
}

function gunGeometry(id) {
  const key = gunCache.has(id) ? id : (id === 'deagle' || id === 'sniper' || id === 'uzi' ? id : 'ak');
  if (!gunCache.has(key)) gunCache.set(key, buildGun(key));
  return gunCache.get(key);
}

function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

export function createWorld(canvas, hooks = {}) {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
    depth: true,
  });
  if (!renderer.getContext()) throw new Error('webgl');
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x8ebcde, 1);
  let dprCap = Math.min(1.25, window.devicePixelRatio || 1);
  let dpr = dprCap;
  renderer.setPixelRatio(dpr);

  const scene = new Scene();
  scene.background = new Color(0x8ebcde);
  scene.fog = new Fog(0xd5c4a4, 40, 112);
  const camera = new PerspectiveCamera(75, 1, 0.08, 190);
  scene.add(camera);

  const map = new Mesh(buildMapGeometry(), painted);
  scene.add(map);

  const vm = new Group();
  camera.add(vm);
  const vmGun = new Mesh(gunGeometry('ak'), painted);
  vm.add(vmGun);
  const flash = new Mesh(new BufferGeometry(), flashMat);
  const flashGeo = new BufferGeometry();
  const flashPos = new Float32Array([
    -0.03, -0.03, -0.45,
    0.03, -0.03, -0.45,
    0.03, 0.03, -0.62,
    -0.03, -0.03, -0.45,
    0.03, 0.03, -0.62,
    -0.03, 0.03, -0.62,
  ]);
  flashGeo.setAttribute('position', new Float32BufferAttribute(flashPos, 3));
  flash.geometry = flashGeo;
  flash.visible = false;
  vm.add(flash);

  const tracerPositions = new Float32Array(48 * 6);
  const tracerGeo = new BufferGeometry();
  tracerGeo.setAttribute('position', new Float32BufferAttribute(tracerPositions, 3));
  tracerGeo.setDrawRange(0, 0);
  const tracersMesh = new LineSegments(tracerGeo, tracerMat);
  tracersMesh.frustumCulled = false;
  scene.add(tracersMesh);
  const tracers = [];

  const remotes = new Map();
  let killId = 0;
  let fps = 60;
  let frames = 0;
  let fpsStamp = performance.now();
  let resized = true;

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  window.addEventListener('resize', () => { resized = true; });
  canvas.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    hooks.onLost?.();
  });

  function ensureRemote(sample) {
    let rec = remotes.get(sample.id);
    if (!rec) {
      const group = new Group();
      group.rotation.order = 'YXZ';
      const body = new Mesh(bodyGeometry(sample.sk), painted);
      const gun = new Mesh(gunGeometry(sample.w), painted);
      gun.position.set(0.18, 1.05, -0.2);
      group.add(body, gun);
      scene.add(group);
      rec = {
        group, gun, samples: [], dx: sample.x, dy: sample.y, dz: sample.z,
        wasAlive: !!sample.a, fall: 0, weapon: sample.w, skin: sample.sk,
      };
      remotes.set(sample.id, rec);
    }
    if (rec.weapon !== sample.w) {
      rec.group.remove(rec.gun);
      rec.gun.geometry = gunGeometry(sample.w);
      rec.group.add(rec.gun);
      rec.weapon = sample.w;
    }
    return rec;
  }

  function sync(others) {
    const seen = new Set();
    const now = performance.now();
    for (let i = 0; i < others.length; i++) {
      const o = others[i];
      if (!o || !Number.isFinite(o.x)) continue;
      seen.add(o.id);
      const rec = ensureRemote(o);
      if (rec.wasAlive && !o.a) rec.fall = 0.5;
      rec.wasAlive = !!o.a;
      rec.samples.push({ ...o, t: now });
      if (rec.samples.length > 6) rec.samples.shift();
    }
    for (const [id, rec] of remotes) {
      if (seen.has(id)) continue;
      scene.remove(rec.group);
      remotes.delete(id);
    }
  }

  function addTracer(ev) {
    if (!Number.isFinite(ev.x) || !Number.isFinite(ev.tx)) return;
    tracers.push({ x: ev.x, y: ev.y, z: ev.z, tx: ev.tx, ty: ev.ty, tz: ev.tz, life: ev.w === 'sniper' ? 0.12 : 0.07 });
    if (tracers.length > 24) tracers.shift();
  }

  function render(dt, state) {
    if (resized) { resize(); resized = false; }
    const kill = killId ? remotes.get(killId) : null;
    vm.visible = !kill && state.alive;
    if (kill && kill.samples.length) {
      const s = kill.samples[kill.samples.length - 1];
      const yaw = s.yaw || 0;
      const f = flatForward(yaw);
      const eyeY = s.y + (s.cr ? CROUCH_EYE : STAND_EYE);
      const origin = { x: s.x, y: eyeY + 0.15, z: s.z };
      const back = norm(-f.x, 0.22, -f.z);
      const hit = rayWorld(origin, back, 3.8);
      const dist = hit ? Math.max(0.75, hit.t - 0.3) : 3.15;
      camera.position.set(origin.x + back.x * dist, origin.y + 0.25, origin.z + back.z * dist);
      camera.up.set(0, 1, 0);
      camera.lookAt(s.x + f.x * 8, eyeY - 0.05, s.z + f.z * 8);
      camera.fov += (72 - camera.fov) * Math.min(1, dt * 8);
    } else {
      const eye = state.y + (state.crouch ? CROUCH_EYE : STAND_EYE);
      const yaw = state.aimYaw + state.recoilY;
      const pitch = Math.max(-1.45, Math.min(1.45, state.aimPitch + state.recoilP));
      const dir = lookVector(yaw, pitch);
      camera.position.set(state.x, eye, state.z);
      camera.up.set(0, 1, 0);
      camera.lookAt(state.x + dir.x, eye + dir.y, state.z + dir.z);
      const scoped = state.weapon === 'sniper' && state.ads > 0.62;
      const targetFov = scoped ? 18 : state.ads > 0.35 ? 62 : 75;
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
      const hip = state.weapon === 'deagle'
        ? { x: 0.24, y: -0.22, z: -0.42 }
        : state.weapon === 'sniper'
          ? { x: 0.2, y: -0.24, z: -0.55 }
          : state.weapon === 'uzi'
            ? { x: 0.22, y: -0.22, z: -0.38 }
            : { x: 0.26, y: -0.24, z: -0.48 };
      const ads = scoped
        ? { x: 0, y: -0.04, z: -0.35 }
        : { x: 0.02, y: -0.16, z: -0.4 };
      const blend = state.ads;
      vmGun.geometry = gunGeometry(state.weapon);
      const speed = Math.hypot(state.vx, state.vz);
      const bob = state.grounded && speed > 0.4 ? Math.sin(performance.now() * 0.012 * speed) * 0.012 : 0;
      vm.position.set(
        hip.x + (ads.x - hip.x) * blend,
        hip.y + (ads.y - hip.y) * blend + bob,
        hip.z + (ads.z - hip.z) * blend + state.recoilP * 0.25,
      );
      vm.rotation.set(-state.recoilP * 0.4, 0, state.recoilY * 0.3);
      flash.visible = state.flash > 0;
      vm.visible = state.alive && !scoped;
    }
    if (Math.abs(camera.fov - 75) > 0.05 || kill) camera.updateProjectionMatrix();

    const now = performance.now();
    for (const rec of remotes.values()) {
      const s = rec.samples[rec.samples.length - 1];
      if (!s) continue;
      const age = Math.min(0.1, (now - s.t) / 1000);
      const x = s.x + (s.vx || 0) * age;
      const z = s.z + (s.vz || 0) * age;
      const k = Math.min(1, dt * 16);
      rec.dx += (x - rec.dx) * k;
      rec.dy += (s.y - rec.dy) * k;
      rec.dz += (z - rec.dz) * k;
      rec.group.position.set(rec.dx, rec.dy, rec.dz);
      rec.group.rotation.y = lerpAngle(rec.group.rotation.y, s.yaw || 0, k);
      rec.gun.rotation.x = s.pitch || 0;
      rec.gun.visible = !!s.a;
      if (rec.fall > 0) {
        rec.fall = Math.max(0, rec.fall - dt);
        const u = 1 - rec.fall / 0.5;
        rec.group.rotation.z = u * 1.35;
      } else if (s.a) {
        rec.group.rotation.z = 0;
      }
      rec.group.visible = true;
    }

    for (let i = tracers.length - 1; i >= 0; i--) {
      tracers[i].life -= dt;
      if (tracers[i].life <= 0) tracers.splice(i, 1);
    }
    const attr = tracerGeo.getAttribute('position');
    for (let i = 0; i < tracers.length; i++) {
      const tr = tracers[i];
      const o = i * 6;
      tracerPositions[o] = tr.x;
      tracerPositions[o + 1] = tr.y;
      tracerPositions[o + 2] = tr.z;
      tracerPositions[o + 3] = tr.tx;
      tracerPositions[o + 4] = tr.ty;
      tracerPositions[o + 5] = tr.tz;
    }
    attr.needsUpdate = true;
    tracerGeo.setDrawRange(0, tracers.length * 2);

    renderer.render(scene, camera);
    frames += 1;
    if (now - fpsStamp > 700) {
      fps = (frames * 1000) / (now - fpsStamp);
      frames = 0;
      fpsStamp = now;
      if (fps < 45 && dpr > 0.7) {
        dpr = Math.max(0.7, dpr - 0.15);
        renderer.setPixelRatio(dpr);
        resized = true;
      } else if (fps > 58 && dpr < dprCap - 0.02) {
        dpr = Math.min(dprCap, dpr + 0.05);
        renderer.setPixelRatio(dpr);
        resized = true;
      }
    }
  }

  resize();
  return {
    render,
    sync,
    addTracer,
    setKillcam(id) { killId = id || 0; },
    clear() {
      killId = 0;
      tracers.length = 0;
      for (const rec of remotes.values()) scene.remove(rec.group);
      remotes.clear();
    },
    list() {
      const out = [];
      for (const [id, rec] of remotes) {
        const s = rec.samples[rec.samples.length - 1];
        if (s) out.push({ id, ...s });
      }
      return out;
    },
    fps() { return fps; },
    draws() { return renderer.info.render.calls; },
  };
}
