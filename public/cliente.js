// ===== 1. Utilidades y estado =====
const $ = s => document.querySelector(s);
const sonar = f => { try { Sonido[f](); } catch (e) { console.warn('Sonido:', e); } };   // si el sonido falla, el juego sigue igual (y avisa en la consola)
addEventListener('pointerdown', () => sonar('init'), { once: true });   // el navegador pide un toque/clic para permitir audio
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cl = (v, a, b) => Math.max(a, Math.min(b, v));
const meteoro = '/recursos/estrella.svg';
const nebulosa = '/recursos/nebulosa.svg'; 
const NUEVA = '__nueva__';   // valor de la opción "Crear sala nueva"

const socket = io();
let me = null, themeName = '', pick = 'orbita', ros = [], cfg, scene;
let rol = '', phase = 'waiting', lastP = '', st = { n: 1 };
let cam = false, act = () => { };
let until = 0, lastEt = -1, lastTt = -1;
let sorteoRoles = Promise.resolve(); //hasta que no se resuelva, no se muestran los roles.
let preparado = false;


// ===== 2. Pantallas (cartel central) =====
const show = (t, d, b, a, skip) => {
  $('#t').textContent = t;
  $('#d').textContent = d;
  $('#btn').textContent = b;
  $('#btn').disabled = false;
  act = a;
  $('#skip').hidden = !skip;
  $('#ov').hidden = false;
};
const draw = () => socket.emit('draw');
const ready = () => socket.emit('ready');
$('#btn').onclick = () => act();
$('#skip').onclick = () => socket.emit('pass');

const lobby = () => show(
  'Sorteo de Meteoro',
  `Hay ${st.n} en este universo. El servidor elige quién esquiva frente a la cámara; todos los demás tiran nebulosas.`,
  'Sortear a Meteoro', draw
);


// ===== 3. Cámara y detección de pose =====
let pose = null,
  noseX = .5,
  neutral = .5,
  present = false,
  steer = 0,
  lastVideo = -1,
  lastTs = 0;

  const RANGO_BASE = .40;        //sensibilidad por defecto del movimiento de la estrella con la cabeza
  const RANGO_POR_ETAPA = .05;  //Cuanto se le elimina cada x tiempo (10 segundos en este caso)
  const RANGO_MIN = .40; //el límite que puede bajar, para que el movimiento no se invierta, o "sin límites" y agregarle un extra de dificultad al momento de invertirse??
  const rangoActual = () => Math.max(RANGO_MIN, RANGO_BASE - RANGO_POR_ETAPA * (st.et || 0));

async function loadPose() {
  if (pose) return;
  const { FilesetResolver, PoseLandmarker } = await import('/mediapipe/vision_bundle.mjs');
  const files = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  const make = delegate => PoseLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate },
    runningMode: 'VIDEO',
    numPoses: 1
  });
  try { pose = await make('GPU'); } catch (e) { pose = await make('CPU'); }
}

function detect() {
  const v = $('#vid');
  if (!pose || v.readyState < 2) return false;
  if (v.currentTime !== lastVideo) {
    lastVideo = v.currentTime;
    lastTs = Math.max(performance.now(), lastTs + 1);
    const n = pose.detectForVideo(v, lastTs).landmarks[0]?.[0];
    present = !!n && (n.visibility ?? 1) > .5;
    if (present) noseX = 1 - n.x;
  }
  return true;
}


function intro() {
  show('¡Te tocó esquivar!', 'Usamos la cámara para seguir tu cabeza', 'Activar cámara', wiz, true);
}

async function wiz() {
  $('#btn').disabled = true;
  $('#d').textContent = 'Abriendo cámara y cargando el detector…';
  try {
    $('#vid').srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    await $('#vid').play();
  } catch (e) {
    $('#btn').disabled = false;
    $('#d').textContent = 'No pude abrir la cámara. Podés usar las flechas del teclado, o pasar el turno.';
    return;
  }
  try { await loadPose(); }
  catch (e) {
    $('#btn').disabled = false;
    $('#d').textContent = 'No pude cargar el detector de pose. Podés reintentar, usar las flechas del teclado, o pasar el turno.';
    return;
  }
  cam = true;
  $('#cam').hidden = false;
  ready();
}


