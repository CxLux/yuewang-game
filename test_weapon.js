const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
const a = io(URL, { transports: ['websocket'] }), b = io(URL, { transports: ['websocket'] });
let done = false;
function finish(ok, msg) { if (done) return; done = true; console.log((ok ? '✅ ' : '❌ ') + msg); process.exit(ok ? 0 : 1); }

b.on('joined', () => { a.emit('match'); b.emit('match'); });
a.on('battle-start', (d) => { a.emit('select-weapon', 'chixiao'); });
b.on('battle-start', (d) => { b.emit('select-weapon', 'xuanbing'); });

let ready = 0;
function onReady(d) { if (++ready === 2) { console.log('双方选好武器，开战'); a.emit('action', 'q'); b.emit('action', 'atk'); } }
a.on('battle-ready', onReady);
b.on('battle-ready', onReady);

a.on('hp', (d) => { if (d.action === 'q') console.log('  a 用 Q 技能，伤害', d.dmg); });
b.on('hp', (d) => { if (d.action === 'r') console.log('  b 用回血', d.heal); });

let round = 0;
setInterval(() => {
  if (done) return;
  round++;
  const actions = ['atk','q','e','r'];
  a.emit('action', actions[round % 4]);
  b.emit('action', actions[(round + 2) % 4]);
  if (round > 30) finish(false, '30 轮未分胜负');
}, 900);

a.on('battle-over', (d) => { console.log('对战结束：胜者', d.winner, '败者', d.loser); finish(true, '武器对战流程完整跑通'); });
b.on('battle-over', () => {});

setTimeout(() => a.emit('join', '玩家A'), 50);
setTimeout(() => b.emit('join', '玩家B'), 100);
setTimeout(() => finish(false, '20 秒超时'), 20000);
