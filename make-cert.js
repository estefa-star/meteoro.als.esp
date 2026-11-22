// Genera un certificado autofirmado (certs/llave.pem y certs/certificado.pem) válido para localhost y las IPs de esta máquina.
const { execFileSync } = require('child_process'), os = require('os'), fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'certs');

function makeCert() {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => (i.family === 'IPv4' || i.family === 4) && !i.internal).map(i => i.address);
  const san = ['DNS:localhost', 'IP:127.0.0.1', 'IP:::1', ...ips.map(ip => 'IP:' + ip)].join(',');
  fs.mkdirSync(dir, { recursive: true });
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365', '-subj', '/CN=meteoro', '-addext', 'subjectAltName=' + san,
    '-keyout', path.join(dir, 'llave.pem'), '-out', path.join(dir, 'certificado.pem')], { stdio: 'ignore' });
  } catch (e) {
    throw new Error('No pude generar el certificado: hace falta tener OpenSSL instalado (o definí SSL_KEY y SSL_CERT con tus propios archivos).');
  }
  return dir;
}

module.exports = { makeCert, dir };
if (require.main === module) console.log('Certificado generado en ' + makeCert());
