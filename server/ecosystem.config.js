module.exports = {
  apps: [
    {
      name: 'ttslive-v2-api',
      script: 'index.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      env: { 
        NODE_ENV: 'production',
        PORT: 3050,
        MONGO_URI: 'mongodb://127.0.0.1:27017/ttslive',
        JWT_SECRET: 'mamang_harun_rahasia_v2_2026'
      }
    }
  ]
};
