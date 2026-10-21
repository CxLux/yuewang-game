const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
const players = [io(URL,{transports:['websocket']}), io(URL,{transports:['websocket']}), io(URL,{transports:['websocket']})];
let done = false, started = false;
function finish(ok, msg) { if (done) return; done = true; console.log((ok?'✅':'❌')+' '+msg); process.exit(ok?0:1); }

players.forEach((p, i) => {
  const myName = '玩家' + (i+1);
  p.on('feihua-start', (d) => { if (!started) { started = true; console.log('🎴 开局：关键字「'+d.keyword+'」，'+d.players.length+' 人'); } });
  p.on('feihua-turn', (d) => {
    // 轮到我就交一个不含关键字的错误答案，触发淘汰
    if (d.current === myName) {
      console.log(d.current + ' 的回合，提交错误答案');
      p.emit('feihua-answer', '错误答案');
    }
  });
  p.on('feihua-out', (d) => console.log('  ❌ ' + d.name + ' 出局（' + d.reason + '）'));
  p.on('feihua-over', (d) => { console.log('🏆 胜者：' + d.winner); finish(true, '飞花令流程完整跑通'); });
});

setTimeout(() => players[0].emit('join', '玩家1'), 50);
setTimeout(() => players[1].emit('join', '玩家2'), 100);
setTimeout(() => players[2].emit('join', '玩家3'), 150);
setTimeout(() => { players[0].emit('match'); players[1].emit('match'); players[2].emit('match'); }, 300);
setTimeout(() => finish(false, '30 秒超时'), 30000);
