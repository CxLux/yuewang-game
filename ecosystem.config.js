// PM2 进程管理配置
// 用法：pm2 start ecosystem.config.js
//
// ⚠️ 注意：server.js 内部已用 Node cluster 多进程（自动 fork 满所有 CPU 核），
// 所以这里用【单实例 fork 守护】即可，不要再叠 -i max（会双重多进程 + 端口冲突）。
module.exports = {
  apps: [{
    name: 'wenshu-xunji',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,               // 崩溃自动重启
    max_memory_restart: '512M',      // 单进程内存超 512M 自动重启
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      // 配了 Postgres 才持久化排行榜（可选），格式：
      // DATABASE_URL: 'postgres://user:pass@127.0.0.1:5432/platform',
      // 横向扩容时用（可选）：
      // REDIS_URL: 'redis://127.0.0.1:6379',
    },
  }],
};
