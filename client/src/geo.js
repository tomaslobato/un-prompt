import { BufferGeometry, Float32BufferAttribute, Color } from 'three';
import { BOXES, RAMPS } from '@shared/map.js';
import { rampSurface } from '@shared/physics.js';

const SUN = { x: 0.32, y: 0.9, z: 0.22 };

function hexColor(hex) {
  const c = new Color(hex);
  return c;
}

function pushTri(pos, col, a, b, c, hex, factor = 1) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  let nx = aby * acz - abz * acy;
  let ny = abz * acx - abx * acz;
  let nz = abx * acy - aby * acx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  const sun = Math.max(0, nx * SUN.x + ny * SUN.y + nz * SUN.z);
  const k = (0.36 + 0.7 * sun) * factor;
  const color = hexColor(hex);
  const r = color.r * k;
  const g = color.g * k;
  const bl = color.b * k;
  pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  col.push(r, g, bl, r, g, bl, r, g, bl);
}

function quad(pos, col, a, b, c, d, hex, factor = 1) {
  pushTri(pos, col, a, b, c, hex, factor);
  pushTri(pos, col, a, c, d, hex, factor);
}

class Baker {
  constructor() {
    this.pos = [];
    this.col = [];
  }

  quad(a, b, c, d, hex, factor) {
    quad(this.pos, this.col, a, b, c, d, hex, factor);
  }

  box(x, y, z, w, h, d, hex) {
    const x0 = x - w / 2;
    const x1 = x + w / 2;
    const y0 = y - h / 2;
    const y1 = y + h / 2;
    const z0 = z - d / 2;
    const z1 = z + d / 2;
    this.aabb(x0, y0, z0, x1, y1, z1, hex, false);
  }

