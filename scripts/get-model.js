// Se ejecuta en "npm install": baja el modelo de MediaPipe Pose a public/models/ para servirlo localmente.
const https = require('https'), http = require('http'), fs = require('fs'), path = require('path');
const URL_ = process.env.MODEL_URL || 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const dest = path.join(__dirname, '..', 'public', 'models', 'pose_landmarker_lite.task');

const get = (url, left = 5) => new Promise((ok, fail) => {
  (url.startsWith('https') ? https : http).get(url, res => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) { res.resume(); return ok(get(new URL(res.headers.location, url).href, left - 1)); }
    if (res.statusCode !== 200) { res.resume(); return fail(new Error('HTTP ' + res.statusCode)); }
    const tmp = dest + '.part', out = fs.createWriteStream(tmp);
    res.pipe(out); out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); ok(); })); out.on('error', fail); res.on('error', fail);
  }).on('error', fail).setTimeout(20000, function () { this.destroy(new Error('tiempo de espera agotado')); });
});

(async () => {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1e6) return console.log('Modelo de pose ya descargado.');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try { await get(URL_); console.log('Modelo de pose descargado en public/models/'); }
  catch (e) {
    console.warn(`\nNo pude descargar el modelo de pose (${e.message}).\nBajalo a mano desde:\n  ${URL_}\ny guardalo como:\n  ${dest}\n`);
  }
})();
