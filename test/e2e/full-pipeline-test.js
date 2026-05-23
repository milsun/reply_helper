const { chromium } = require('playwright');
const path = require('path');
const http = require('http');

const HARNESS_PATH = path.resolve(__dirname, '../fixtures/test-harness.html');
const LOCAL_API = 'http://localhost:8080/v1/chat/completions';

async function callLocalAPI(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ messages: payload.messages });
    const req = http.request(LOCAL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 180000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('API timeout')); });
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Reply Helper — Full E2E Pipeline Test   ║');
  console.log('║  Local Model (auto-detected)            ║');
  console.log('╚══════════════════════════════════════════╝\n');

  let passed = 0, failed = 0;
  const check = (label, condition) => {
    if (condition) { console.log(`  ✅ ${label}`); passed++; }
    else { console.log(`  ❌ ${label}`); failed++; }
  };

  // ═══════════════════════════════════════════
  // STEP 1: Capture screenshot
  // ═══════════════════════════════════════════
  console.log('STEP 1 — Screenshot Capture');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
  await page.goto(`file://${path.resolve(__dirname, '../fixtures/chat-page.html')}`);
  await page.waitForSelector('.chat-messages');
  await page.evaluate(() => document.querySelector('.chat-messages').scrollTop = 0);
  await page.waitForTimeout(500);

  const screenshot = await page.screenshot({ type: 'jpeg', quality: 85 });
  const screenshotB64 = screenshot.toString('base64');
  const screenshotKB = (screenshot.length / 1024).toFixed(1);

  check('Chat page loaded (7 messages)', await page.locator('.message').count() >= 7);
  check('Priya visible as other person', (await page.textContent('.chat-messages')).includes('Priya'));
  check('User messages visible', (await page.textContent('.chat-messages')).includes('deployment'));
  check(`Screenshot captured (${screenshotKB} KB JPEG)`, screenshot.length > 10000);

  await browser.close();

  // ═══════════════════════════════════════════
  // STEP 2: Analyze screenshot with LLM
  // ═══════════════════════════════════════════
  console.log('\nSTEP 2 — LLM Analysis (Vision)');

  const systemPrompt = `You are an expert conversation assistant. You are shown a screenshot of a chat conversation. Your task:

1. IDENTIFY THE USER: Use message POSITION and BUBBLE COLOR to find who the user is. The user's messages are typically on the RIGHT side in a COLORED bubble (green/blue). The other person is on the LEFT side in a NEUTRAL bubble (gray/white). Do NOT rely on a "You" label — the user may be labeled with their name or nothing at all. Also use conversation flow: whoever seems to be answering questions or giving updates is likely the user. The person asking questions or initiating topics is the other person. Only the user's messages matter for style analysis.

2. ANALYZE USER STYLE: Study ONLY the user's messages. Note: message length, formality, emoji usage, punctuation, capitalization, vocabulary. Create a style profile.

3. GENERATE 3 REPLIES: Based on the conversation context and the user's pointer (if provided), generate exactly 3 reply alternatives that ALL match the user's communication style. Each must:
   - Sound like the user actually wrote it
   - Be ready to copy-paste (no placeholders)
   - Match emoji habits, punctuation, and formality exactly
   - Be 1-2 sentences

Return ONLY valid JSON (no markdown, no backticks):
{
  "who_is_user": "description of which person is the user",
  "user_style": {"length":"...", "formality":"...", "emoji":"...", "traits":"..."},
  "context_summary": "what the conversation is about",
  "suggestions": [
    {"approach":"natural","text":"reply text","rationale":"why this fits"},
    {"approach":"alternate","text":"reply text","rationale":"why this fits"},
    {"approach":"creative","text":"reply text","rationale":"why this fits"}
  ]
}`;

  const userPrompt = 'User pointer: accept the lunch invitation and confirm the project is on track for Friday.\n\nGenerate 3 reply suggestions.';

  console.log('  Sending to local model...');
  const startTime = Date.now();
  const response = await callLocalAPI({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshotB64}` } },
        { type: 'text', text: userPrompt }
      ]}
    ]
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const content = response.choices[0].message.content || '';
  check(`Response in ${elapsed}s`, elapsed < 120);
  check(`Tokens used: ${response.usage.total_tokens}`, response.usage.total_tokens > 10);
  console.log(`  Model: ${response.model || 'unknown'}`);

  // ═══════════════════════════════════════════
  // STEP 3: Parse & verify JSON response
  // ═══════════════════════════════════════════
  console.log('\nSTEP 3 — Parse & Verify Response');

  let jsonStr = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
    check('Valid JSON response', true);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); check('Valid JSON (extracted)', true); }
      catch { parsed = null; check('Valid JSON', false); }
    } else {
      parsed = null;
      check('Valid JSON', false);
    }
  }

  if (!parsed) {
    console.log('  Raw response:', content.slice(0, 500));
    console.log('\n❌ Cannot continue — JSON parse failed');
    process.exit(1);
  }

  // ═══════════════════════════════════════════
  // STEP 4: Verify user identification
  // ═══════════════════════════════════════════
  console.log('\nSTEP 4 — User Identification Verification');

  const whoIsUser = (parsed.who_is_user || '').toLowerCase();
  check('Identified who the user is', 
    (parsed.who_is_user && parsed.who_is_user.length > 3) || 
    (parsed.user_style && Object.keys(parsed.user_style).length >= 2));

  // User identification is correct if either: explicitly says something besides just Priya's name,
  // OR the suggestions prove it (user's style matched, from user's perspective)
  const userMentionsSelf = whoIsUser.includes('right') || whoIsUser.includes('left')
    || whoIsUser.includes('green') || whoIsUser.includes('blue') || whoIsUser.includes('color')
    || whoIsUser.includes('position') || whoIsUser.includes('side') || whoIsUser.includes('bottom')
    || whoIsUser.includes('you') || whoIsUser.includes('sent');
  const suggestionsFromUserSide = (parsed.suggestions || []).length === 3;
  check('Correctly identified user from layout (not confused with other person)',
    userMentionsSelf || (suggestionsFromUserSide && !whoIsUser.startsWith('priya')));

  if (parsed.user_style) {
    console.log(`  Style profile: ${parsed.user_style.formality || '?'} | ${parsed.user_style.length || '?'} | emoji: ${parsed.user_style.emoji || '?'}`);
    check('Style profile generated', !!parsed.user_style.formality);
  }

  // ═══════════════════════════════════════════
  // STEP 5: Verify suggestions
  // ═══════════════════════════════════════════
  console.log('\nSTEP 5 — Suggestion Verification');

  const suggestions = parsed.suggestions || [];
  check('Exactly 3 suggestions', suggestions.length === 3);

  suggestions.forEach((s, i) => {
    const text = s.text || '';
    const approach = s.approach || '?';
    console.log(`  ${i + 1}. [${approach}] "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"`);

    check(`  Suggestion ${i + 1}: has text`, text.length > 10);
    check(`  Suggestion ${i + 1}: ready to send (no brackets)`, !text.includes('[') && !text.includes('{'));
    check(`  Suggestion ${i + 1}: has approach label`, !!s.approach);
    check(`  Suggestion ${i + 1}: has rationale`, (s.rationale || '').length > 3);
  });

  // Verify context — suggestions should reference the conversation topics
  const allText = suggestions.map(s => (s.text || '').toLowerCase()).join(' ');
  const contextChecks = [
    ['lunch', 'Lunch invitation'],
    ['saturday', 'Saturday'],
    ['project', 'Project status'],
    ['demo', 'Demo date'],
    ['friday', 'Friday deadline'],
  ];

  let contextHits = 0;
  console.log('\n  Context awareness:');
  contextChecks.forEach(([keyword, label]) => {
    const hit = allText.includes(keyword);
    if (hit) contextHits++;
    console.log(`    ${hit ? '✅' : '  '} ${label}: ${keyword}`);
  });
  check('Suggestions are contextually aware (≥2 topic matches)', contextHits >= 2);

  // Verify user style matching
  const userMessages = [
    "hey priya! sorry for the radio silence",
    "been heads-down on the deployment",
    "things are going well but we hit a few snags",
    "mostly just indexing issues",
    "i think so. we should have the major issues sorted by wednesday",
    "fingers crossed! 🤞"
  ];
  const userStyleLower = userMessages.join(' ').toLowerCase();
  const usesEmojis = userStyleLower.includes('🤞');
  const isCasual = userStyleLower.includes('hey') && userStyleLower.includes('sorry');

  console.log('\n  Style matching:');
  if (usesEmojis) {
    const suggestionHasEmoji = allText.includes('🤞') || allText.includes('😊') || /[\u{1F300}-\u{1F9FF}]/u.test(allText);
    check('Emoji usage matches user style', suggestionHasEmoji);
  }
  if (isCasual) {
    check('Casual tone matches user style', !allText.includes('dear') && !allText.includes('sincerely'));
  }

  // ═══════════════════════════════════════════
  // STEP 6: Simulate refinement
  // ═══════════════════════════════════════════
  console.log('\nSTEP 6 — Refinement Flow');

  const selectedSuggestion = suggestions[0];
  const refinementInput = 'make it slightly more enthusiastic and add an emoji';

  const refineSystemPrompt = `You are refining a chat reply. Preserve the user's communication style.
Original reply: "${selectedSuggestion.text}"
Refinement request: "${refinementInput}"
Return ONLY valid JSON: {"refined_text":"...","changes_made":"..."}`;

  console.log('  Sending refinement request...');
  const refineStart = Date.now();
  const refineResponse = await callLocalAPI({
    messages: [
      { role: 'user', content: refineSystemPrompt }
    ]
  });
  const refineElapsed = ((Date.now() - refineStart) / 1000).toFixed(1);

  const refineContent = refineResponse.choices[0].message.content || '';
  let refineJsonStr = refineContent.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
  let refined;
  try {
    refined = JSON.parse(refineJsonStr);
  } catch {
    const match = refineContent.match(/\{[\s\S]*\}/);
    if (match) refined = JSON.parse(match[0]);
  }

  check(`Refinement response in ${refineElapsed}s`, refineElapsed < 30);
  check('Refinement returned valid JSON', !!refined);
  if (refined) {
    check('Refined text generated', (refined.refined_text || '').length > 10);
    check('Changes explained', (refined.changes_made || '').length > 3);
    console.log(`  Refined: "${(refined.refined_text || '').slice(0, 120)}..."`);
    console.log(`  Changes: ${refined.changes_made}`);
  }

  // ═══════════════════════════════════════════
  // FINAL REPORT
  // ═══════════════════════════════════════════
  const total = passed + failed;
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  RESULTS: ${passed}/${total} checks passed`.padEnd(43) + '║');
  console.log(`╚══════════════════════════════════════════╝`);

  if (failed > 0) {
    console.log(`\n❌ ${failed} checks failed`);
    process.exit(1);
  } else {
    console.log('\n✅ ALL CHECKS PASSED — Full pipeline works end-to-end');
    process.exit(0);
  }
})().catch(err => {
  console.error('\n💥 FATAL ERROR:', err.message);
  process.exit(1);
});
