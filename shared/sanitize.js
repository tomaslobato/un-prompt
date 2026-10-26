import { WEAPON_IDS, WEAPONS } from './weapons.js';
import { SKINS } from './constants.js';

export const RESERVED = new Set(['sombra', 'buitre']);

const CTRL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

export function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  if (raw.length > 48) return null;
  let s = raw.normalize('NFKC').replace(CTRL, '').replace(/[<>&"'`\\]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  const chars = [...s];
  if (chars.length < 2 || chars.length > 16) return null;
  if (!/^[\p{L}\p{N} ._\-]+$/u.test(s)) return null;
  const alnum = s.match(/\p{L}|\p{N}/gu);
  if (!alnum || alnum.length < 2) return null;
  if (RESERVED.has(s.toLowerCase())) return { error: 'reserved' };
  return s;
}

export function sanitizeHello(msg) {
  if (!msg || typeof msg !== 'object') return { error: 'bad' };
  if (msg.t !== 'hello') return { error: 'bad' };
  if (msg.v !== 1) return { error: 'version' };
  if (!SKINS.includes(msg.skin)) return { error: 'bad' };
  if (typeof msg.weapon !== 'string' || !WEAPONS[msg.weapon] || !WEAPON_IDS.includes(msg.weapon)) {
    return { error: 'bad' };
  }
  const name = sanitizeName(msg.name);
  if (!name) return { error: 'name' };
  if (typeof name === 'object') return name;
  return { name, skin: msg.skin, weapon: msg.weapon };
}

export function sanitizeInput(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const yaw = Number(msg.yaw);
  const pitch = Number(msg.pitch);
  const seq = msg.seq;
  const buttons = msg.b;
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
  if (!Number.isInteger(seq) || seq < 0 || seq > 1e15) return null;
  if (!Number.isInteger(buttons) || buttons < 0 || buttons > 1023) return null;
  return {
    yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)),
    pitch: Math.min(1.45, Math.max(-1.45, pitch)),
    seq,
    buttons,
  };
}
