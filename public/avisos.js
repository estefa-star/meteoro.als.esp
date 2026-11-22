/* avisos.js — lógica y animaciones de los avisos. Sin dependencias.
 * El aspecto (colores, formas, fuentes, paletas) vive en avisos.css.
 *
 *   <link rel="stylesheet" href="avisos.css">
 *   <script src="avisos.js"></script>
 *
 *   Avisos.paleta('aurora');                 // 'orbita' | 'aurora' | 'atardecer' | 'nebulosa'
 *   Avisos.dificultad(3);                    // cometa + "NIVEL 3" + confeti
 *   Avisos.dificultad(4, '¡Más rápido!');
 *   Avisos.indicacion('esquivar');           // mové la cabeza a los lados
 *   Avisos.indicacion('lanzar');             // mantené pulsado
 *   Avisos.ambas();
 *   Avisos.toast('¡Combo x3!');
 *   Avisos.sorteo(['Ana','Beto','Caro','Dani','Eli']);   // 1 esquiva, el resto lanza
 * Todas devuelven una Promise que resuelve cuando termina el aviso.
 */
const Avisos = (() => {
  const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COLORES = 5; // cuántas variables --av-1..--av-N hay en el css

  // rebote "de resorte" para las entradas (si el navegador no lo soporta, usa una curva con rebote)
  const RESORTE = (window.CSS && CSS.supports('animation-timing-function', 'linear(0, 1)'))
    ? 'linear(0, 0.009, 0.035 2.1%, 0.141, 0.281 6.7%, 0.723 12.9%, 0.938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, 0.991, 0.977 51%, 0.974 53.8%, 0.975 57.1%, 0.997 69.8%, 1.003 76.9%, 1.004 83.8%, 1)'
    : 'cubic-bezier(.34, 1.56, .64, 1)';

  const esperar = ms => new Promise(r => setTimeout(r, ms));

  // el contenedor se crea la primera vez que hace falta (así el script puede ir en el <head>)
  let root = null;
  let paletaActual = 'orbita';
  function raiz() {
    if (!root) {
      root = document.createElement('div');
      root.id = 'avisos-root';
      root.dataset.paleta = paletaActual;
      document.body.appendChild(root);
    }
    return root;
  }

  // Cambia los colores: Avisos.paleta('Aurora'). Sin argumentos devuelve la actual.
  function paleta(nombre) {
    if (nombre) {
      paletaActual = String(nombre).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (root) root.dataset.paleta = paletaActual;
    }
    return paletaActual;
  }

  // crea un elemento; el texto va como textContent (nunca como HTML)
  function h(tag, clase, texto) {
    const e = document.createElement(tag);
    if (clase) e.className = clase;
    if (texto != null) e.textContent = texto;
    return e;
  }

  async function mostrar(el, { entra, sale, duracion = 2200, retraso = 0, alAparecer, alEntrar, durante }) {
    raiz().appendChild(el);
    if (alAparecer && !reducido) esperar(retraso + 80).then(alAparecer);
    await el.animate(reducido ? [{ opacity: 0 }, { opacity: 1 }] : entra, {
      duration: reducido ? 250 : 750, delay: reducido ? 0 : retraso,
      easing: reducido ? 'ease-out' : RESORTE, fill: 'both',
    }).finished;
    if (alEntrar && !reducido) alEntrar();
    if (durante) await durante(); // acción que debe terminar antes de contar la pausa final
    await esperar(duracion);
    await el.animate(reducido ? [{ opacity: 1 }, { opacity: 0 }] : sale,
      { duration: 340, easing: 'ease-in', fill: 'both' }).finished;
    el.remove();
  }

  // confeti: puntitos con brillo y algunas estrellas, con los colores de la paleta
  function confeti(x, y, cantidad = 26) {
    const r = raiz();
    for (let i = 0; i < cantidad; i++) {
      const c = h('div', 'av-confeti' + (i % 6 === 0 ? ' estrella' : ''));
      const t = 8 + Math.random() * 10;
      c.style.cssText = `--c:var(--av-${(i % COLORES) + 1});width:${t}px;height:${t}px;left:${x - t / 2}px;top:${y - t / 2}px`;
      r.appendChild(c);
      const ang = Math.random() * Math.PI * 2, d = 80 + Math.random() * 200;
      const dx = Math.cos(ang) * d, dy = Math.sin(ang) * d;
      c.animate([
        { transform: 'translate(0,0) scale(.3) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx}px,${dy}px) scale(1) rotate(${Math.random() * 180}deg)`, opacity: 1, offset: .55 },
        { transform: `translate(${dx * 1.1}px,${dy * 1.1 + 70}px) scale(.5) rotate(${Math.random() * 360}deg)`, opacity: 0 },
      ], { duration: 1000 + Math.random() * 600, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' })
        .finished.then(() => c.remove());
    }
  }

  // cometa: una estrella con cola de puntitos de colores cruza la pantalla en diagonal
  function cometa(duracion = 950) {
    const w = innerWidth, hh = innerHeight;
    const x0 = -170, y0 = hh * (0.1 + Math.random() * 0.1);
    const x1 = w + 170, y1 = hh * (0.4 + Math.random() * 0.15);
    const c = h('div', 'av-cometa');
    c.style.rotate = Math.atan2(y1 - y0, x1 - x0) + 'rad';
    c.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 5l4.4 9.4 10.2 1.3-7.5 7.1 1.9 10.2L20 28l-9 5 1.9-10.2-7.5-7.1 10.2-1.3z"/></svg>';
    [18, 15, 12, 9, 6].forEach((t, i) => {
      const d = h('i');
      d.style.cssText = `--c:var(--av-${i + 1});width:${t}px;height:${t}px;opacity:${(0.95 - i * 0.15).toFixed(2)}`;
      c.appendChild(d);
    });
    raiz().appendChild(c);
    c.animate([{ translate: `${x0}px ${y0}px` }, { translate: `${x1}px ${y1}px` }],
      { duration: duracion, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'forwards' })
      .finished.then(() => c.remove());
  }

  function dificultad(nivel, texto = '¡La dificultad aumenta!') {
    const el = h('div', 'av-nivel');
    el.append(h('i', 'av-blob'), h('em', 'av-pildora', '¡Ojo!'), h('b', '', `Vacío cósmico`), h('span', 'av-sub', texto));
    // orbitas de colores alrededor del blob
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2 + 0.3;
      const t = 12 + ((i * 7) % 5) * 3;
      const o = h('i', 'av-orbe');
      o.style.cssText = `--c:var(--av-${(i % COLORES) + 1});left:${50 + 52 * Math.cos(a)}%;top:${50 + 60 * Math.sin(a)}%;` +
        `width:${t}px;height:${t}px;animation-delay:${-(i * 0.37).toFixed(2)}s`;
      el.appendChild(o);
    }
    if (!reducido) cometa();
    return mostrar(el, {
      entra: [{ transform: 'scale(.15) rotate(-10deg) translateY (-400px)', opacity: 0 }, { transform: 'translateY (-400px)', opacity: 1 }],
      sale:  [{ transform: 'translateY (-400px)', opacity: 1 }, { transform: 'scale(.6) translateY(-430px)', opacity: 0 }],
      retraso: 380, duracion: 400,
      alAparecer: () => confeti(innerWidth / 2, innerHeight * 0.4),
    });
  }

  // los iconos solo llevan clases; colores y trazos se definen en el css
  const ICONOS = {
    esquivar: `<svg viewBox="0 0 92 92" aria-hidden="true">
      <g class="av-dots-i"><circle cx="9" cy="44" r="3.2"/><circle cx="17" cy="44" r="4.4"/><circle cx="26" cy="44" r="5.6"/></g>
      <g class="av-dots-d"><circle cx="83" cy="44" r="3.2"/><circle cx="75" cy="44" r="4.4"/><circle cx="66" cy="44" r="5.6"/></g>
      <g class="av-cabeza">
        <path class="av-cuerpo" d="M28 80q0-22 18-22t18 22z"/>
        <circle class="av-cara" cx="46" cy="40" r="16"/>
        <circle class="av-ojo" cx="40.5" cy="38" r="2.4"/><circle class="av-ojo" cx="51.5" cy="38" r="2.4"/>
        <path class="av-boca" d="M41 45q5 4.6 10 0"/>
      </g></svg>`,
    lanzar: `<svg viewBox="0 0 92 92" aria-hidden="true">
      <circle class="av-pista" cx="46" cy="46" r="27"/>
      <circle class="av-anillo" cx="46" cy="46" r="27"/>
      <g class="av-pelota"><circle class="av-bola" cx="46" cy="46" r="14"/><circle class="av-brillo" cx="41" cy="41" r="4"/></g></svg>`,
  };
  const TEXTOS = {
    esquivar: ['Esquivá', 'Mové la cabeza a los lados'],
    lanzar:   ['Lanzá',   'Mantené pulsado para cargar y soltá'],
  };

  function indicacion(tipo, duracion = 5000) {
    if (!ICONOS[tipo]) return Promise.resolve();
    const el = h('div', `av-card ${tipo}`);
    const ico = h('div', 'av-ico');
    ico.innerHTML = '<i class="av-ico-blob"></i>' + ICONOS[tipo]; // SVG fijo, sin datos de usuarios
    const txt = h('div');
    txt.append(h('h3', '', TEXTOS[tipo][0]), h('p', '', TEXTOS[tipo][1]));
    el.append(ico, txt);
    return mostrar(el, {
      entra: [{ transform: 'translateY(90px) scale(.7)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      sale:  [{ transform: 'none', opacity: 1 }, { transform: 'translateY(50px) scale(.9)', opacity: 0 }],
      duracion,
    });
  }

  async function ambas() { await indicacion('esquivar'); await indicacion('lanzar'); }

  function toast(texto) {
    const el = h('div', 'av-toast', texto);
    return mostrar(el, {
      entra: [{ transform: 'translateY(-40px) scale(.7)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      sale:  [{ opacity: 1 }, { opacity: 0 }],
      duracion: 1200,
    });
  }

  /* Sorteo de roles: un jugador esquiva y el resto lanza.
   *   const i = await Avisos.sorteo(['Ana','Beto','Caro','Dani','Eli']);
   * Para que TODOS los clientes vean el mismo resultado, que el servidor elija
   * el índice y se lo pase a cada uno:  Avisos.sorteo(nombres, indiceDelServidor)
   * Devuelve el índice del jugador que esquiva. */
  function sorteo(jugadores, esquiva) {
    // acepta nombres ('Ana') u objetos ({ nombre: 'Ana' }); el resto de datos se ignora
    jugadores = (jugadores || []).map(j => (j && typeof j === 'object' ? (j.nombre ?? j.name ?? '?') : j));
    const n = jugadores.length;
    if (!n) return Promise.resolve(-1);
    if (!Number.isInteger(esquiva) || esquiva < 0 || esquiva >= n) esquiva = Math.floor(Math.random() * n);

    const el = h('div', 'av-sorteo');
    const fichas = h('div', 'av-fichas');
    const msg = h('p', 'av-sorteo-msg', 'Sorteando…');

    // textContent (no innerHTML): los nombres de otros jugadores no pueden inyectar HTML
    const items = jugadores.map((nombre, i) => {
      const f = h('div', 'av-ficha');
      f.style.setProperty('--col', `var(--av-${(i % COLORES) + 1})`);
      f.append(h('i', '', String(nombre).trim().charAt(0).toUpperCase() || '?'), h('span', '', nombre), h('em'));
      fichas.appendChild(f);
      return f;
    });
    el.append(h('h3', '', 'Sorteo de roles'), fichas, msg);

    async function girar() {
      // Arranca en una ficha cualquiera y da entre 2 y 4 vueltas (al azar) antes de caer
      // justo en `esquiva`; cada salto es más lento. Así nunca se ve igual dos veces.
      // Con "reducir movimiento" también gira (solo cambia el resaltado).
      const inicio = Math.floor(Math.random() * n);
      const vueltas = 2 + Math.floor(Math.random() * 3);
      const pasos = vueltas * n + ((esquiva - inicio + n) % n);
      fichas.classList.add('girando');
      for (let p = 0; p <= pasos; p++) {
        items.forEach((f, i) => f.classList.toggle('on', i === (inicio + p) % n));
        await esperar(70 + 200 * Math.pow(p / pasos, 3));
      }
      fichas.classList.remove('girando');
      items.forEach((f, i) => {
        f.classList.remove('on');
        f.classList.add(i === esquiva ? 'esquiva' : 'lanza');
        f.lastChild.textContent = i === esquiva ? 'Esquiva' : 'Lanza';
      });
      msg.textContent = `${jugadores[esquiva]} esquiva · el resto lanza`;
      if (!reducido) {
        const r = items[esquiva].getBoundingClientRect();
        confeti(r.left + r.width / 2, r.top + r.height / 2);
        items[esquiva].animate(
          [{ rotate: '0deg' }, { rotate: '-9deg' }, { rotate: '9deg' }, { rotate: '-4deg' }, { rotate: '0deg' }],
          { duration: 500 });
      }
    }

    return mostrar(el, {
      entra: [{ transform: 'translateY(60px) scale(.85)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      sale:  [{ transform: 'none', opacity: 1 }, { transform: 'translateY(40px) scale(.9)', opacity: 0 }],
      durante: girar,
      duracion: 2200,
    }).then(() => esquiva);
  }

  return { dificultad, indicacion, ambas, toast, sorteo, paleta };
})();
