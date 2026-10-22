# 越王勾践剑 · 游戏平台

单机剧情游戏「越王勾践剑」的联机平台：游客登录、聊天大厅、排行榜、联机对战（比剑）。

## 本地运行

```bash
npm install
npm start        # 或 node server.js
```

打开 http://localhost:3000 （大厅），点「进入剧情游戏」打开 `/game`。

## 部署到 Render（免费）

1. 把本目录 `platform/` 推到一个 **GitHub 仓库**（`git init && git add . && git commit && git push`）。
2. 打开 [render.com](https://render.com)，注册/登录，点 **New → Web Service**，连接你的 GitHub 仓库。
3. 配置：
   - **Build Command**：`npm install`
   - **Start Command**：`node server.js`
4. 加免费数据库（让排行榜持久化）：
   - 点 **New → PostgreSQL**，创建一个免费 Postgres 实例。
   - 回到你的 Web Service 设置页，找到 **Environment**，把刚才的 Postgres 实例加进去——Render 会自动注入 `DATABASE_URL`。
5. 点 **Create Web Service**，等部署完成，拿到公网 URL（形如 `https://xxx.onrender.com`）。
6. 把 URL 发给朋友即可。

## 免费档注意

- **会休眠**：15 分钟没访问就休眠，下次访问要等几十秒冷启动。
- **排行榜持久化**：配置了 `DATABASE_URL`（上面第 4 步）后，战绩存入 Postgres，重启/休眠不丢；没配则退回内存态（本地开发用）。
- **单核 512MB**：够几十人同时玩；要 10000 人需升级付费档或自建服务器。
- **游戏文件 67MB**：首次部署和冷启动会稍慢。

## 文件说明

- `server.js`：Node.js + Express + Socket.IO 后端（cluster 多进程 + 主进程权威状态）
- `public/index.html`：大厅页（登录/聊天/排行榜/对战）
- `public/game.html`：原单机剧情游戏（玩法剧情未改动）
- `public/relics.html`：文物图鉴（55 件文物 + AI 讲解 + 猜文物测验 + 两个小游戏）
- `public/puzzle.html`：文物修复大师 · 3×3 拼图（29 关，关卡顺序随机）
- `public/xunmai.html`：寻脉 · 一笔画（16 件文物）