// ===== 4. Control de Meteoro (esquivador) =====
let keyX = 0, shipL = 0, lastSent = 9, lastT = 0;
const keys = {}, dt = .033;

addEventListener('keydown', e => { keys[e.key] = 1; });
addEventListener('keyup', e => { keys[e.key] = 0; });

setInterval(() => {
  if (!scene || rol !== 'esquivador') return;
  let x = null;
  const kd = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
  if (kd) {
    keyX = cl(keyX + kd * dt * 1.8, -1, 1);
    x = keyX;
  } else if (cam && detect()) {                   //rangoActual es el que cambia que tanto hay que moverse para que se mueva la estrella. y el -1 y 1 es el rango el "lienzo"
    if (present) steer += (cl((noseX - neutral) / rangoActual(), -1, 1) - steer) * .4;
    x = steer;
    keyX = steer;
    $('#mk').style.left = noseX * 100 + '%';
  }
  if (x === null) return;
  shipL += cl(x * cfg.SHIP_LIM - shipL, -cfg.SHIP_MAX_SPEED * dt, cfg.SHIP_MAX_SPEED * dt);
  scene.setLocalShip(shipL);
  const n = performance.now();
  if (Math.abs(x - lastSent) > .004 || n - lastT > 250) {
    socket.emit('steer', x);
    lastSent = x;
    lastT = n;
  }
}, 33);


// ===== 5. Lanzamiento de meteoritos (tiradores) =====
const HOLD = 800;
let aim = -1, t0 = 0, hover = -1;
const cvEl = $('#cv');

const laneOf = e => {
  const r = cvEl.getBoundingClientRect();
  return scene.laneAt(e.clientX - r.left, e.clientY - r.top);
};
const charge = () => aim < 0 ? 0 : Math.min(1, (performance.now() - t0) / HOLD);
const cooling = () => performance.now() < until;

cvEl.addEventListener('pointerdown', e => {
  if (rol !== 'lanzador' || phase !== 'empezado' || cooling()) return;
  e.preventDefault();
  cvEl.setPointerCapture(e.pointerId);
  aim = laneOf(e);
  t0 = performance.now();
});
cvEl.addEventListener('pointermove', e => {
  if (rol !== 'lanzador') return;
  const l = laneOf(e);
  if (aim >= 0) aim = l;
  else hover = e.pointerType === 'mouse' ? l : -1;
});
cvEl.addEventListener('pointerleave', () => { if (aim < 0) hover = -1; });
cvEl.addEventListener('contextmenu', e => e.preventDefault());

function release(send) {
  if (aim < 0) return;
  const lane = aim, k = charge();
  aim = -1;
  if (!send || phase !== 'empezado' || cooling()) return;
  const speed = 1 + Math.round(k * 9), wait = cfg.COOLDOWN_BASE + speed * cfg.COOLDOWN_PER;
  until = performance.now() + wait;
  const cd = $('#cd');
  cd.style.transition = 'none';
  cd.style.width = '100%';
  cd.offsetWidth;
  cd.style.transition = `width ${wait}ms linear`;
  cd.style.width = '0';
  socket.emit('throw', { lane, speed }, r => { if (!r.ok && r.wait) until = performance.now() + r.wait; });
}
cvEl.addEventListener('pointerup', () => release(true));
cvEl.addEventListener('pointercancel', () => release(false));

setInterval(() => {
  if (!scene) return;
  const press = aim >= 0;
  scene.setAim(press ? aim : (rol === 'lanzador' && phase === 'empezado' ? hover : -1), charge(), press, cooling());
}, 33);


// ===== 6. Entrada a la sala y temas =====
const dots = h => h.map(x => `<i style="background:hsl(${x},90%,62%)"></i>`).join('');

