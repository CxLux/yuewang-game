const ask = async () => {
  try {
    const t0 = Date.now();
    const r = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai', messages: [
        { role: 'system', content: '你是古诗词校验器，只回答一个字：是 或 否' },
        { role: 'user', content: '「我昨天去了人市场买菜」是真实古诗词名句吗？只回答「是」或「否」' }
      ]})
    });
    const t = await r.text();
    console.log('HTTP', r.status, '耗时', Date.now()-t0, 'ms');
    console.log('RESP:', t.slice(0, 400));
  } catch (e) { console.log('ERR:', e.message); }
};
ask();
