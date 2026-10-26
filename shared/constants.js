export const PROTOCOL = 1;
export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;
export const SNAP_EVERY = 3;
export const MAX_PLAYERS = 10;
export const MAX_SOCKETS = MAX_PLAYERS + 4;
export const MAX_PER_IP = 4;
export const CONNECT_WINDOW_MS = 10_000;
export const CONNECT_MAX_IN_WINDOW = 8;
export const MAX_PAYLOAD = 4096;
export const PLAYER_RADIUS = 0.35;
export const STAND_H = 1.75;
export const CROUCH_H = 1.25;
export const STAND_EYE = 1.58;
export const CROUCH_EYE = 1.08;
export const STEP_H = 0.55;
export const HIST_LEN = 24;
export const SPAWN_SHIELD = 2;
export const JUMP_V = 8.05;
export const GRAVITY = 24;
export const WALK_SPEED = 4.5;
export const SPRINT_SPEED = 6.4;
export const CROUCH_SPEED = 2.4;
export const SPEED_CAP = 8;
export const AFK_LIMIT = 180;
export const KILLCAM_LIMIT = 60;

export const BTN = {
  F: 1,
  B: 2,
  L: 4,
  R: 8,
  JUMP: 16,
  CROUCH: 32,
  SPRINT: 64,
  FIRE: 128,
  RELOAD: 256,
  ADS: 512,
};

export const SKINS = ['t', 'ct'];
