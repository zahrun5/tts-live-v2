// Secret & konfigurasi lain dibaca dari server/.env (lihat .env.example),
// jangan ditaruh di file ini karena file ini masuk git.
module.exports = {
  apps: [
    {
      name: 'ttslive-v2-api',
      script: 'index.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 5000, // beri waktu Mongo/jaringan pulih sebelum restart berikutnya
      env: { NODE_ENV: 'production' }
    }
  ]
};
