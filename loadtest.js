// 并发压测：模拟 N 个游客同时「连接 → 登录(join) → 进大厅」
// 用法：node loadtest.js <N>
// 测：连接成功率、登录延迟(P50/P95/P99)、错误率
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000';
const N = parseInt(process.argv[2] || '1000', 10);

const tStart = Date.now();
let connected = 0, joined = 0, errors = 0;
const joinLat = [];

let reported = false;
function report(label) {
  if (reported) return; reported = true;
  const total = (Date.now() - tStart) / 1000;
  joinLat.sort((a, b) => a - b);
  const p = (pct) => joinLat.length ? joinLat[Math.min(joinLat.length - 1, Math.floor(joinLat.length * pct / 100))] : 0;
  console.log('\n================ 压测结果 N=' + N + ' ================');
  console.log('标签: ' + label);
  console.log('总耗时: ' + total.toFixed(1) + 's');
  console.log('连接成功: ' + connected + ' / ' + N + ' (' + (connected / N * 100).toFixed(2) + '%)');
  console.log('登录成功(join): ' + joined + ' / ' + N);
  console.log('错误/失败: ' + errors);
  console.log('join 延迟 P50 / P95 / P99 : ' + p(50) + ' / ' + p(95) + ' / ' + p(99) + ' ms');
  console.log('吞吐: ' + Math.round(joined / total) + ' 登录/秒');
  console.log('==========================================\n');
  process.exit(0);
}

for (let i = 0; i < N; i++) {
  const s = io(URL, { transports: ['websocket'], reconnection: false, timeout: 15000 });
  const t0 = Date.now();
  s.on('connect', () => {
    connected++;
    const tj = Date.now();
    s.emit('join', '压测' + i);
    s.once('joined', () => {
      joined++;
      joinLat.push(Date.now() - tj);
      if (joined === N) report('全部登录完成');
    });
  });
  s.on('connect_error', () => { errors++; connected++; });
  s.on('error', () => { errors++; });
}

// 兜底：60 秒后强制汇报
setTimeout(() => report('超时(60s)，未全部完成'), 60000);
