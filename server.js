// 越王勾践剑 · 游戏平台后端（cluster 多进程 + 主进程权威状态 + 飞花令对战）
// 飞花令：2-5 人，随机关键字，轮流接龙含该字的诗词，60 秒答不出即淘汰，剩一人者胜

const cluster = require('cluster');
const os = require('os');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { createAdapter, setupPrimary } = require('@socket.io/cluster-adapter');
const path = require('path');

const PORT = process.env.PORT || 3000;
const WORKERS = parseInt(process.env.WORKERS || Math.min(os.cpus().length, 8), 10);

/* ============ 飞花令配置 ============ */
const FEIHUA_KEYWORDS = ['花', '月', '风', '山', '水', '春', '秋', '雪', '酒', '剑', '云', '雨', '夜', '心', '天', '江', '人', '日'];
const TURN_TIME = 60000;   // 每回合 60 秒
const MAX_PLAYERS = 5;     // 最多 5 人
const GATHER_MS = 8000;    // 匹配聚集等待 8 秒

/* 聊天敏感词过滤：命中即拦截，仅提示发送者 */
const SENSITIVE_WORDS = ['傻逼', '煞笔', '傻叉', '妈的', '你妈', '草泥马', '操你', '草你', '去死', '滚蛋', '王八蛋', '混蛋', '贱人', '他妈', 'fuck', 'shit', 'bitch', 'asshole', 'sb', 'cnm', 'nmsl', 'tmd'];
const hasSensitive = (t) => SENSITIVE_WORDS.some(w => t.toLowerCase().indexOf(w.toLowerCase()) !== -1);

