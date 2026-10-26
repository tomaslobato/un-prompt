export const REASONS = {
  name: 'El nombre necesita entre 2 y 16 letras o números.',
  taken: 'Ese nombre ya está en la arena.',
  reserved: 'Ese nombre está reservado.',
  full: 'La arena está llena. Espera un momento y entra de nuevo.',
  bad: 'Esos datos no valen.',
  version: 'Hay una versión nueva. Recarga la página.',
  ip: 'Hay demasiadas conexiones desde tu red.',
  rate: 'Demasiados intentos seguidos. Espera unos segundos.',
  timeout: 'El servidor no responde. Si está en un plan gratuito, puede tardar un minuto en despertar.',
  closed: 'Se cortó la conexión.',
  webgl: 'Este navegador no pudo iniciar los gráficos 3D.',
  tab: 'Ya hay una partida abierta en otra pestaña de este navegador.',
  afk: 'Te desconectamos por inactividad.',
  spectate: 'Se acabó el tiempo de la killcam.',
  slow: 'La conexión iba demasiado lenta.',
  idle: 'Se perdió la conexión.',
  hello: 'La entrada tardó demasiado.',
  kick: 'El servidor cerró la partida.',
};

export function reasonText(code) {
  return REASONS[code] || 'No se pudo continuar.';
}

export function skinLabel(skin) {
  return skin === 'ct' ? 'Antiterrorista' : 'Terrorista';
}
