const Scene = (() => {

  // ===== 1. Constantes para toquetear =====
  const HORIZON = .3;          // altura del portal (0 = arriba, 1 = abajo)
  const SHIP_LINE = .82;       // altura de la estrella
  const PERSPECTIVE = 6;       // cuánto se achican los meteoritos al alejarse
  const DECO_COUNT = 14;       // puntos y destellos de fondo
  const TRAIL_EVERY = .03;     // cada cuántos segundos la estrella suelta una chispa
  const BURST_COUNT = 30;      // partículas al recibir un golpe
  const DEFAULT_HUES = [326, 24, 50, 160, 200, 236, 280];
  const DEFAULT_BG = ['#0a0733', '#140d4d', '#0d0a3b'];
  //const TAIL_MAX_SPEED = .85; //largo de la cola de los meteoritos.


  // ===== 2. Utilidades =====
  const TAU = Math.PI * 2;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
  const font = px => `700 ${px}px Fredoka,"Baloo 2","Trebuchet MS",system-ui,sans-serif`;

  // Dibujan el contorno de una estrella / un destello (después hay que hacer fill o stroke)
  function starPath(ctx, x, y, R, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, d = i % 2 ? r : R;
      ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * d, y + Math.sin(a) * d);
    }
    ctx.closePath();
  }
  function sparklePath(ctx, x, y, R) {
    ctx.beginPath();
    ctx.moveTo(x, y - R);
    ctx.quadraticCurveTo(x, y, x + R, y);
    ctx.quadraticCurveTo(x, y, x, y + R);
    ctx.quadraticCurveTo(x, y, x - R, y);
    ctx.quadraticCurveTo(x, y, x, y - R);
    ctx.closePath();
  }


  function create(canvas, options = {}) {
    const ctx = canvas.getContext('2d');
    const cfg = { CARRILES: 7, METEOR_R: .11, SHIP_HALF: .07, LIVES: 3, ...options.cfg };


    // ===== 3. Estado =====
    let hues = DEFAULT_HUES.slice();
    let bgColors = DEFAULT_BG.slice();

    // Medidas de la pantalla (se calculan en resize)
    let W, H, cx, horizonY, shipY, halfW;

    // Animación
    let time = 0, lastFrame = performance.now(), running = false;
    let shipX = 0, tilt = 0, localShip = null;
    let shake = 0, flash = 0, trailTimer = 0;
    let aim = { lane: -1, charge: 0, press: false, cool: false };

    // Lo último que mandó el servidor
    const state = { p: 'waiting', sx: 0, l: cfg.LIVES, s: 0, b: 0, cd: 0, inv: false, m: [], at: performance.now() };

    const particles = [], decos = [];

    const laneCenter = i => (i + .5) / cfg.CARRILES * 2 - 1;
    const shipRadius = () => cfg.SHIP_HALF * halfW * 1.5;
    const randomHue = () => hues[Math.floor(rnd(0, 7))];

    const newDeco = initial => ({
      a: rnd(0, TAU),
      r: initial ? Math.random() : rnd(0, .05),
      k: Math.floor(rnd(0, 2)),
      h: randomHue(),
      z: rnd(.5, .9),
      v: rnd(.6, 1),
    });
    for (let i = 0; i < DECO_COUNT; i++) decos.push(newDeco(true));


    // ===== 4. Medidas y partículas =====
    function resize() {
      const b = canvas.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
      W = Math.max(1, b.width | 0);
      H = Math.max(1, b.height | 0);
      canvas.width = W * d;
      canvas.height = H * d;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      cx = W / 2;
      horizonY = H * HORIZON;
      shipY = H * SHIP_LINE;
      halfW = Math.min(W * .46, H * .72);
    }

    function burst(x, y) {
      for (let i = 0; i < BURST_COUNT; i++) {
        const a = rnd(0, TAU), speed = rnd(80, 320), life = rnd(.5, 1);
        particles.push({
          x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
          life, maxLife: life, h: hues[i % 7], size: rnd(3, 8), spark: i % 3 === 0,
        });
      }
    }


    // ===== 5. Actualización (movimiento) =====
    function update(dt) {
      time += dt;

      // La estrella sigue a Meteoro si hay uno, si no al valor del servidor  ????
      const target = localShip !== null ? localShip : state.sx, prev = shipX;
      shipX += (target - shipX) * Math.min(1, dt * 16);
      tilt += (clamp((shipX - prev) / Math.max(dt, 1e-3) * .25, -.5, .5) - tilt) * Math.min(1, dt * 10);

      // Fondo
      for (const d of decos) {
        d.r += (.008 + d.r * .1) * d.v * dt;
        if (d.r > 1.25) Object.assign(d, newDeco(false));
      }

      // Efectos del golpe
      shake = Math.max(0, shake - dt * 2.2);
      flash = Math.max(0, flash - dt * 2.5);

      // Partículas
      for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
      for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);

      // Estela de la estrella Meteoro
      if (state.p !== 'over') {
        trailTimer += dt;
        while (trailTimer > TRAIL_EVERY) {
          trailTimer -= TRAIL_EVERY;
          particles.push({
            x: cx + shipX * halfW + rnd(-5, 5), y: shipY + shipRadius() * .8,
            vx: -tilt * 120 + rnd(-15, 15), vy: rnd(70, 140),
            life: .55, maxLife: .55, h: randomHue(), size: rnd(2.5, 5.5),
          });
        }
      }
    }


    // ===== 6. Dibujo del escenario =====
    function drawBackground() {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, bgColors[0]);
      g.addColorStop(.35, bgColors[1]);
      g.addColorStop(1, bgColors[2]);
      ctx.fillStyle = g;
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }

    function drawDecos() {
      for (const d of decos) {
        const s = Math.sin(d.a);
        const x = cx + Math.cos(d.a) * d.r * W * .75;
        const y = horizonY + s * d.r * (s < 0 ? horizonY * 1.35 : (H - horizonY) * 1.05);
        const alpha = Math.min(1, d.r * 5) * (1 - clamp((d.r - .95) / .3, 0, 1));
        if (alpha < .03) continue;
        const size = (2 + d.r * 12) * d.z;
        ctx.globalAlpha = alpha * .45;
        ctx.fillStyle = hsl(d.h, 95, 72);
        if (d.k === 0) { ctx.beginPath(); ctx.arc(x, y, size * .5, 0, TAU); ctx.fill(); }
        else { sparklePath(ctx, x, y, size * 1.1); ctx.fillStyle = '#fff6d6'; ctx.fill(); }
      }
      ctx.globalAlpha = 1;
    }

    // Los carriles: cintas onduladas de colores
    function drawRibbons() {
     const steps = 1, laneW = 2 / cfg.CARRILES;  // steps: tramos por carril (1 = recto, 26 = ondulado); laneW: ancho de cada carril
      for (let i = 0; i < cfg.CARRILES; i++) {
        const h = hues[i % 7], left = [], right = [];
        for (let k = 0; k <= steps; k++) {
          const s = .03 * Math.pow(2.2 / .03, k / steps), lg = Math.log(1 / s);
          const wave = laneCenter(i) + Math.sin(time * .9 + i * 1.7 + lg * 2.2) * .06;
          const edge = laneW * .44 * (1 + .1 * Math.sin(time * 1.3 + i + lg * 3));
          const y = horizonY + (shipY - horizonY) * s;
          left.push([cx + (wave - edge) * halfW * s, y]);
          right.push([cx + (wave + edge) * halfW * s, y]);
        }
        const g = ctx.createLinearGradient(0, horizonY, 0, H);
        g.addColorStop(0, hsl(h, 100, 80, .95));
        g.addColorStop(.35, hsl(h, 95, 62, .55));
        g.addColorStop(1, hsl(h, 90, 55, .28));
        ctx.fillStyle = g;
        ctx.beginPath();
        left.forEach((p, k) => ctx[k ? 'lineTo' : 'moveTo'](p[0], p[1]));
        for (let k = steps; k >= 0; k--) ctx.lineTo(right[k][0], right[k][1]);
        ctx.closePath();
        ctx.fill();

        // Resalta el carril apuntado
        if (aim.lane === i) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = `rgba(255,255,255,${(aim.cool ? .06 : .12) + .3 * aim.charge})`;
          ctx.fill();
          ctx.restore();
        }
      }
    }

    function drawPortal() {
      const R = Math.min(W, H) * .4, g = ctx.createRadialGradient(cx, horizonY, 0, cx, horizonY, R);
      g.addColorStop(0, 'rgba(255,245,215,.7)');
      g.addColorStop(.25, 'rgba(255,225,170,.25)');
      g.addColorStop(1, 'rgba(255,190,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - R, horizonY - R, R * 2, R * 2);
    }

    // El círculo con número que ve el lanzador al apuntar
    function drawAim() {
      if (aim.lane < 0) return;
      const q = .22, k = aim.charge, r = 12 + 18 * k;
      const x = cx + laneCenter(aim.lane) * halfW * q, y = horizonY + (shipY - horizonY) * q;
      ctx.save();
      ctx.globalAlpha = aim.cool ? .35 : 1;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2);
      g.addColorStop(0, 'rgba(255,255,255,.9)');
      g.addColorStop(.4, hsl(hues[aim.lane % 7], 100, 70, .6));
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r * 2, 0, TAU); ctx.fill();
      if (aim.press) {
        ctx.strokeStyle = '#fff3c4'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(x, y, r + 6, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
        ctx.fillStyle = '#2a1450'; ctx.font = font(r); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(1 + Math.round(k * 9), x, y + 1);
      }
      ctx.restore();
    }


    // ===== 7. Dibujo de objetos =====
    function drawMeteor(m) {
      const s = 1 / (1 + PERSPECTIVE * m.t);
      const x = cx + m.x * halfW * s, y = horizonY + (shipY - horizonY) * s, r = cfg.METEOR_R * halfW * s;
      if (r < 1.2) return;

      ctx.save();
      ctx.globalAlpha = clamp((1 - m.t) * 6, 0, 1) * (m.t < -.06 ? clamp(1 - (-.06 - m.t) / .08, 0, 1) : 1);


      // Cola (apunta hacia el portal)


      /*
      
      let dx = cx - x, dy = horizonY - y;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl; dy /= dl;
      const len = r * (1.6 + Math.min(m.v, TAIL_MAX_SPEED) * 3.2), px = -dy, py = dx;
      const tail = ctx.createLinearGradient(x, y, x + dx * len, y + dy * len);
      tail.addColorStop(0, hsl(m.hue, 95, 70, .75));
      tail.addColorStop(1, hsl(m.hue, 95, 70, 0));
      ctx.fillStyle = tail;
      ctx.beginPath();
      ctx.moveTo(x + px * r * .9, y + py * r * .9);
      ctx.quadraticCurveTo(x + dx * len * .6 + px * r * .5, y + dy * len * .6 + py * r * .5, x + dx * len, y + dy * len);
      ctx.quadraticCurveTo(x + dx * len * .6 - px * r * .5, y + dy * len * .6 - py * r * .5, x - px * r * .9, y - py * r * .9);
      ctx.fill();
      
      */


      // Nebulosa (círculo irregular que "respira")
      const N = 9, pts = [];
      for (let k = 0; k < N; k++) {
        const a = k / N * TAU, q = r * (1 + .14 * Math.sin(k * 2.3 + m.seed * 6.28 + time * 2.4));
        pts.push([x + Math.cos(a) * q, y + Math.sin(a) * q]);
      }
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], start = mid(pts[N - 1], pts[0]);
      ctx.beginPath();
      ctx.moveTo(start[0], start[1]);
      for (let k = 0; k < N; k++) {
        const q = mid(pts[k], pts[(k + 1) % N]);
        ctx.quadraticCurveTo(pts[k][0], pts[k][1], q[0], q[1]);
      }
      ctx.closePath();
      const body = ctx.createRadialGradient(x - r * .35, y - r * .35, r * .1, x, y, r * 1.1);
      body.addColorStop(0, hsl(m.hue, 100, 90));
      body.addColorStop(.55, hsl(m.hue, 95, 66));
      body.addColorStop(1, hsl((m.hue + 25) % 360, 90, 46));
      ctx.fillStyle = body;
      ctx.fill();

      // Brillo
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.beginPath(); ctx.ellipse(x - r * .35, y - r * .38, r * .22, r * .12, -.6, 0, TAU); ctx.fill();
      ctx.restore();
    }

    function drawShip() {
      const R = shipRadius();
      ctx.save();
      if (state.inv) ctx.globalAlpha = Math.sin(time * 32) > 0 ? 1 : .35;   // parpadeo al ser golpeada
      ctx.translate(cx + shipX * halfW, shipY + Math.sin(time * 3) * 3);
      ctx.rotate(tilt);

      // Resplandor
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 2.4);
      glow.addColorStop(0, 'rgba(255,230,140,.55)');
      glow.addColorStop(1, 'rgba(255,230,140,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(0, 0, R * 2.4, 0, TAU); ctx.fill();

      // Cuerpo
      starPath(ctx, 0, 0, R, R * .5);
      const body = ctx.createRadialGradient(-R * .2, -R * .3, R * .1, 0, 0, R);
      body.addColorStop(0, '#fff8cf');
      body.addColorStop(1, '#ffc93c');
      ctx.fillStyle = body; ctx.strokeStyle = '#ffd95e'; ctx.lineWidth = R * .28; ctx.lineJoin = 'round';
      ctx.fill(); ctx.stroke();

      // Cara
      ctx.fillStyle = ctx.strokeStyle = '#6a3b12';
      for (const d of [-1, 1]) { ctx.beginPath(); ctx.arc(d * R * .2, 0, R * .07, 0, TAU); ctx.fill(); }
      ctx.lineWidth = R * .07; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, R * .05, R * .2, .15 * Math.PI, .85 * Math.PI); ctx.stroke();
      ctx.restore();
    }

    function drawParticles() {
      for (const p of particles) {
        const k = p.life / p.maxLife;
        ctx.globalAlpha = k;
        ctx.fillStyle = hsl(p.h, 95, 70);
        if (p.spark) { sparklePath(ctx, p.x, p.y, p.size * 1.4); ctx.fill(); }
        else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size * k, 0, TAU); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
    }

    // Vidas, tiempo, récord y cuenta regresiva
    function drawHud() {
      for (let i = 0; i < cfg.LIVES; i++) {
        starPath(ctx, 26 + i * 30, 28, 11, 5.2);
        if (i < state.l) { ctx.fillStyle = '#ffd34d'; ctx.fill(); }
        else { ctx.strokeStyle = 'rgba(255,243,196,.4)'; ctx.lineWidth = 2; ctx.stroke(); }
      }
      ctx.textAlign = 'right'; ctx.fillStyle = '#fff3c4'; ctx.font = font(22);
      ctx.fillText((state.s / 10).toFixed(1) + ' s', W - 16, 34);
      if (state.b) {
        ctx.font = font(14); ctx.globalAlpha = .7;
        ctx.fillText('mejor ' + (state.b / 10).toFixed(1) + ' s', W - 16, 54);
        ctx.globalAlpha = 1;
      }
      if (state.p === 'countdown') {
        ctx.textAlign = 'center'; ctx.font = font(Math.min(W, H) * .3);
        ctx.shadowColor = '#ff9acb'; ctx.shadowBlur = 30;
        ctx.fillText(state.cd, cx, H * .55);
        ctx.shadowBlur = 0;
      }
    }


    // ===== 8. Cuadro completo y bucle =====
    function render() {
      ctx.save();
      if (shake) ctx.translate(rnd(-1, 1) * shake * 10, rnd(-1, 1) * shake * 10);

      drawBackground(); drawDecos(); drawRibbons(); drawPortal(); drawAim();

      // Las nebulosas avanzan un poco entre mensajes del servidor para verse fluidos
      const dt = Math.min(.12, (performance.now() - state.at) / 1000);
      const meteors = state.m.map(m => ({ ...m, t: m.t - m.v * dt })).sort((a, b) => b.t - a.t);

      meteors.forEach(m => m.t > 0 && drawMeteor(m));                 // los que todavía vienen
      drawShip();
      if (state.pn) {                                                   // nombre de quien controla a Meteoro
        ctx.font = font(15); ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,243,196,.9)';
        ctx.fillText(state.pn, cx + shipX * halfW, shipY + shipRadius() * 1.95);
      }
      meteors.forEach(m => m.t <= 0 && m.t > -.16 && drawMeteor(m));  // los que ya pasaron la estrella
      drawParticles();

      if (flash) { ctx.fillStyle = `rgba(255,80,170,${flash * .25})`; ctx.fillRect(-20, -20, W + 40, H + 40); }
      ctx.restore();
      drawHud();
    }

    function loop(now) {
      if (!running) return;
      const dt = Math.min(.05, (now - lastFrame) / 1000);
      lastFrame = now;
      update(dt);
      render();
      requestAnimationFrame(loop);
    }

    new ResizeObserver(resize).observe(canvas);
    resize();


    // ===== 9. Lo que usa cliente.js =====
    return {
      start() { running = true; lastFrame = performance.now(); requestAnimationFrame(loop); },
      setState(s) {
        Object.assign(state, s, {
          m: s.m.map(a => ({ id: a[0], x: a[1], t: a[2], v: a[3], hue: a[4], seed: a[5] })),
          at: performance.now(),
        });
      },
      hit() { shake = 1; flash = 1; burst(cx + shipX * halfW, shipY); },
      setLocalShip(x) { localShip = x; },
      setTheme(t) { hues = t.h.slice(); bgColors = t.bg.slice(); decos.forEach(d => d.h = randomHue()); },
      setAim(lane, charge, press, cool) { aim = { lane, charge, press, cool }; },
      laneAt(x, y) {
        const q = Math.max(.12, (y - horizonY) / (shipY - horizonY)), w = (x - cx) / (halfW * q);
        return clamp(Math.floor((w + 1) / 2 * cfg.CARRILES), 0, cfg.CARRILES - 1);
      },
    };
  }

  return { create };
})();