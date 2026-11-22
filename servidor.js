// ===== 1. Dependencias y servidor HTTPS =====
const path = require('path'), os = require('os'), fs = require('fs');
const express = require('express'), { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const app = express();

// Esto dice que el servidor online el https lo ponela pag
// En el local sigue siendo https por la camara
const usarHttp = !!(process.env.RENDER || process.env.USE_HTTP);
let server;
if (usarHttp) {
  server = require('http').createServer(app);
} else {
  const keyFile = process.env.SSL_KEY || path.join(__dirname, 'certs', 'llave.pem');
  const certFile = process.env.SSL_CERT || path.join(__dirname, 'certs', 'certificado.pem');
  if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) require('./make-cert').makeCert();
  server = require('https').createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, app);
}
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/mediapipe', express.static(path.join(__dirname, 'node_modules', '@mediapipe', 'tasks-vision'), {
  setHeaders: (res, f) => {
    if (f.endsWith('.mjs')) res.setHeader('Content-Type', 'text/javascript');
    else if (f.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
  },
}));


// temas de las salas y configuracion
const THEMES = {
  orbita:    { n: 'Órbita',    h: [326, 24, 50, 160, 200, 236, 280], bg: ['#0a0733', '#140d4d', '#0d0a3b'] },
  aurora:    { n: 'Aurora',    h: [150, 170, 190, 210, 130, 95, 260], bg: ['#021a1f', '#06343a', '#04222a'] },
  atardecer: { n: 'Atardecer', h: [350, 10, 25, 40, 55, 330, 300],   bg: ['#2a0a2e', '#4a1239', '#2a0c2a'] },
  nebulosa:  { n: 'Nebulosa',  h: [270, 290, 310, 250, 230, 330, 200], bg: ['#0d0630', '#1d0b52', '#10063a'] },
};

// Lo que se le manda al cliente
const CLIENT = {
   LANES: 7,             //cantidad de carriles
   LIVES: 3,
   SHIP_HALF: 0.04,      //colisión de la estrella
   METEOR_R: 0.11,       //radio de choque del meteorito, tanto para dibujarlo como para el choque
   SHIP_LIM: 0.92,       //distancia máxima de la pantalla que puede ir la estrella
   SHIP_MAX_SPEED: 5,    //velocidad máxima de la estrella
   COOLDOWN_BASE: 400,   //espera mínima por lanzamiento en ms
   COOLDOWN_PER: 80,     //esta espera se suma por nivel (como es máximo nivel 10 se suma hasta 800 ms)
   THEMES,
};

// Lo del cliente + lo que solo usa el servidor
const CFG = {
  ...CLIENT,
  SPEED_MIN: 0.18,
   SPEED_MAX: 0.85,
   MAX_METEORS: 12,    //cantidad de meteoritos en pantalla.
   MAX_PLAYERS: 10, 
   INVULN: 1.6,        //invencibilidad.
   COUNTDOWN: 5,       //segundos antes de iniciar.
   HIT_T: 0.03,        //distancia que detecta el meteorito impactando.
   REMOVE_T: -0.14,    //distancia que se borra el meteorito que ya pasó
};

// ===== 3. Utilidades y salas =====
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const laneX = i => ((i + 0.5) / CFG.LANES) * 2 - 1;
const sock = id => io.sockets.sockets.get(id);
const etapa = R => Math.floor(R.time / 20);  //etapa de dificultad que sube cada x tiempo marcado ahí, en este caso 10 seg.
//const TOAST_CADA = 100;
//const tiempoToast = R => Math.floor(R.time / 100);  //cambiar tanto este como el de arriba para 100 segundos.
const rooms = new Map();
const newRoom = (code, theme) => ({
  code, theme, phase: 'waiting', esquivador : null, ship: 0, target: 0, lives: CFG.LIVES,
  time: 0, inv: 0, cd: 0, best: 0, seq: 0, m: [], players: new Set(),
});
const toWaiting = R => Object.assign(R, { phase: 'waiting', ship: 0, target: 0, lives: CFG.LIVES, time: 0, inv: 0, m: [] });
const start = R => Object.assign(R, { phase: 'countdown', cd: CFG.COUNTDOWN, lives: CFG.LIVES, time: 0, inv: 0, m: [] });

const roster = R => io.to(R.code).emit('roster',
  [...R.players].map(sock).filter(Boolean).map(s => ({
    id: s.id, name: s.data.name, hits: s.data.hits || 0, kills: s.data.kills || 0,esquivador: s.id === R.esquivador,
  }))
);


