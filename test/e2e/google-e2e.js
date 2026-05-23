const { chromium } = require('playwright');
const path = require('path');
const https = require('https');

const API_KEY = 'AIzaSyATzbTtdAGKq_2eAj3CgFeemSULfIBSmmw';
const GOOGLE_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';

function callGoogle(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(GOOGLE_API);
    const req = https.request({
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { 'x-goog-api-key': API_KEY, 'Content-Type': 'application/json' },
      timeout: 120000
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log('=== Google AI Studio — Gemini 2.5 Flash E2E ===\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
  await page.goto(`file://${path.resolve(__dirname, '../fixtures/chat-page.html')}`);
  await page.waitForSelector('.chat-messages');
  await page.evaluate(() => document.querySelector('.chat-messages').scrollTop = 0);
  await page.waitForTimeout(500);
  const screenshot = await page.screenshot({ type: 'jpeg', quality: 85 });
  const b64 = screenshot.toString('base64');
  console.log('Screenshot:', (screenshot.length/1024).toFixed(1), 'KB');
  await browser.close();

  const systemPrompt = 'You are a reply assistant. The user\'s messages are on the right (green bubbles), the other person is on the left. Suggest 3 replies. Return ONLY JSON: {"suggestions":[{"text":"reply","approach":"natural|alternate|creative","rationale":"why"}]}';
  const userPrompt = 'Pointer: accept lunch invite, confirm project on track.\nSuggest 3 replies.';

  console.log('Sending to Gemini 2.5 Flash...');
  const start = Date.now();
  const resp = await callGoogle({
    contents: [{
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: b64 } },
        { text: `${systemPrompt}\n\n${userPrompt}` }
      ]
    }]
  });

  const elapsed = ((Date.now() - start)/1000).toFixed(1);
  const text = resp.candidates[0].content.parts[0].text;
  console.log(`Time: ${elapsed}s | Tokens: ${JSON.stringify(resp.usageMetadata)}`);

  let json = text;
  const m = text.match(/\{[\s\S]*\}/);
  if (m) json = m[0];

  try {
    const parsed = JSON.parse(json);
    console.log('\n✅ Valid JSON');
    (parsed.suggestions||[]).forEach((s,i) => console.log(`  ${i+1}. [${s.approach}] "${(s.text||'').slice(0,100)}"`));
    console.log('\n✅ E2E PASSED');
  } catch(e) {
    console.log('❌ Parse failed:', e.message);
    console.log('Raw:', text.slice(0,400));
    process.exit(1);
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
