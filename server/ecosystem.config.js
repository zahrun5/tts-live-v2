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
      env: { NODE_ENV: 'production' }
    }
  ]
};
