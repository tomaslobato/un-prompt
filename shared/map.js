export const PLAY_MIN = -46;
export const PLAY_MAX = 46;

export const COL = {
  sand: 0xd7c6a1,
  sand2: 0xc9b48a,
  concrete: 0xa39e94,
  barrier: 0xcfc6b4,
  orange: 0xde7436,
  blue: 0x3d84b0,
  red: 0xb24338,
  olive: 0x6f7d45,
  crate: 0x8d6a43,
  ramp: 0xb5a999,
  stair: 0x979287,
  metal: 0x6a6258,
};

function b(x, z, w, d, h, color, tag) {
  return {
    minX: x,
    maxX: x + w,
    minY: 0,
    maxY: h,
    minZ: z,
    maxZ: z + d,
    color,
    tag,
  };
}

export const BOXES = [
  b(-48, -48, 2, 96, 8, COL.concrete, 'wall'),
  b(46, -48, 2, 96, 8, COL.concrete, 'wall'),
  b(-46, -48, 92, 2, 8, COL.concrete, 'wall'),
  b(-46, 46, 92, 2, 8, COL.concrete, 'wall'),

  b(-28, -42, 16, 4, 2.5, COL.orange, 'container'),
  b(-7, -44, 4, 14, 2.5, COL.blue, 'container'),
  b(8, -42, 12, 4, 5, COL.red, 'container'),
  b(26, -36, 12, 4, 2.5, COL.olive, 'container'),

  b(30, -8, 3, 16, 2.5, COL.blue, 'container'),
  b(39, -8, 3, 16, 2.5, COL.orange, 'container'),

  b(-16, 18, 32, 16, 3.5, COL.concrete, 'platform'),

  b(-43, -18, 14, 2, 2.5, COL.concrete, 'wall'),
  b(-43, -4, 14, 2, 2.5, COL.concrete, 'wall'),
  b(-30, -14, 2, 16, 2.5, COL.concrete, 'wall'),

  b(-44, 12, 10, 4, 0.5, COL.stair, 'stair'),
  b(-44, 16, 10, 4, 1, COL.stair, 'stair'),
  b(-44, 20, 10, 4, 1.5, COL.stair, 'stair'),
  b(-44, 24, 10, 8, 2, COL.stair, 'deck'),

  b(-9, -4, 6, 1, 1.5, COL.barrier, 'barrier'),
  b(3, -4, 6, 1, 1.5, COL.barrier, 'barrier'),
  b(-2, 6, 5, 1, 1.5, COL.barrier, 'barrier'),
  b(-6, 10, 2, 2, 1, COL.crate, 'crate'),
  b(7, -12, 2, 2, 1, COL.crate, 'crate'),
  b(-1, -18, 3, 2, 1, COL.crate, 'crate'),
  b(-24, 4, 8, 3, 2.5, COL.olive, 'container'),

  b(20, 14, 3, 12, 2.5, COL.blue, 'container'),
  b(26, 8, 8, 1, 1.5, COL.barrier, 'barrier'),

  b(-40, -28, 6, 1, 1.5, COL.barrier, 'barrier'),
  b(12, -24, 6, 1, 1.5, COL.barrier, 'barrier'),
  b(30, -26, 1, 5, 1.5, COL.barrier, 'barrier'),
  b(22, 34, 1, 5, 1.5, COL.barrier, 'barrier'),
  b(-18, 38, 6, 1, 1.5, COL.barrier, 'barrier'),
];

export const RAMPS = [
  { minX: -24, maxX: -16, minZ: -38, maxZ: -31, yLow: 0, yHigh: 2.5, along: 'z', highAt: 'min', color: COL.ramp },
  { minX: 30, maxX: 33, minZ: 8, maxZ: 15, yLow: 0, yHigh: 2.5, along: 'z', highAt: 'min', color: COL.ramp },
  { minX: -4, maxX: 4, minZ: 34, maxZ: 44, yLow: 0, yHigh: 3.5, along: 'z', highAt: 'min', color: COL.ramp },
  { minX: -26, maxX: -16, minZ: 24, maxZ: 30, yLow: 0, yHigh: 3.5, along: 'x', highAt: 'max', color: COL.ramp },
];

function yawTowardCenter(x, z) {
  return Math.atan2(x, z);
}

export const SPAWNS = [
  { x: -36, z: -34 },
  { x: 16, z: -28 },
  { x: 34, z: -22 },
  { x: 36, z: 18 },
  { x: 30, z: 40 },
  { x: 0, z: 26 },
  { x: -32, z: 40 },
  { x: -38, z: 4 },
].map((s) => ({ x: s.x, z: s.z, yaw: yawTowardCenter(s.x, s.z) }));

export const WAYPOINTS = [
  { x: 0, z: 0 },
  { x: 0, z: -20 },
  { x: 0, z: 12 },
  { x: -20, z: -20 },
  { x: 22, z: -20 },
  { x: 34, z: 0 },
  { x: -20, z: 12 },
  { x: 10, z: 40 },
  { x: -20, z: 40 },
  { x: 0, z: 40 },
  { x: -36, z: -20 },
  { x: 24, z: 20 },
];
