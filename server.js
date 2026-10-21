// 越王勾践剑 · 游戏平台后端（多进程 cluster + 主进程权威状态 + 擂台对战）
// 技术栈：Node.js + Express + Socket.IO + @socket.io/cluster-adapter + pg(可选)
// 对战：古风擂台，4 种武器各自配普攻/Q/E 技能 + 回血，先打倒对方者胜

const cluster = require('cluster');
const os = require('os');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { createAdapter, setupPrimary } = require('@socket.io/cluster-adapter');
const path = require('path');

const PORT = process.env.PORT || 3000;
const WORKERS = parseInt(process.env.WORKERS || Math.min(os.cpus().length, 8), 10);

/* ============ 武器与技能定义 ============ */
const MAX_HP = 100;
const HEAL = { name: '回春术', amount: 25, cd: 10000 };
const WEAPONS = {
  qingfeng: { name: '青锋剑', desc: '均衡', atk: 12, atkCd: 800,  q: { name: '剑气斩', dmg: 22, cd: 4000 }, e: { name: '剑舞', dmg: 30, cd: 6000 } },
  chixiao:  { name: '赤霄剑', desc: '高伤', atk: 18, atkCd: 1200, q: { name: '烈焰斩', dmg: 35, cd: 5000 }, e: { name: '焚天', dmg: 50, cd: 8000 } },
  xuanbing: { name: '玄冰剑', desc: '速攻', atk: 8,  atkCd: 500,  q: { name: '寒霜斩', dmg: 15, cd: 3500 }, e: { name: '冰封', dmg: 25, cd: 6000 } },
  pojun:    { name: '破军剑', desc: '重击', atk: 24, atkCd: 1800, q: { name: '破军斩', dmg: 45, cd: 6000 }, e: { name: '裂地', dmg: 60, cd: 9000 } },
};
const WEAPON_LIST = Object.entries(WEAPONS).map(([id, w]) => ({
  id, name: w.name, desc: w.desc, atk: w.atk, atkCd: w.atkCd, q: w.q.name, qDmg: w.q.dmg, e: w.e.name, eDmg: w.e.dmg,
}));

/* ============================================================
 * 主进程：权威状态 + IPC 业务处理
 * ============================================================ */