  aabb(x0, y0, z0, x1, y1, z1, hex, stripe) {
    const lift = 0.012;
    y0 += lift;
    y1 += lift;
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], hex);
    if (stripe) {
      const yA = y0 + (y1 - y0) * 0.38;
      const yB = y0 + (y1 - y0) * 0.62;
      this.sideBand(x0, x1, y0, yA, z0, z1, hex, 1);
      this.sideBand(x0, x1, yA, yB, z0, z1, hex, 0.62);
      this.sideBand(x0, x1, yB, y1, z0, z1, hex, 1);
    } else {
      this.sideBand(x0, x1, y0, y1, z0, z1, hex, 1);
    }
  }

  sideBand(x0, x1, y0, y1, z0, z1, hex, factor) {
    this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], hex, factor);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], hex, factor);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], hex, factor);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], hex, factor);
  }

  finish() {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

export function buildMapGeometry() {
  const geo = new Baker();
  for (let gz = 0; gz < 8; gz++) {
    for (let gx = 0; gx < 8; gx++) {
      const x0 = -64 + gx * 16;
      const z0 = -64 + gz * 16;
      const hex = (gx + gz) % 2 === 0 ? 0xd5c39a : 0xcbb68c;
      geo.quad([x0, 0, z0], [x0 + 16, 0, z0], [x0 + 16, 0, z0 + 16], [x0, 0, z0 + 16], hex);
    }
  }
  for (let i = 0; i < BOXES.length; i++) {
    const b = BOXES[i];
    geo.aabb(b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, b.color, b.tag === 'container');
  }
  for (let i = 0; i < RAMPS.length; i++) addRamp(geo, RAMPS[i]);
  return geo.finish();
}

function rampHeight(r, x, z) {
  return rampSurface(r, x, z) ?? 0;
}

function addRamp(geo, r) {
  const x0 = r.minX;
  const x1 = r.maxX;
  const z0 = r.minZ;
  const z1 = r.maxZ;
  const h00 = rampHeight(r, x0, z0) + 0.02;
  const h10 = rampHeight(r, x1, z0) + 0.02;
  const h11 = rampHeight(r, x1, z1) + 0.02;
  const h01 = rampHeight(r, x0, z1) + 0.02;
  const c = r.color;
  geo.quad([x0, h00, z0], [x0, h01, z1], [x1, h11, z1], [x1, h10, z0], c);
  geo.quad([x0, 0.02, z0], [x1, 0.02, z0], [x1, h10, z0], [x0, h00, z0], c, 0.9);
  geo.quad([x1, 0.02, z1], [x0, 0.02, z1], [x0, h01, z1], [x1, h11, z1], c, 0.9);
  geo.quad([x0, 0.02, z1], [x0, 0.02, z0], [x0, h00, z0], [x0, h01, z1], c, 0.85);
  geo.quad([x1, 0.02, z0], [x1, 0.02, z1], [x1, h11, z1], [x1, h10, z0], c, 0.85);
}

const T = { leg: 0x4a3b2a, body: 0xc6a56d, vest: 0x5e4b34, head: 0x171717, boot: 0x241c16, accent: 0x9a3030, slit: 0xe6dcc8 };
const CT = { leg: 0x2a3544, body: 0x3c516c, vest: 0x1e2a3a, head: 0x1a2430, boot: 0x14181e, accent: 0xb7d4ea, slit: 0xb7d4ea };

export function buildBody(skin) {
  const c = skin === 'ct' ? CT : T;
  const g = new Baker();
  g.box(-0.09, 0.42, 0, 0.13, 0.52, 0.15, c.leg);
  g.box(0.09, 0.42, 0, 0.13, 0.52, 0.15, c.leg);
  g.box(-0.09, 0.08, -0.03, 0.14, 0.16, 0.22, c.boot);
  g.box(0.09, 0.08, -0.03, 0.14, 0.16, 0.22, c.boot);
  g.box(0, 0.98, 0, 0.4, 0.44, 0.24, c.body);
  g.box(0, 1.02, -0.03, 0.34, 0.32, 0.2, c.vest);
  g.box(-0.27, 1.02, -0.02, 0.1, 0.36, 0.12, c.body);
  g.box(0.27, 1.0, -0.06, 0.1, 0.3, 0.12, c.body);
  g.box(0, 1.58, 0, 0.23, 0.28, 0.24, c.head);
  if (skin === 'ct') {
    g.box(0, 1.7, 0, 0.26, 0.1, 0.26, c.head);
    g.box(0, 1.56, -0.13, 0.2, 0.07, 0.04, c.accent);
  } else {
    g.box(0, 1.58, -0.125, 0.16, 0.045, 0.03, c.slit);
    g.box(0.22, 1.08, 0.02, 0.07, 0.1, 0.12, c.accent);
  }
  return g.finish();
}

export function buildGun(id) {
  const g = new Baker();
  const steel = 0xb7bcc2;
  const dark = 0x22262a;
  const wood = 0x7a5736;
  const black = 0x14171a;
  if (id === 'deagle') {
    g.box(0, 0.02, -0.08, 0.07, 0.08, 0.2, steel);
    g.box(0, 0.055, -0.2, 0.03, 0.03, 0.16, 0x8e949b);
    g.box(0, -0.06, 0.02, 0.05, 0.1, 0.07, dark);
    g.box(0, 0.075, -0.02, 0.012, 0.035, 0.012, black);
    g.box(0, 0.075, 0.04, 0.028, 0.03, 0.025, black);
  } else if (id === 'sniper') {
    g.box(0, 0.02, -0.05, 0.06, 0.07, 0.55, dark);
    g.box(0, 0.02, -0.42, 0.028, 0.028, 0.28, steel);
    g.box(0, 0.09, -0.02, 0.04, 0.045, 0.16, black);
    g.box(0, 0.09, -0.02, 0.055, 0.02, 0.02, 0x1c4a38);
    g.box(0, -0.05, 0.12, 0.045, 0.1, 0.09, wood);
    g.box(0, -0.02, 0.22, 0.04, 0.05, 0.16, wood);
  } else if (id === 'uzi') {
    g.box(0, 0.02, -0.08, 0.06, 0.07, 0.22, black);
    g.box(0, 0.02, -0.22, 0.028, 0.028, 0.12, steel);
    g.box(0, -0.08, 0.02, 0.045, 0.14, 0.05, dark);
    g.box(0, -0.02, 0.06, 0.05, 0.08, 0.07, 0x3a3e44);
    g.box(0, 0.07, 0.0, 0.03, 0.02, 0.04, steel);
  } else {
    g.box(0, 0.02, -0.02, 0.055, 0.07, 0.42, wood);
    g.box(0, 0.045, -0.16, 0.03, 0.03, 0.34, dark);
    g.box(0, -0.06, 0.08, 0.045, 0.12, 0.07, wood);
    g.box(0, -0.05, 0.02, 0.04, 0.14, 0.05, dark);
    g.box(0, 0.09, -0.02, 0.012, 0.035, 0.014, black);
    g.box(0, 0.085, 0.1, 0.03, 0.028, 0.03, black);
  }
  return g.finish();
}