// ===== 4. Simulación (física y colisiones) =====
function step(R, dt) {
  const d = clamp(R.target - R.ship, -CFG.SHIP_MAX_SPEED * dt, CFG.SHIP_MAX_SPEED * dt);
  R.ship = clamp(R.ship + d, -CFG.SHIP_LIM, CFG.SHIP_LIM);

  if (R.phase === 'countdown') {
    R.cd -= dt;
    if (R.cd <= 0) { R.phase = 'empezado'; R.cd = 0; }
    return;
  }
  if (R.phase === 'empezado') { R.time += dt; R.inv = Math.max(0, R.inv - dt); }
  if (R.phase === 'waiting') return;

  for (const m of R.m) {
    m.t -= m.v * dt;
    if (R.phase === 'empezado' && !m.done && m.t <= CFG.HIT_T) {
      m.done = true;
      if (R.inv <= 0 && Math.abs(m.x - R.ship) < CFG.SHIP_HALF + CFG.METEOR_R) {
        m.hit = true;
        R.lives--;
        R.inv = CFG.INVULN;
        io.to(R.code).emit('hit');
        const o = sock(m.owner);
          if (o) {
          o.data.hits = (o.data.hits || 0) + 1;
          if (R.lives <= 0) o.data.kills = (o.data.kills || 0) + 1;   // golpe final
          o.emit('scored', { hits: o.data.hits });
          roster(R);
        }
        if (R.lives <= 0) {
          R.phase = 'over';
          R.killer = m.ownerName;
          R.best = Math.max(R.best, Math.floor(R.time * 10));
        }
      }
    }
  }
  R.m = R.m.filter(m => m.t > CFG.REMOVE_T && !m.hit);
}


// ===== 5. Bucles (simulación 60/s, envío de estado 30/s) =====
let last = Date.now();
setInterval(() => {
  const n = Date.now(), dt = Math.min(0.05, (n - last) / 1000);
  last = n;
  for (const R of rooms.values()) step(R, dt);
}, 1000 / 60);

setInterval(() => {
  for (const R of rooms.values()) {
    io.to(R.code).emit('state', {
      et: etapa(R),
      //tt: tiempoToast(R),
      k: R.phase === 'over' ? R.killer : '',
      p: R.phase,
      sx: +R.ship.toFixed(3),
      l: R.lives,
      s: Math.floor(R.time * 10),
      b: R.best,
      cd: Math.ceil(R.cd),
      inv: R.inv > 0,
      m: R.m.map(m => [m.id, +m.x.toFixed(3), +m.t.toFixed(3), m.v, m.hue, m.seed]),
      esquivador: !!R.esquivador,
      pn: R.esquivador && sock(R.esquivador) ? sock(R.esquivador).data.name : '',
      n: R.players.size,
    });
  }
}, 1000 / 30);


// ===== 6. Sorteo de Meteoro y salida de salas =====
function draw(R, exclude) {
  const all = [...R.players].map(sock).filter(Boolean);
  if (!all.length) return;
  const pool = all.filter(s => s.id !== exclude), list = pool.length ? pool : all;
  const pick = list[Math.floor(Math.random() * list.length)];
  R.esquivador = pick.id;
  toWaiting(R);
  io.to(R.code).emit('sorteo', { nombres: all.map(s => s.data.name), esquiva: all.indexOf(pick) });
  for (const s of all) {
    s.data.rol = s === pick ? 'esquivador' : 'lanzador';
    s.emit('rol', s.data.rol);
  }
  roster(R);
}

function leave(socket) {
  const R = rooms.get(socket.data.room);
  if (!R) return;
  R.players.delete(socket.id);
  socket.leave(R.code);
  socket.data.room = null;
  socket.data.rol = null;
  if (R.esquivador === socket.id) {
    R.esquivador = null;
    toWaiting(R);
    for (const s of [...R.players].map(sock).filter(Boolean)) { s.data.rol = 'lobby'; s.emit('rol', 'lobby'); }
  }
  if (!R.players.size) rooms.delete(R.code); else roster(R);
}


