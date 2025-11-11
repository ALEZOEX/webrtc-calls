// keep-alive.js
const https = require('https');

const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://webrtc-calls-633m.onrender.com';

if (process.env.NODE_ENV === 'production') {
  // Пингуем сервер каждые 10 минут чтобы не уснул
  setInterval(() => {
    https.get(RENDER_URL + '/healthz', (res) => {
      console.log('🏓 Keepalive ping:', res.statusCode);
    }).on('error', (err) => {
      console.error('❌ Keepalive error:', err.message);
    });
  }, 10 * 60 * 1000); // 10 минут

  console.log('✅ Keepalive активирован');
}