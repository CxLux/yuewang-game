const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
let sum = 0, n = 0, results = [];
function testOne(i) {
  const s = io(URL, { transports: ['websocket'] });
  s.on('connect', () => {
    const t0 = process.hrtime.bigint();
    s.emit('join', '延迟测试' + i);
    s.once('joined', () => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      results.push(ms); n++;
      s.close();
      if (n === 10) {
        results.sort((a,b)=>a-b);
        console.log('单次 join 往返延迟：', results.map(x=>x.toFixed(1)+'ms').join(', '));
        console.log('中位数：', results[5].toFixed(1) + 'ms');
        process.exit(0);
      }
    });
  });
}
for (let i = 0; i < 10; i++) setTimeout(() => testOne(i), i * 100);
