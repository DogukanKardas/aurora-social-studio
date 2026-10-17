// Yerel çalıştırma: node server.js  →  http://127.0.0.1:3000
// (Vercel'de aynı uygulama api/index.js üzerinden çalışır.)
'use strict';
const http = require('http');
const path = require('path');
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* .env isteğe bağlı */ }
const handle = require('./lib/app.js');

const PORT = Number(process.env.PORT || 3000);
http.createServer(handle).listen(PORT, '127.0.0.1', () =>
  console.log(`\n  Aurora Social Studio çalışıyor → http://127.0.0.1:${PORT}\n  Kapatmak için bu pencereyi kapat (veya Ctrl+C).\n`));
