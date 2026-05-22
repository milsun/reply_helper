const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const CHAT_PATH = path.resolve(__dirname, '../fixtures/chat-page.html');
const LOCAL_ENDPOINT = 'http://localhost:8080/v1/chat/completions';
const MODEL = 'gemma-4-E4B-it-Q4_K_M.gguf';

async function callLocalLLM(messages, maxTokens = 512) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.7
    });

    const req = http.request(LOCAL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error(`Parse error: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log('=== Reply Helper Local Model E2E Test ===\n');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 900 } });

  // 1. Open test chat page
  console.log('1. Opening test chat page...');
  await page.goto(`file://${CHAT_PATH}`);
  await page.waitForSelector('.chat-messages');

  const msgCount = await page.locator('.message').count();
  console.log(`   Chat loaded: ${msgCount} messages visible`);

  // Scroll to show all messages
  await page.evaluate(() => {
    document.querySelector('.chat-messages').scrollTop = 0;
  });
  await page.waitForTimeout(500);

  // 2. Take screenshot
  console.log('2. Taking screenshot of chat...');
  const screenshot = await page.screenshot({ type: 'jpeg', quality: 85, fullPage: false });
  const screenshotB64 = screenshot.toString('base64');
  console.log(`   Screenshot size: ${(screenshot.length / 1024).toFixed(1)} KB`);

  // 3. Send to local model with vision
  console.log('3. Sending to local model (vision)...');
  const startTime = Date.now();

  const systemPrompt = `You are a reply suggestion assistant. You see a screenshot of a chat conversation. The user is the person with "sent" messages (usually right-aligned). Analyze the conversation and suggest 3 replies.

Return ONLY a valid JSON object:
{
  "context_summary": "brief summary of the conversation",
  "suggestions": [
    {"approach": "natural", "text": "reply ready to send", "rationale": "why this works"},
    {"approach": "different-angle", "text": "another reply", "rationale": "why this works"},
    {"approach": "creative", "text": "a third reply", "rationale": "why this works"}
  ]
}`;

  const userPrompt = 'User pointer: accept the lunch invitation and confirm the project is on track.\n\nGenerate 3 reply suggestions based on the chat screenshot.';

  const result = await callLocalLLM([
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${screenshotB64}` }
        },
        { type: 'text', text: userPrompt }
      ]
    }
  ]);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`   Response received in ${elapsed}s`);
  console.log(`   Tokens: ${result.usage.total_tokens} (prompt: ${result.usage.prompt_tokens}, completion: ${result.usage.completion_tokens})`);

  // 4. Parse and verify response
  console.log('\n4. Parsing response...');
  const content = result.choices[0].message.content;
  console.log(`   Raw response length: ${content.length} chars`);

  // Try to extract JSON (handle markdown wrapping)
  let jsonStr = content;
  const mdMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (mdMatch) jsonStr = mdMatch[1].trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // Try to find JSON object in the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        console.error('   FAILED to parse JSON from response');
        console.log(`   RAW: ${content.slice(0, 500)}`);
        await browser.close();
        process.exit(1);
      }
    } else {
      console.error('   FAILED: No JSON found in response');
      console.log(`   RAW: ${content.slice(0, 500)}`);
      await browser.close();
      process.exit(1);
    }
  }

  console.log(`   Context: ${parsed.context_summary || 'N/A'}`);
  console.log(`   Suggestions: ${(parsed.suggestions || []).length}`);

  let allPass = true;
  console.log('\n5. Verification results:');

  if (parsed.context_summary && parsed.context_summary.length > 10) {
    console.log('   ✓ Context summary generated');
  } else {
    console.log('   ✗ Context summary missing or too short');
    allPass = false;
  }

  if (parsed.suggestions && parsed.suggestions.length >= 1) {
    console.log(`   ✓ ${parsed.suggestions.length} suggestions generated`);
    parsed.suggestions.forEach((s, i) => {
      console.log(`     ${i + 1}. [${s.approach || '?'}] "${(s.text || '').slice(0, 80)}..."`);
    });
  } else {
    console.log('   ✗ No suggestions generated');
    allPass = false;
  }

  const lunchRelated = parsed.suggestions?.some(s =>
    (s.text || '').toLowerCase().includes('lunch') ||
    (s.text || '').toLowerCase().includes('saturday')
  );
  if (lunchRelated) {
    console.log('   ✓ Suggestions address conversation context (lunch/Saturday)');
  } else {
    console.log('   ✗ Suggestions may not address the conversation context');
    allPass = false;
  }

  await browser.close();

  if (allPass) {
    console.log('\n✅ E2E TEST PASSED - Local model successfully generated contextual reply suggestions');
    process.exit(0);
  } else {
    console.log('\n❌ E2E TEST FAILED');
    process.exit(1);
  }
})().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