// ===== 7. Eventos de cada jugador =====
io.on('connection', socket => {
  socket.emit('welcome', CLIENT);
  const rm = () => rooms.get(socket.data.room);

  // Lista de salas activas (las 8 con más gente)
  socket.on('rooms', (cb = () => {}) => cb(
    [...rooms.values()].sort((a, b) => b.players.size - a.players.size).slice(0, 8)
      .map(R => ({ code: R.code, theme: R.theme, n: R.players.size }))
  ));

  // Entrar a una sala (se crea si no existe)
  socket.on('enter', (a, cb = () => {}) => {
    a = a || {};
    const name = String(a.name || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 14) || 'Jugador';
    const code = String(a.room || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12) || 'GENERAL';
    leave(socket);
    let R = rooms.get(code);
    if (R && R.players.size >= CFG.MAX_PLAYERS) return cb({ ok: false, msg: 'La sala está llena' });
    if (!R) { R = newRoom(code, THEMES[a.theme] ? a.theme : 'orbita'); rooms.set(code, R); }
    Object.assign(socket.data, { name, room: code, hits: 0, kills: 0, rol: R.esquivador ? 'lanzador' : 'lobby' });
    socket.join(code);
    R.players.add(socket.id);
    cb({ ok: true, theme: R.theme, room: code, name });
    socket.emit('rol', socket.data.rol);
    roster(R);
  });

  socket.on('leave', () => leave(socket));

  // Sorteo y turnos
  socket.on('draw', () => {
    const R = rm();
    if (R && (!R.esquivador || R.phase === 'over')) draw(R, R.phase === 'over' ? R.esquivador : null);
  });
  socket.on('pass', () => {
    const R = rm();
    if (R && socket.id === R.esquivador && R.phase !== 'empezado' && R.phase !== 'countdown') draw(R, socket.id);
  });
  socket.on('ready', () => {
    const R = rm();
    if (R && socket.id === R.esquivador && R.phase !== 'countdown' && R.phase !== 'empezado') start(R);
  });

  // Movimiento de Meteoro (solo el esquivador)
  socket.on('steer', x => {
    const R = rm();
    if (R && socket.id === R.esquivador && Number.isFinite(x)) R.target = clamp(x, -1, 1) * CFG.SHIP_LIM;
  });

  // Lanzar un meteorito (solo los tiradores)
  socket.on('throw', (a, cb = () => {}) => {
    const R = rm();
    if (!R || socket.data.rol !== 'lanzador' || R.phase !== 'empezado' || !a) return cb({ ok: false, reason: 'inactivo' });
    const lane = Math.round(+a.lane), speed = clamp(Math.round(+a.speed), 1, 10), now = Date.now();
    if (!(lane >= 0 && lane < CFG.LANES)) return cb({ ok: false, reason: 'bad' });
    const wait = (socket.data.next || 0) - now;
    if (wait > 0) return cb({ ok: false, reason: 'cooldown', wait });
    if (R.m.length >= CFG.MAX_METEORS) return cb({ ok: false, reason: 'full' });
    socket.data.next = now + CFG.COOLDOWN_BASE + speed * CFG.COOLDOWN_PER;
    const hs = THEMES[R.theme].h;
    R.m.push({
      id: ++R.seq,
      owner: socket.id,
      ownerName: socket.data.name,
      x: laneX(lane),
      t: 1,
      v: +((CFG.SPEED_MIN + ((speed - 1) / 9) * (CFG.SPEED_MAX - CFG.SPEED_MIN)) * (1 + 0.15 * etapa(R))).toFixed(3),  //el último paréntesis que se multiplica por etapa(R) es el multiplicador de velocidad, 
                                                                                                                      //en este caso cada aumento de dificultad se suma un 50% o 0.5 a 1 de velocidad. 
      hue: hs[Math.floor(Math.random() * hs.length)],
      seed: +Math.random().toFixed(2),
      owner: socket.id,
    });
    cb({ ok: true });
  });

  socket.on('disconnect', () => leave(socket));
});


// arranque del servidor 
server.listen(PORT, () => {
  if (usarHttp) return console.log(`Servidor en http, puerto ${PORT} (el HTTPS lo pone la plataforma).`);
  const ip = Object.values(os.networkInterfaces()).flat().find(i => (i.family === 'IPv4' || i.family === 4) && !i.internal);
  console.log(`Jugar en esta compu: https://localhost:${PORT}`);
  if (ip) console.log(`Celulares / otras compus (misma red): https://${ip.address}:${PORT}`);
  console.log('El certificado es autofirmado: el navegador va a avisar una vez; elegí "Avanzado" > "Continuar".');
});