function buildThemes() {
  const T = $('#ths');
  T.innerHTML = '';
  for (const k in cfg.THEMES) {
    const b = document.createElement('button');
    b.className = 'th' + (k === pick ? ' on' : '');
    b.dataset.k = k;
    b.innerHTML = `${cfg.THEMES[k].n}<br>${dots(cfg.THEMES[k].h.slice(0, 5))}`;
    b.onclick = () => { pick = k; buildThemes(); };
    T.appendChild(b);
  }
}

function applyTheme(k) {
  Avisos.paleta(k in cfg.THEMES ? k : 'orbita');
  const t = cfg.THEMES[k] || cfg.THEMES.orbita;
  themeName = t.n;
  scene.setTheme(t);
  document.body.style.background = t.bg[0];
}

function showEntry(err) {
  $('#ov').hidden = true;
  $('#roster').hidden = true;
  $('#pan').hidden = true;
  $('#cam').hidden = true;
  $('#entry').hidden = false;
  $('#err').textContent = err || '';
  scene.setState({ p: 'waiting', sx: 0, l: cfg.LIVES, s: 0, b: 0, cd: 0, inv: false, m: [], pn: '' });
  scene.setLocalShip(null);
  socket.emit('rooms', list => {
    const S = $('#rm'), prev = S.value;
    S.innerHTML = '';
    const temas = {};
    const add = (code, label) => {
      const o = document.createElement('option');
      o.value = code;
      o.textContent = label;
      S.appendChild(o);
    };
    if (!list.some(r => r.code === 'GENERAL')) add('GENERAL', 'GENERAL · nuevo');
    list.forEach(r => { temas[r.code] = r.theme; add(r.code, `${r.code} · ${cfg.THEMES[r.theme].n} · ${r.n}`); });
    if ([...S.options].some(o => o.value === prev)) S.value = prev;
    list.forEach(r => { temas[r.code] = r.theme; add(r.code, `${r.code} · ${cfg.THEMES[r.theme].n} · ${r.n}`); });
    add(NUEVA, '+ Crear sala nueva…');
    if ([...S.options].some(o => o.value === prev)) S.value = prev;
    S.onchange = () => {
      $('#rmNuevo').hidden = S.value !== NUEVA;
      if (temas[S.value]) { pick = temas[S.value]; buildThemes(); }
    };
    S.onchange();
  });
}

const celu = () => matchMedia('(max-width: 600px), (pointer: coarse)').matches;

function enter(a) {
  socket.emit('enter', a, r => {
    if (!r.ok) { me = null; return showEntry(r.msg); }
    me = { name: r.name, room: r.room, theme: r.theme };
    applyTheme(r.theme);
    $('#entry').hidden = true;
    $('#roster').hidden = false;
    $('#rb').hidden = celu();   // cerrada en celu, abierta en compu
  });
}

$('#go').onclick = () => {
  const crear = $('#rm').value === NUEVA;
  if (crear && !$('#rmNuevo').value.trim()) { $('#err').textContent = 'Escribe un nombre para la sala nueva'; return; }
  enter({ name: $('#nm').value, room: crear ? $('#rmNuevo').value : $('#rm').value, theme: pick });
  sonar('musica');
};


// ===== 7. Lista de jugadores y ranking =====
$('#rh').onclick = () => $('#rb').hidden = !$('#rb').hidden;
if (innerWidth < 600) $('#rb').hidden = true;

const MEDALLAS = ['1ro', '2do', '3er'];

//función del ranking al final

function mostrarRanking() {
  const lista = $('#rk');
  lista.innerHTML = '';
  ros
    .filter(p => p.kills > 0 || p.hits > 0)
    .sort((a, b) => b.kills - a.kills || b.hits - a.hits)
    .slice(0, 10)
    .forEach((p, i) => {
      const li = document.createElement('li'), nombre = document.createElement('span'), datos = document.createElement('span');
      nombre.textContent = `${MEDALLAS[i] || (i + 1) + '.'} ${p.name}`;
      datos.textContent = `${p.kills} · ${p.hits} impactos`;
      if (p.id === socket.id) li.className = 'me';
      li.append(nombre, datos);
      lista.appendChild(li);
    });
  lista.hidden = lista.children.length === 0;
}

