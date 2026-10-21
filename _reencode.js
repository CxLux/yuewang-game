const fs = require('fs');
const { execSync } = require('child_process');
const p = '/opt/wenshu/public/game.html';
let html = fs.readFileSync(p, 'utf8');
const vids = [...html.matchAll(/data:video\/mp4;base64,([A-Za-z0-9+/=]+)/g)];
console.log('共', vids.length, '段视频');
let converted = 0;
for (let i = 0; i < vids.length; i++) {
  const b64 = vids[i][1];
  const buf = Buffer.from(b64, 'base64');
  const head = buf.slice(0, 400000).toString('latin1');
  if (/hev1|hvc1/.test(head)) {
    console.log('视频' + (i+1) + ' 是 H265，转码中…（原 ' + (buf.length/1024/1024).toFixed(2) + 'MB）');
    fs.writeFileSync('/tmp/v_in.mp4', buf);
    execSync('ffmpeg -y -i /tmp/v_in.mp4 -c:v libx264 -preset fast -crf 23 -c:a aac -movflags +faststart /tmp/v_out.mp4', { stdio: 'ignore' });
    const nb = fs.readFileSync('/tmp/v_out.mp4');
    html = html.replace('data:video/mp4;base64,' + b64, 'data:video/mp4;base64,' + nb.toString('base64'));
    console.log('  ✅ 完成，新大小 ' + (nb.length/1024/1024).toFixed(2) + 'MB');
    converted++;
  } else {
    console.log('视频' + (i+1) + ' 是 H264，跳过');
  }
}
fs.writeFileSync(p, html);
console.log('✅ 共转码 ' + converted + ' 段，已保存');
