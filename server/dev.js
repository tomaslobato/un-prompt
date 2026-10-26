import { spawn } from 'node:child_process';
import process from 'node:process';

const env = { ...process.env, DEV: '1', PORT: process.env.PORT || '8787' };
const server = spawn(process.execPath, ['server/index.js'], { stdio: 'inherit', env });
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', env });

function shutdown(code = 0) {
  server.kill('SIGTERM');
  vite.kill('SIGTERM');
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
server.on('exit', (code) => {
  vite.kill('SIGTERM');
  process.exit(code ?? 0);
});
vite.on('exit', (code) => {
  server.kill('SIGTERM');
  if (code) process.exit(code);
});