socket.on('roster', P => {
  ros = P;
  $('#rt').textContent = `Jugadores (${P.length})`;
  const L = $('#rl');
  L.innerHTML = '';
  [...P].sort((a, b) => b.esquivador - a.esquivador || b.hits - a.hits).forEach(p => {
    const li = document.createElement('li'), a = document.createElement('span'), b = document.createElement('span');
    const icono = document.createElement('img');
    icono.src = p.esquivador ? meteoro : nebulosa;
    icono.width = 16;
    a.textContent = ' ' + p.name;
    a.prepend(icono);
    b.textContent = p.esquivador ? 'meteoro' : p.hits;
    if (p.id === socket.id) li.className = 'me';
    li.append(a, b);
    L.appendChild(li);
  });
});


// ===== 8. Eventos del servidor =====
socket.on('welcome', c => {
  cfg = c;
  if (!scene) {
    scene = Scene.create($('#cv'), { cfg: c });
    scene.start();
    buildThemes();
  }
  if (me) enter(me); else showEntry();
});

socket.on('sorteo', ({ nombres, esquiva}) => {
  $('#ov').hidden = true;
  sorteoRoles = Avisos.sorteo(nombres, esquiva);
});

socket.on('rol', async r => {
  await sorteoRoles;
  rol = r;
  $('#entry').hidden = true;
  $('#pan').hidden = r !== 'lanzador';
  $('#cam').hidden = !(r === 'esquivador' && cam);
  shipL = 0;
  if (r !== 'esquivador') scene.setLocalShip(null);
  if (r === 'lobby') lobby();
  else if (r === 'lanzador') $('#ov').hidden = true;
  else if (cam) ready();
  else intro();
});


socket.on('hit', () => { scene.hit(); sonar('impacto'); });
socket.on('scored', d => $('#hits').textContent = d.hits);

socket.on('state', s => {
  st = s;
  scene.setState(s);
  phase = s.p;
  if (s.p === 'empezado') {                                   // sonido de aceleración al subir la dificultad
    if (lastEt >= 0 && s.et > lastEt)
      { sonar('acelera');
    Avisos.toast(`¡Las nebulosas van más rápidas!`);
  }
    lastEt = s.et;

    if (lastTt <= 0 && s.tt > lastTt); //Avisos.toast(`¡${Math.round(s.s / 100)} segundos!`);
    lastTt = s.tt;
  } else lastEt = -1, lastTt = -1;
  $('#chip').textContent = me ? `${themeName} · ${me.room} · ${s.n} ${s.n === 1 ? 'jugador' : 'jugadores'}` : '';
  cvEl.style.cursor = rol === 'lanzador' && s.p === 'empezado' ? 'crosshair' : 'default';
  $('#msg').textContent = rol === 'lanzador' && s.p === 'waiting' ? (s.esquivador ? `${s.pn} se está preparando…` : '') : '';
  if (s.p === 'over' && preparado) $('#btn').textContent = `Esperando a los demás (${s.ls}/${s.n})`;
  if (s.p !== lastP) {
    lastP = s.p;
    if (s.p === 'countdown') Avisos.indicacion(rol === 'esquivador' ? 'esquivar' : 'lanzar');
    if (s.p === 'countdown' || s.p === 'empezado') $('#ov').hidden = true;                 //ranking 
    if (s.p === 'over') {
      sonar('gameOver');
      preparado = false
      const golpe = s.k ? `${s.k} destruyó la estrella. ` : '';
      show('Fin del viaje', `${golpe}${s.pn} aguantó ${(s.s / 10).toFixed(1)} s (mejor: ${(s.b / 10).toFixed(1)} s). ¿Sorteamos de nuevo?`, 'Sortear de nuevo', () => {preparado = true; $('#btn').disabled = true; draw(); });
      mostrarRanking();
}
}});