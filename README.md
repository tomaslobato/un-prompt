# un prompt

Shooter 3D en el navegador. El servidor simula la partida: los clientes solo envían botones y hacia dónde miran. Si hay un solo jugador, aparecen dos reclutas (Sombra y Buitre).

## Controles

WASD mover, ratón mirar, clic disparar, clic derecho apuntar, R recargar, Ctrl o C agacharse, Shift correr, Espacio saltar. Sin ratón: flechas para mirar y F para disparar. M silencia. Esc suelta el ratón; desde ahí se puede abandonar la partida.

## Local

Hace falta Node 20 o superior.

```bash
npm install
npm test
npm run dev
```

El menú queda en http://localhost:5173. Para la versión que se despliega:

```bash
npm run build
npm start
```

Eso sirve el juego y el WebSocket en el puerto 8787 (o en `PORT`).

## Hosting gratuito

El proceso es uno solo: archivos estáticos y WebSocket. En [Render](https://render.com) el plan free admite WebSockets. El servicio se duerme tras 15 minutos sin tráfico y el primer visitante espera cerca de un minuto; el cliente reintenta solo. El plan incluye 750 horas al mes: un ping cada 10 minutos lo mantiene despierto.

1. Sube este repositorio a GitHub o a Render.
2. New → Blueprint, o Web Service con el plan Free.
3. Build: `npm install && npm run build`
4. Start: `npm start`
5. Health check: `/health`
6. Variables: `NODE_ENV=production`, `TRUST_PROXY=1`, `NODE_VERSION=22`

`render.yaml` deja eso escrito. Opcional: en [cron-job.org](https://cron-job.org) un GET a `https://tu-servicio.onrender.com/health` cada 10 minutos. El health check de Render no evita el sueño.

El `Dockerfile` vale para cualquier host que ejecute Node 22.

## Límites

Hasta 10 jugadores. Hasta 4 conexiones por IP, para no cortar a una casa que comparte red. Dos pestañas del mismo navegador no pueden jugar a la vez: la segunda ve el botón de jugar desactivado. El daño, la munición, el retroceso y el movimiento los calcula el servidor.
