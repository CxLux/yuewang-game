const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
const a = io(URL, { transports: ['websocket'] }), b = io(URL, { transports: ['websocket'] });
let done = false;
function finish(ok, msg) { if (done) return; done = true; console.log((ok ? '✅ ' : '❌ ') + msg); process.exit(ok ? 0 : 1); }

a.on('joined', () => { a.emit('chat', '大家好，我是A'); });
b.on('joined', () => { b.emit('chat', '大家好，我是B'); a.emit('match'); b.emit('match'); });

let started = 0;
function onStart() { if (++started === 2) { console.log('已匹配，开始对战'); a.emit('attack'); } }
a.on('battle-start', onStart); b.on('battle-start', onStart);

let attacks = 0;
setInterval(() => { if (!done) { a.emit('attack'); b.emit('attack'); if (++attacks > 30) finish(false, '30 轮未分胜负'); } }, 800);

a.on('battle-over', (d) => { console.log('对战结束：胜者 ' + d.winner + '，败者 ' + d.loser); finish(true, '对战流程完整跑通'); });
b.on('battle-over', (d) => {});

a.on('leaderboard', (list) => { if (list.length) console.log('排行榜已更新，当前 ' + list.length + ' 人在榜'); });

setTimeout(() => a.emit('join', '玩家A'), 50);
setTimeout(() => b.emit('join', '玩家B'), 100);
setTimeout(() => finish(false, '15 秒超时'), 15000);