/* 飞花令诗词库：关键字 → 常见古诗词名句（含该字）。离线校验，稳定可靠。 */
const POETRY_DB = {
  '花': ['忽如一夜春风来，千树万树梨花开', '人闲桂花落，夜静春山空', '感时花溅泪，恨别鸟惊心', '花间一壶酒，独酌无相亲', '乱花渐欲迷人眼，浅草才能没马蹄', '夜来风雨声，花落知多少', '待到重阳日，还来就菊花', '接天莲叶无穷碧，映日荷花别样红'],
  '月': ['床前明月光，疑是地上霜', '举头望明月，低头思故乡', '海上生明月，天涯共此时', '月落乌啼霜满天，江枫渔火对愁眠', '春花秋月何时了，往事知多少', '明月几时有，把酒问青天', '人有悲欢离合，月有阴晴圆缺', '春风又绿江南岸，明月何时照我还'],
  '风': ['长风破浪会有时，直挂云帆济沧海', '野火烧不尽，春风吹又生', '随风潜入夜，润物细无声', '大风起兮云飞扬', '昨夜西风凋碧树，独上高楼，望尽天涯路', '北风卷地白草折，胡天八月即飞雪'],
  '山': ['会当凌绝顶，一览众山小', '国破山河在，城春草木深', '千山鸟飞绝，万径人踪灭', '白日依山尽，黄河入海流', '两岸青山相对出，孤帆一片日边来', '山重水复疑无路，柳暗花明又一村', '空山新雨后，天气晚来秋'],
  '水': ['抽刀断水水更流，举杯消愁愁更愁', '桃花潭水深千尺，不及汪伦送我情', '问君能有几多愁，恰似一江春水向东流', '山重水复疑无路，柳暗花明又一村', '行到水穷处，坐看云起时', '水光潋滟晴方好，山色空蒙雨亦奇'],
  '春': ['春眠不觉晓，处处闻啼鸟', '好雨知时节，当春乃发生', '不知细叶谁裁出，二月春风似剪刀', '等闲识得东风面，万紫千红总是春', '国破山河在，城春草木深', '野火烧不尽，春风吹又生', '春色满园关不住，一枝红杏出墙来'],
  '秋': ['自古逢秋悲寂寥，我言秋日胜春朝', '空山新雨后，天气晚来秋', '落霞与孤鹜齐飞，秋水共长天一色', '万里悲秋常作客，百年多病独登台', '湖光秋月两相和，潭面无风镜未磨', '银烛秋光冷画屏，轻罗小扇扑流萤'],
  '雪': ['孤舟蓑笠翁，独钓寒江雪', '北风卷地白草折，胡天八月即飞雪', '窗含西岭千秋雪，门泊东吴万里船', '梅须逊雪三分白，雪却输梅一段香', '千里冰封，万里雪飘'],
  '酒': ['花间一壶酒，独酌无相亲', '明月几时有，把酒问青天', '葡萄美酒夜光杯，欲饮琵琶马上催', '劝君更尽一杯酒，西出阳关无故人', '对酒当歌，人生几何'],
  '剑': ['剑外忽传收蓟北，初闻涕泪满衣裳', '醉里挑灯看剑，梦回吹角连营', '宝剑锋从磨砺出，梅花香自苦寒来', '十年磨一剑，霜刃未曾试'],
  '云': ['黄河远上白云间，一片孤城万仞山', '黑云压城城欲摧，甲光向日金鳞开', '行到水穷处，坐看云起时', '浮云游子意，落日故人情', '朝辞白帝彩云间，千里江陵一日还'],
  '雨': ['好雨知时节，当春乃发生', '清明时节雨纷纷，路上行人欲断魂', '空山新雨后，天气晚来秋', '天街小雨润如酥，草色遥看近却无', '水光潋滟晴方好，山色空蒙雨亦奇'],
  '夜': ['姑苏城外寒山寺，夜半钟声到客船', '随风潜入夜，润物细无声', '二十四桥明月夜，玉人何处教吹箫', '夜来风雨声，花落知多少', '人闲桂花落，夜静春山空'],
  '心': ['谁言寸草心，报得三春晖', '感时花溅泪，恨别鸟惊心', '洛阳亲友如相问，一片冰心在玉壶', '人生自古谁无死，留取丹心照汗青'],
  '天': ['明月几时有，把酒问青天', '天苍苍，野茫茫，风吹草低见牛羊', '君不见黄河之水天上来，奔流到海不复回', '天生我材必有用，千金散尽还复来', '海上生明月，天涯共此时'],
  '江': ['孤舟蓑笠翁，独钓寒江雪', '月落乌啼霜满天，江枫渔火对愁眠', '一道残阳铺水中，半江瑟瑟半江红', '大江东去，浪淘尽，千古风流人物', '问君能有几多愁，恰似一江春水向东流', '春风又绿江南岸，明月何时照我还'],
  '人': ['前不见古人，后不见来者', '人生自古谁无死，留取丹心照汗青', '人有悲欢离合，月有阴晴圆缺', '千山鸟飞绝，万径人踪灭', '空山不见人，但闻人语响', '生当作人杰，死亦为鬼雄'],
  '日': ['白日依山尽，黄河入海流', '接天莲叶无穷碧，映日荷花别样红', '锄禾日当午，汗滴禾下土', '朝辞白帝彩云间，千里江陵一日还', '黑云压城城欲摧，甲光向日金鳞开', '两岸青山相对出，孤帆一片日边来']
};
function normalizePoem(s) { return (s || '').replace(/[\s，。！？、,.!?;；：:""''（）()·]/g, ''); }
function isRealPoem(answer, keyword) {
  const a = normalizePoem(answer);
  if (a.length < 4) return false;   // 太短，不算诗句
  const list = POETRY_DB[keyword] || [];
  return list.some(line => { const l = normalizePoem(line); return l === a || l.includes(a); });
}

/* ============================================================
 * 主进程：权威状态 + IPC 业务处理
 * ============================================================ */