if (cluster.isPrimary) {
  setupPrimary();

  // 数据存储：有 DATABASE_URL 用 PostgreSQL（持久化），否则内存态兜底
  const usePG = !!process.env.DATABASE_URL;
  let pgPool = null;
  let users = {};
  let queue = [];        // { wid, sid, name }
  const battles = {};    // room -> 对战状态
  let roomSeq = 0;

  if (usePG) {
    const { Pool } = require('pg');
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    pgPool.query('CREATE TABLE IF NOT EXISTS users (name TEXT PRIMARY KEY, wins INT NOT NULL DEFAULT 0, losses INT NOT NULL DEFAULT 0)').catch(() => {});
  }

  async function registerUser(name) {
    if (usePG) { try { await pgPool.query('INSERT INTO users (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]); } catch (e) {} }
    else if (!users[name]) users[name] = { wins: 0, losses: 0 };
  }
  async function recordResult(winName, loseName) {
    if (usePG) {
      try { await pgPool.query('UPDATE users SET wins = wins + 1 WHERE name = $1', [winName]); await pgPool.query('UPDATE users SET losses = losses + 1 WHERE name = $1', [loseName]); } catch (e) {}
    } else {
      if (users[winName]) users[winName].wins++;
      if (users[loseName]) users[loseName].losses++;
    }
  }
  async function getBoard() {
    if (usePG) {
      try { const r = await pgPool.query('SELECT name, wins, losses FROM users ORDER BY wins DESC, losses ASC LIMIT 20'); return r.rows.map((u, i) => ({ rank: i + 1, nickname: u.name, wins: u.wins, losses: u.losses })); } catch (e) { return []; }
    }
    return Object.entries(users).map(([nickname, r]) => ({ nickname, wins: r.wins, losses: r.losses })).sort((x, y) => (y.wins - x.wins) || (x.losses - y.losses)).slice(0, 20).map((u, i) => ({ rank: i + 1, ...u }));
  }

  function broadcast(msg) { for (const id in cluster.workers) cluster.workers[id].send(msg); }
  function sendTo(wid, msg) { if (cluster.workers[wid]) cluster.workers[wid].send(msg); }
  function findBattle(sid) {
    for (const room in battles) if (battles[room].aSid === sid || battles[room].bSid === sid) return { battle: battles[room], room };
    return null;
  }

  cluster.on('message', (worker, msg) => {
    switch (msg.type) {
      /* 匹配入队 */
      case 'enqueue': {
        registerUser(msg.name);
        queue.push({ wid: worker.id, sid: msg.sid, name: msg.name });
        if (queue.length >= 2) {
          const a = queue.shift(), b = queue.shift();
          const room = 'r' + (++roomSeq);
          battles[room] = {
            aWid: a.wid, aSid: a.sid, bWid: b.wid, bSid: b.sid, nameA: a.name, nameB: b.name,
            hpA: MAX_HP, hpB: MAX_HP, weaponA: null, weaponB: null,
            atkA: 0, atkB: 0, qA: 0, qB: 0, eA: 0, eB: 0, rA: 0, rB: 0,
          };
          sendTo(a.wid, { type: 'matched', sid: a.sid, room, opponent: b.name, you: 'a', weapons: WEAPON_LIST });
          sendTo(b.wid, { type: 'matched', sid: b.sid, room, opponent: a.name, you: 'b', weapons: WEAPON_LIST });
        } else {
          worker.send({ type: 'status', sid: msg.sid, text: '匹配中…' });
        }
        break;
      }

      /* 取消匹配 */
      case 'dequeue': {
        queue = queue.filter((q) => q.sid !== msg.sid);
        worker.send({ type: 'status', sid: msg.sid, text: '已取消匹配' });
        break;
      }

      /* 选择武器 */
      case 'select-weapon': {
        const r = findBattle(msg.sid);
        if (!r) break;
        const b = r.battle;
        if (msg.sid === b.aSid) b.weaponA = msg.weapon; else b.weaponB = msg.weapon;
        if (b.weaponA && b.weaponB) {
          sendTo(b.aWid, { type: 'battle-ready', sid: b.aSid, myWeapon: b.weaponA, foeWeapon: b.weaponB });
          sendTo(b.bWid, { type: 'battle-ready', sid: b.bSid, myWeapon: b.weaponB, foeWeapon: b.weaponA });
        }
        break;
      }

      /* 对战动作：atk / q / e / r */
      case 'action': {
        const r = findBattle(msg.sid);
        if (!r) break;
        const b = r.battle, room = r.room;
        const me = msg.sid === b.aSid ? 'a' : 'b';
        const foe = me === 'a' ? 'b' : 'a';
        const myHp = me === 'a' ? b.hpA : b.hpB;
        const foeHp = foe === 'a' ? b.hpA : b.hpB;
        if (myHp <= 0 || foeHp <= 0) break;
        const myWep = me === 'a' ? b.weaponA : b.weaponB;
        if (!myWep) break; // 还没选武器
        const w = WEAPONS[myWep];
        const now = Date.now();
        let dmg = 0, heal = 0, text = '';

        if (msg.action === 'atk') {
          const cd = me === 'a' ? b.atkA : b.atkB;
          if (now < cd) break;
          dmg = w.atk; text = '普攻';
          if (me === 'a') b.atkA = now + w.atkCd; else b.atkB = now + w.atkCd;
        } else if (msg.action === 'q') {
          const cd = me === 'a' ? b.qA : b.qB;
          if (now < cd) break;
          dmg = w.q.dmg; text = w.q.name;
          if (me === 'a') b.qA = now + w.q.cd; else b.qB = now + w.q.cd;
        } else if (msg.action === 'e') {
          const cd = me === 'a' ? b.eA : b.eB;
          if (now < cd) break;
          dmg = w.e.dmg; text = w.e.name;
          if (me === 'a') b.eA = now + w.e.cd; else b.eB = now + w.e.cd;
        } else if (msg.action === 'r') {
          const cd = me === 'a' ? b.rA : b.rB;
          if (now < cd) break;
          heal = HEAL.amount; text = HEAL.name;
          if (me === 'a') b.rA = now + HEAL.cd; else b.rB = now + HEAL.cd;
        } else break;

        if (dmg > 0) { if (foe === 'a') b.hpA = Math.max(0, b.hpA - dmg); else b.hpB = Math.max(0, b.hpB - dmg); }
        if (heal > 0) { if (me === 'a') b.hpA = Math.min(MAX_HP, b.hpA + heal); else b.hpB = Math.min(MAX_HP, b.hpB + heal); }

        const hpMsg = { a: b.hpA, b: b.hpB, attacker: me, action: msg.action, dmg, heal, text, atkCd: w.atkCd, qCd: w.q.cd, eCd: w.e.cd, rCd: HEAL.cd };
        sendTo(b.aWid, { type: 'hp', sid: b.aSid, ...hpMsg });
        sendTo(b.bWid, { type: 'hp', sid: b.bSid, ...hpMsg });

        if (b.hpA <= 0 || b.hpB <= 0) {
          const winName = b.hpB <= 0 ? b.nameA : b.nameB;
          const loseName = b.hpB <= 0 ? b.nameB : b.nameA;
          sendTo(b.aWid, { type: 'battle-over', sid: b.aSid, winner: winName, loser: loseName });
          sendTo(b.bWid, { type: 'battle-over', sid: b.bSid, winner: winName, loser: loseName });
          delete battles[room];
          (async () => { await recordResult(winName, loseName); broadcast({ type: 'board', board: await getBoard() }); })();
        }
        break;
      }
    }
  });

  for (let i = 0; i < WORKERS; i++) cluster.fork();
  cluster.on('exit', (worker) => { console.log('worker 退出，重启…'); cluster.fork(); });
  console.log('主进程启动，fork ' + WORKERS + ' 个 worker，端口 ' + PORT);
}

/* ============================================================
 * worker：HTTP + Socket.IO 接入，事件中继到主进程
 * ============================================================ */
else {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { adapter: createAdapter() });

  const online = new Map();
  let boardCache = [];

  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/game', (req, res) => res.sendFile(path.join(__dirname, 'public', 'game.html')));
  app.get('/health', (req, res) => {
    const mu = process.memoryUsage();
    res.json({ worker: cluster.worker.id, online: online.size, rssMB: Math.round(mu.rss / 1048576), heapMB: Math.round(mu.heapUsed / 1048576) });
  });

  io.on('connection', (socket) => {
    socket.data.room = null;

    socket.on('join', (nickname) => {
      const name = String(nickname || '').trim().slice(0, 12) || ('游客' + Math.floor(1000 + Math.random() * 9000));
      online.set(socket.id, name);
      socket.emit('joined', name);
      socket.emit('leaderboard', boardCache);
    });

    socket.on('chat', (text) => {
      const name = online.get(socket.id);
      const t = String(text || '').trim().slice(0, 200);
      if (name && t) io.emit('chat', { nickname: name, text: t });
    });

    socket.on('match', () => { if (online.has(socket.id)) process.send({ type: 'enqueue', sid: socket.id, name: online.get(socket.id) }); });
    socket.on('cancel-match', () => process.send({ type: 'dequeue', sid: socket.id }));
    socket.on('select-weapon', (w) => process.send({ type: 'select-weapon', sid: socket.id, weapon: w }));
    socket.on('action', (a) => process.send({ type: 'action', sid: socket.id, action: a }));
    socket.on('disconnect', () => { online.delete(socket.id); process.send({ type: 'dequeue', sid: socket.id }); });
  });

  process.on('message', (msg) => {
    switch (msg.type) {
      case 'status':
        io.sockets.sockets.get(msg.sid)?.emit('status', msg.text);
        break;
      case 'matched': {
        const s = io.sockets.sockets.get(msg.sid);
        if (!s) break;
        s.join(msg.room);
        s.data.room = msg.room;
        s.emit('battle-start', { opponent: msg.opponent, you: msg.you, weapons: msg.weapons });
        break;
      }
      case 'battle-ready': {
        const s = io.sockets.sockets.get(msg.sid);
        if (s) s.emit('battle-ready', { myWeapon: msg.myWeapon, foeWeapon: msg.foeWeapon });
        break;
      }
      case 'hp': {
        const s = io.sockets.sockets.get(msg.sid);
        if (s) s.emit('hp', { a: msg.a, b: msg.b, attacker: msg.attacker, action: msg.action, dmg: msg.dmg, heal: msg.heal, text: msg.text });
        break;
      }
      case 'battle-over': {
        const s = io.sockets.sockets.get(msg.sid);
        if (s) { s.emit('battle-over', { winner: msg.winner, loser: msg.loser }); s.data.room = null; }
        break;
      }
      case 'board':
        boardCache = msg.board;
        for (const s of io.sockets.sockets.values()) s.emit('leaderboard', msg.board);
        break;
    }
  });

  server.listen(PORT);
}
