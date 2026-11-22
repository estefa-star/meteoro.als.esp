// Sonidos simples hechos con Web Audio (sin archivos).
const Sonido = (() => {
  let ctx, timer;

  const init = () => {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  };

  // Una nota: frecuencia, cuándo empieza (seg), duración, volumen, tipo de onda, frecuencia final (opcional)
  const nota = (f, t, dur, vol = .2, tipo = 'sine', fin = f) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = tipo;
    o.frequency.setValueAtTime(f, ctx.currentTime + t);
    o.frequency.exponentialRampToValueAtTime(fin, ctx.currentTime + t + dur);
    g.gain.setValueAtTime(vol, ctx.currentTime + t);
    g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + t);
    o.stop(ctx.currentTime + t + dur);
  };

  const FONDO = [220, 261.6, 329.6, 261.6, 196, 246.9, 293.7, 246.9];   // melodía que se repite
  let i = 0;

  return {
    init,
    musica() {                                   // sonido de fondo constante
      init();
      if (timer) return;
      timer = setInterval(() => nota(FONDO[i++ % FONDO.length], 0, .6, .15, 'triangle'), 500);
    },
    impacto()  { init(); nota(150, 0, .4, .5, 'sawtooth', 40); },                                      // choque
    acelera()  { init(); nota(200, 0, .5, .15, 'square', 1200); },                                     // sube la dificultad
    gameOver() { init(); [400, 330, 260, 200].forEach((f, k) => nota(f, k * .3, .4, .25, 'triangle')); }, // fin del juego
  };
})();