if (cluster.isPrimary) {
  setupPrimary();

  const usePG = !!process.env.DATABASE_URL;
  let pgPool = null;
  let users = {};
  let queue = [];              // { wid, sid, name }
  let gathering = null;        // { players:[{wid,sid,name}], timer }
  const feihuaRooms = {};      // room -> { players:[{wid,sid,name,alive}], keyword, turn, timer, used }
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
  function findFeihuaRoom(sid) {
    for (const room in feihuaRooms) if (feihuaRooms[room].players.some(p => p.sid === sid)) return room;
    return null;
  }
  function roomEmit(room, msg) {
    for (const p of feihuaRooms[room].players) sendTo(p.wid, { sid: p.sid, ...msg });
  }

  /* ---------- 飞花令流程 ---------- */
  function startFeihua(players) {
    const room = 'r' + (++roomSeq);
    const keyword = FEIHUA_KEYWORDS[Math.floor(Math.random() * FEIHUA_KEYWORDS.length)];
    const ps = players.map((x, idx) => ({ wid: x.wid, sid: x.sid, name: x.name, alive: true, idx }));
    feihuaRooms[room] = { players: ps, keyword, turn: -1, timer: null, used: [] };
    for (const p of ps) {
      sendTo(p.wid, { type: 'feihua-start', sid: p.sid, room, keyword, players: ps.map(x => x.name) });
    }
    nextTurn(room);
  }

  function nextTurn(room) {
    const r = feihuaRooms[room];
    if (!r) return;
    const alive = r.players.filter(p => p.alive);
    if (alive.length <= 1) { finishFeihua(room, alive[0]); return; }
    // 找到下一个存活玩家
    let t = r.turn;
    for (let i = 0; i < r.players.length; i++) {
      t = (t + 1) % r.players.length;
      if (r.players[t].alive) { r.turn = t; break; }
    }
    roomEmit(room, { type: 'feihua-turn', room, keyword: r.keyword, current: r.players[r.turn].name, currentIdx: r.turn });
    clearTimeout(r.timer);
    r.timer = setTimeout(() => {
      const cur = r.players[r.turn];
      if (!cur.alive) return;
      cur.alive = false;
      roomEmit(room, { type: 'feihua-out', room, name: cur.name, reason: '超时' });
      nextTurn(room);
    }, TURN_TIME);
  }

  function finishFeihua(room, winner) {
    const r = feihuaRooms[room];
    if (!r) return;
    for (const p of r.players) {
      sendTo(p.wid, { type: 'feihua-over', sid: p.sid, winner: winner ? winner.name : '无' });
    }
    clearTimeout(r.timer);
    delete feihuaRooms[room];
    // 记录战绩：胜者 wins+1，其余 losses+1
    (async () => {
      if (winner) {
        const winName = winner.name;
        for (const p of r.players) {
          if (p.name === winName) {
            if (usePG) { try { await pgPool.query('UPDATE users SET wins = wins + 1 WHERE name = $1', [winName]); } catch (e) {} }
            else if (users[winName]) users[winName].wins++;
          } else {
            if (usePG) { try { await pgPool.query('UPDATE users SET losses = losses + 1 WHERE name = $1', [p.name]); } catch (e) {} }
            else if (users[p.name]) users[p.name].losses++;
          }
        }
      }
      broadcast({ type: 'board', board: await getBoard() });
    })();
  }

  /* ---------- 匹配聚集 ---------- */
  function tryMatch() {
    if (gathering) {
      // 有正在聚集的房间，往里加人（最多5）
      while (queue.length && gathering.players.length < MAX_PLAYERS) {
        const p = queue.shift();
        gathering.players.push(p);
        sendTo(p.wid, { type: 'status', sid: p.sid, text: '已加入房间（' + gathering.players.length + '/' + MAX_PLAYERS + '人），等待开始…' });
      }
      return;
    }
    if (queue.length < 2) return;
    gathering = { players: [queue.shift(), queue.shift()], timer: null };
    for (const p of gathering.players) {
      sendTo(p.wid, { type: 'status', sid: p.sid, text: '已匹配到对手，等待更多玩家加入…' });
    }
    gathering.timer = setTimeout(() => {
      const g = gathering;
      gathering = null;
      if (g.players.length >= 2) {
        startFeihua(g.players);
      } else {
        queue = queue.concat(g.players);
      }
    }, GATHER_MS);
  }

  cluster.on('message', (worker, msg) => {
    switch (msg.type) {
      case 'enqueue': {
        registerUser(msg.name);
        queue.push({ wid: worker.id, sid: msg.sid, name: msg.name });
        tryMatch();
        break;
      }
      case 'dequeue': {
        queue = queue.filter(q => q.sid !== msg.sid);
        if (gathering) gathering.players = gathering.players.filter(p => p.sid !== msg.sid);
        worker.send({ type: 'status', sid: msg.sid, text: '已取消匹配' });
        break;
      }
      case 'feihua-answer': {
        const room = findFeihuaRoom(msg.sid);
        if (!room) break;
        const r = feihuaRooms[room];
        const cur = r.players[r.turn];
        if (!cur || cur.sid !== msg.sid) break;
        const answer = String(msg.answer || '').trim();
        if (!answer) break;
        if (answer.indexOf(r.keyword) === -1) {
          cur.alive = false;
          roomEmit(room, { type: 'feihua-out', room, name: cur.name, reason: '回答不含「' + r.keyword + '」' });
          nextTurn(room);
          break;
        }
        if (r.used.indexOf(answer) !== -1) {
          cur.alive = false;
          roomEmit(room, { type: 'feihua-out', room, name: cur.name, reason: '重复了' });
          nextTurn(room);
          break;
        }
        if (!isRealPoem(answer, r.keyword)) {
          cur.alive = false;
          roomEmit(room, { type: 'feihua-out', room, name: cur.name, reason: '不是题库中的真实诗词名句' });
          nextTurn(room);
          break;
        }
        r.used.push(answer);
        roomEmit(room, { type: 'feihua-said', room, name: cur.name, answer });
        nextTurn(room);
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

  // 入口 index.html 不缓存，保证用户永远拿到最新版（其中带资源版本号）
  app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    }
  }));
  // 大体积子页面：URL 带版本号（?v=xxx），版本不变时可长期缓存
  app.get('/game', (req, res) => { res.setHeader('Cache-Control', 'public, max-age=86400'); res.sendFile(path.join(__dirname, 'public', 'game.html')); });
  app.get('/relics', (req, res) => { res.setHeader('Cache-Control', 'public, max-age=86400'); res.sendFile(path.join(__dirname, 'public', 'relics.html')); });
  app.get('/health', (req, res) => {
    const mu = process.memoryUsage();
    res.json({ worker: cluster.worker.id, online: online.size, rssMB: Math.round(mu.rss / 1048576), heapMB: Math.round(mu.heapUsed / 1048576) });
  });

  io.on('connection', (socket) => {
    socket.on('join', (nickname) => {
      const name = String(nickname || '').trim().slice(0, 12) || ('游客' + Math.floor(1000 + Math.random() * 9000));
      online.set(socket.id, name);
      socket.emit('joined', name);
      socket.emit('leaderboard', boardCache);
    });
    socket.on('chat', (text) => {
      const name = online.get(socket.id);
      const t = String(text || '').trim().slice(0, 200);
      if (name && t) {
        if (hasSensitive(t)) {
          socket.emit('chat', { system: true, text: '消息含敏感词，已被系统拦截' });
        } else {
          io.emit('chat', { nickname: name, text: t });
        }
      }
    });
    socket.on('match', () => { if (online.has(socket.id)) process.send({ type: 'enqueue', sid: socket.id, name: online.get(socket.id) }); });
    socket.on('cancel-match', () => process.send({ type: 'dequeue', sid: socket.id }));
    socket.on('feihua-answer', (a) => process.send({ type: 'feihua-answer', sid: socket.id, answer: a }));
    socket.on('disconnect', () => { online.delete(socket.id); process.send({ type: 'dequeue', sid: socket.id }); });
  });

  process.on('message', (msg) => {
    switch (msg.type) {
      case 'status':
        io.sockets.sockets.get(msg.sid)?.emit('status', msg.text);
        break;
      case 'feihua-start':
        io.sockets.sockets.get(msg.sid)?.emit('feihua-start', { keyword: msg.keyword, players: msg.players });
        break;
      case 'feihua-turn':
        io.sockets.sockets.get(msg.sid)?.emit('feihua-turn', { keyword: msg.keyword, current: msg.current, currentIdx: msg.currentIdx });
        break;
      case 'feihua-said':
        io.sockets.sockets.get(msg.sid)?.emit('feihua-said', { name: msg.name, answer: msg.answer });
        break;
      case 'feihua-out':
        io.sockets.sockets.get(msg.sid)?.emit('feihua-out', { name: msg.name, reason: msg.reason });
        break;
      case 'feihua-over':
        io.sockets.sockets.get(msg.sid)?.emit('feihua-over', { winner: msg.winner });
        break;
      case 'board':
        boardCache = msg.board;
        for (const s of io.sockets.sockets.values()) s.emit('leaderboard', msg.board);
        break;
    }
  });

  server.listen(PORT);
}
