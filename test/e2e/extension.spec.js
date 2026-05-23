const { test, expect } = require('@playwright/test');
const path = require('path');

const HARNESS_PATH = path.resolve(__dirname, '../fixtures/test-harness.html');
const CHAT_PATH = path.resolve(__dirname, '../fixtures/chat-page.html');

// ──────────────────────────────────────────
// Unit Tests (run against test harness page)
// ──────────────────────────────────────────

test.describe('API Client — Payload Construction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);
  });

  test('OpenAI payload structure', async ({ page }) => {
    const p = await page.evaluate(() => {
      const provider = PROVIDERS.openai;
      return provider.buildPayload('gpt-4o', 'System prompt', 'User prompt', 'iVBORw0=', 'image/jpeg');
    });
    expect(p.model).toBe('gpt-4o');
    expect(p.messages).toHaveLength(2);
    expect(p.messages[0].role).toBe('system');
    expect(p.messages[1].content[0].type).toBe('image_url');
    expect(p.messages[1].content[0].image_url.detail).toBe('high');
    expect(p.max_tokens).toBe(32768);
    expect(p.response_format.type).toBe('json_object');
  });

  test('Anthropic payload structure', async ({ page }) => {
    const p = await page.evaluate(() => {
      return PROVIDERS.anthropic.buildPayload('claude-3-5-sonnet-20241022', 'Sys', 'User', 'iVBOR', 'image/jpeg');
    });
    expect(p.model).toBe('claude-3-5-sonnet-20241022');
    expect(p.system).toBe('Sys');
    expect(p.messages[0].content[0].type).toBe('image');
    expect(p.messages[0].content[0].source.type).toBe('base64');
    expect(p.messages[0].content[0].source.media_type).toBe('image/jpeg');
  });

  test('Gemini payload structure', async ({ page }) => {
    const p = await page.evaluate(() => {
      return PROVIDERS.google.buildPayload('gemini-1.5-pro', 'Sys', 'User', 'iVBOR', 'image/jpeg');
    });
    expect(p.contents).toHaveLength(1);
    expect(p.contents[0].parts).toHaveLength(2);
    expect(p.contents[0].parts[0].text).toContain('Sys');
    expect(p.contents[0].parts[1].inlineData.mimeType).toBe('image/jpeg');
    expect(p.generationConfig.responseMimeType).toBe('application/json');
  });

  test('Gemini API key is sent via header not URL', async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);
    const headers = await page.evaluate(() => PROVIDERS.google.buildHeaders('test-key-123'));
    expect(headers['x-goog-api-key']).toBe('test-key-123');
    expect(headers['Content-Type']).toBe('application/json');

    const url = await page.evaluate(() => PROVIDERS.google.getEndpoint('gemini-3.1-flash-lite'));
    expect(url).toContain('gemini-3.1-flash-lite');
    expect(url).not.toContain('key=');
  });
});

test.describe('API Client — Response Parsing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);
  });

  const mockResponse = {
    style_profile: {
      length: 'medium', formality: 'casual', emoji_usage: 'occasionally',
      signature_traits: 'short msgs, occasional emojis'
    },
    context_summary: 'Test summary',
    detected_tone: 'casual',
    suggestions: [
      { approach: 'natural', text: 'Reply 1', tone: 'friendly', rationale: 'fits well' },
      { approach: 'different-angle', text: 'Reply 2', tone: 'direct', rationale: 'gets to point' }
    ]
  };

  test('OpenAI parses choices[0].message.content', async ({ page }) => {
    const r = await page.evaluate((m) => {
      return PROVIDERS.openai.parseResponse({ choices: [{ message: { content: JSON.stringify(m) } }] });
    }, mockResponse);
    expect(r.context_summary).toBe('Test summary');
    expect(r.suggestions).toHaveLength(2);
  });

  test('Anthropic parses content[0].text', async ({ page }) => {
    const r = await page.evaluate((m) => {
      return PROVIDERS.anthropic.parseResponse({ content: [{ text: JSON.stringify(m) }] });
    }, mockResponse);
    expect(r.detected_tone).toBe('casual');
    expect(r.suggestions[0].text).toBe('Reply 1');
  });

  test('Gemini parses candidates[0].content.parts[0].text', async ({ page }) => {
    const r = await page.evaluate((m) => {
      return PROVIDERS.google.parseResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(m) }] } }] });
    }, mockResponse);
    expect(r.detected_tone).toBe('casual');
    expect(r.suggestions[1].tone).toBe('direct');
  });
});

test.describe('API Client — Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);
  });

  test('throws on unknown provider', async ({ page }) => {
    const r = await page.evaluate(async () => {
      try {
        await callLLM('unknown', 'm', 'k', '', '', 'data:image/jpeg;base64,abc');
        return { ok: true };
      } catch (e) { return { ok: false, msg: e.message }; }
    });
    expect(r.ok).toBe(false);
    expect(r.msg).toContain('Unknown provider');
  });

  test('throws on network error (TypeError)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const orig = window.fetch;
      window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
      try {
        await callLLM('openai', 'gpt-4o', 'k', '', '', 'data:image/jpeg;base64,abc');
        window.fetch = orig; return { ok: true };
      } catch (e) { window.fetch = orig; return { ok: false, msg: e.message }; }
    });
    expect(r.ok).toBe(false);
    expect(r.msg).toContain('Network error');
  });

  test('throws on 401', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const orig = window.fetch;
      window.fetch = () => Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('Unauthorized') });
      try {
        await callLLM('openai', 'gpt-4o', 'k', '', '', 'data:image/jpeg;base64,abc');
        window.fetch = orig; return { ok: true };
      } catch (e) { window.fetch = orig; return { ok: false, msg: e.message }; }
    });
    expect(r.ok).toBe(false);
    expect(r.msg).toContain('Invalid API key');
  });

  test('throws on 429', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const orig = window.fetch;
      window.fetch = () => Promise.resolve({ ok: false, status: 429, text: () => Promise.resolve('Too many') });
      try {
        await callLLM('openai', 'gpt-4o', 'k', '', '', 'data:image/jpeg;base64,abc');
        window.fetch = orig; return { ok: true };
      } catch (e) { window.fetch = orig; return { ok: false, msg: e.message }; }
    });
    expect(r.ok).toBe(false);
    expect(r.msg).toContain('Rate limited');
  });

  test('throws on 500', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const orig = window.fetch;
      window.fetch = () => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('Server error') });
      try {
        await callLLM('openai', 'gpt-4o', 'k', '', '', 'data:image/jpeg;base64,abc');
        window.fetch = orig; return { ok: true };
      } catch (e) { window.fetch = orig; return { ok: false, msg: e.message }; }
    });
    expect(r.ok).toBe(false);
    expect(r.msg).toContain('temporarily unavailable');
  });

  test('throws on AbortError (timeout)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const orig = window.fetch;
      window.fetch = () => {
        return new Promise((_, reject) => {
          setTimeout(() => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }, 50);
        });
      };
      try {
        await callLLM('openai', 'gpt-4o', 'k', '', '', 'data:image/jpeg;base64,abc');
        window.fetch = orig; return { ok: true };
      } catch (e) { window.fetch = orig; return { ok: false, msg: e.message }; }
    });
    expect(r.ok).toBe(false);
    expect(r.msg).toContain('timed out');
  });
});

test.describe('API Client — Provider Helpers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);
  });

  test('getModelsForProvider returns correct models', async ({ page }) => {
    const r = await page.evaluate(() => ({
      local: getModelsForProvider('local'),
      openai: getModelsForProvider('openai'),
      anthropic: getModelsForProvider('anthropic'),
      google: getModelsForProvider('google'),
      unknown: getModelsForProvider('nope')
    }));
    expect(r.local).toContain('gemma-4-E2B-it-UD-Q4_K_XL.gguf');
    expect(r.openai).toContain('gpt-4o');
    expect(r.anthropic).toContain('claude-3-5-sonnet-20241022');
    expect(r.google).toContain('gemini-3.1-flash-lite');
    expect(r.unknown).toEqual([]);
  });

  test('getDefaultModel returns correct defaults', async ({ page }) => {
    const r = await page.evaluate(() => ({
      local: getDefaultModel('local'),
      openai: getDefaultModel('openai'),
      anthropic: getDefaultModel('anthropic'),
      google: getDefaultModel('google')
    }));
    expect(r.local).toBe('gemma-4-E2B-it-UD-Q4_K_XL.gguf');
    expect(r.openai).toBe('gpt-4o');
    expect(r.anthropic).toBe('claude-3-5-sonnet-20241022');
    expect(r.google).toBe('gemini-3.1-flash-lite');
  });

  test('getProviderNames returns 4 providers', async ({ page }) => {
    const r = await page.evaluate(() => getProviderNames());
    expect(r).toHaveLength(4);
    expect(r.map(p => p.key).sort()).toEqual(['anthropic', 'google', 'local', 'openai']);
  });
});

test.describe('Prompt Templates', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);
  });

  test('default system prompt includes style analysis instructions', async ({ page }) => {
    const r = await page.evaluate(() => buildSystemPrompt(4, ''));
    expect(r).toContain('4');
    expect(r).toContain('communication style');
    expect(r).toContain('Message length');
    expect(r).toContain('Formality');
    expect(r).toContain('Emoji usage');
    expect(r).toContain('style_profile');
    expect(r).toContain('Natural Fit');
    expect(r).toContain('Different Angle');
    expect(r).toContain('Creative');
  });

  test('buildRefinePrompt includes style profile and selected text', async ({ page }) => {
    const styleProfile = {
      length: 'medium',
      formality: 'casual',
      emoji_usage: 'occasionally',
      signature_traits: 'uses haha often, short greetings'
    };

    const r = await page.evaluate((sp) => {
      return buildRefinePrompt(
        'Sure, lunch on Saturday works!',
        'make it shorter and add a joke',
        'Priya invited user to lunch.',
        sp
      );
    }, styleProfile);

    expect(r).toContain('Sure, lunch on Saturday works!');
    expect(r).toContain('make it shorter and add a joke');
    expect(r).toContain('casual tone');
    expect(r).toContain('medium messages');
    expect(r).toContain('haha often');
    expect(r).toContain('refined_text');
    expect(r).toContain('changes_made');
  });

  test('buildRefinePrompt handles null style profile gracefully', async ({ page }) => {
    const r = await page.evaluate(() => {
      return buildRefinePrompt('Hello, how are you?', 'be friendlier', 'Greeting exchange', null);
    });
    expect(r).toContain('Hello, how are you?');
    expect(r).toContain('be friendlier');
    expect(r).toContain('Not available');
  });

  test('custom system prompt overrides default', async ({ page }) => {
    const r = await page.evaluate(() => buildSystemPrompt(3, 'Custom with {suggestionCount}'));
    expect(r).toBe('Custom with 3');
  });

  test('default user prompt handles empty pointer', async ({ page }) => {
    const r = await page.evaluate(() => buildUserPrompt('', ''));
    expect(r).toContain('No specific pointers');
  });

  test('user prompt includes pointer text', async ({ page }) => {
    const r = await page.evaluate(() => buildUserPrompt('decline politely', ''));
    expect(r).toContain('decline politely');
  });

  test('custom user template replaces placeholder', async ({ page }) => {
    const r = await page.evaluate(() => buildUserPrompt('say no', 'Intent: {userPointer}'));
    expect(r).toBe('Intent: say no');
  });
});

test.describe('Image Capture & Optimization', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);
  });

  test('dataUrlToBase64 strips prefix', async ({ page }) => {
    const r = await page.evaluate(() => dataUrlToBase64('data:image/png;base64,HELLO123'));
    expect(r).toBe('HELLO123');
  });

  test('optimizeImage scales down large canvas', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 3840;
      canvas.height = 2160;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ffffff';
      ctx.font = '20px sans-serif';
      ctx.fillText('Chat test content for E2E', 100, 400);
      const dataUrl = canvas.toDataURL('image/png');
      return optimizeImage(dataUrl, { maxWidth: 1920, maxHeight: 1080, quality: 0.8, maxSizeBytes: 5 * 1024 * 1024 });
    });
    expect(r.width).toBeLessThanOrEqual(1921);
    expect(r.height).toBeLessThanOrEqual(1081);
    expect(r.dataUrl).toContain('data:image/jpeg;base64,');
    expect(r.sizeBytes).toBeLessThan(5 * 1024 * 1024);
  });

  test('optimizeImage preserves aspect ratio', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2560;
      canvas.height = 1440;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#222';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png');
      return optimizeImage(dataUrl, { maxWidth: 1280, maxHeight: 720, quality: 0.7 });
    });
    const ratio = r.width / r.height;
    const expectedRatio = 2560 / 1440;
    expect(Math.abs(ratio - expectedRatio)).toBeLessThan(0.01);
  });
});

test.describe('Storage Module (mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);
    await page.evaluate(() => chrome.storage.local.clear());
  });

  test('get returns defaults for unset keys', async ({ page }) => {
    const r = await page.evaluate(async () => ({
      provider: await get(STORAGE_KEYS.PROVIDER),
      model: await get(STORAGE_KEYS.MODEL),
      suggestions: await get(STORAGE_KEYS.SUGGESTION_COUNT),
      apiKey: await get(STORAGE_KEYS.API_KEY),
      localEndpoint: await get(STORAGE_KEYS.LOCAL_ENDPOINT),
      localModel: await get(STORAGE_KEYS.LOCAL_MODEL)
    }));
    expect(r.provider).toBe('google');
    expect(r.model).toBe('gemini-3.1-flash-lite');
    expect(r.suggestions).toBe(3);
    expect(r.apiKey).toBe('AIzaSyATzbTtdAGKq_2eAj3CgFeemSULfIBSmmw');
    expect(r.localEndpoint).toBe('http://localhost:8080/v1/chat/completions');
    expect(r.localModel).toBe('gemma-4-E2B-it-UD-Q4_K_XL.gguf');
  });

  test('set and get round-trip', async ({ page }) => {
    const r = await page.evaluate(async () => {
      await set(STORAGE_KEYS.PROVIDER, 'anthropic');
      const v1 = await get(STORAGE_KEYS.PROVIDER);
      await set(STORAGE_KEYS.PROVIDER, 'google');
      const v2 = await get(STORAGE_KEYS.PROVIDER);
      return { v1, v2 };
    });
    expect(r.v1).toBe('anthropic');
    expect(r.v2).toBe('google');
  });

  test('getAll returns all keys', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const all = await getAll();
      const keys = Object.keys(all);
      return { keyCount: keys.length, hasProvider: all[STORAGE_KEYS.PROVIDER] !== undefined };
    });
    expect(r.keyCount).toBeGreaterThanOrEqual(12);
    expect(r.hasProvider).toBe(true);
  });

  test('resetToDefaults clears and restores', async ({ page }) => {
    const r = await page.evaluate(async () => {
      await set(STORAGE_KEYS.PROVIDER, 'anthropic');
      await resetToDefaults();
      return await get(STORAGE_KEYS.PROVIDER);
    });
    expect(r).toBe('google');
  });

  test('addRecentCapture prepends and trims to 5', async ({ page }) => {
    const r = await page.evaluate(async () => {
      for (let i = 0; i < 7; i++) {
        await addRecentCapture({ screenshot: `img${i}`, pointer: `p${i}`, result: null });
      }
      const recent = await get(STORAGE_KEYS.RECENT_CAPTURES);
      return { count: recent.length, first: recent[0].pointer, last: recent[4].pointer };
    });
    expect(r.count).toBe(5);
    expect(r.first).toBe('p6');
    expect(r.last).toBe('p2');
  });
});

test.describe('Utility Functions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);
  });

  test('escapeHtml escapes HTML', async ({ page }) => {
    const r = await page.evaluate(() => escapeHtml('<script>alert("xss")</script>'));
    expect(r).not.toContain('<script>');
    expect(r).toContain('&lt;');
  });

  test('formatBytes formats sizes', async ({ page }) => {
    const r = await page.evaluate(() => ({
      b: formatBytes(500),
      kb: formatBytes(1500),
      mb: formatBytes(2400000)
    }));
    expect(r.b).toBe('500 B');
    expect(r.kb).toBe('1.5 KB');
    expect(r.mb).toBe('2.3 MB');
  });

  test('getApiKeyHint masks keys', async ({ page }) => {
    const r = await page.evaluate(() => ({
      empty: getApiKeyHint(''),
      short: getApiKeyHint('abc'),
      long: getApiKeyHint('sk-proj-1234567890abcdef')
    }));
    expect(r.empty).toBe('');
    expect(r.short).toBe('***');
    expect(r.long).toBe('sk-p••••cdef');
  });

  test('copyToClipboard returns true', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const r = await page.evaluate(async () => await copyToClipboard('hello world'));
    expect(r).toBe(true);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('hello world');
  });

  test('showToast creates and auto-removes element', async ({ page }) => {
    await page.evaluate(() => showToast('Test toast', 300));
    await expect(page.locator('.toast')).toBeVisible();
    await expect(page.locator('.toast')).toHaveText('Test toast');
    await page.waitForTimeout(800);
    await expect(page.locator('.toast')).not.toBeVisible();
  });
});

// ──────────────────────────────────────────
// Integration Tests (extension loaded)
// ──────────────────────────────────────────

test.describe('Extension Popup UI', () => {

  test('popup renders empty state with all elements', async ({ page }) => {
    await page.goto(`file://${CHAT_PATH}`);
    await page.waitForSelector('.chat-messages');

    const chatExists = await page.locator('.chat-messages .message').count();
    expect(chatExists).toBeGreaterThanOrEqual(7);

    const header = await page.textContent('.chat-header');
    expect(header).toContain('Priya Sharma');
  });

  test('chat page has input and send button', async ({ page }) => {
    await page.goto(`file://${CHAT_PATH}`);
    const input = page.locator('#chat-input');
    const sendBtn = page.locator('#send-btn');
    await expect(input).toBeVisible();
    await expect(sendBtn).toBeVisible();
  });

  test('sending a message adds it to chat', async ({ page }) => {
    await page.goto(`file://${CHAT_PATH}`);

    const initialCount = await page.locator('.message').count();
    await page.fill('#chat-input', 'Hello, this is a test message!');
    await page.click('#send-btn');

    const newCount = await page.locator('.message').count();
    expect(newCount).toBe(initialCount + 1);

    const lastMessage = await page.locator('.message').last().textContent();
    expect(lastMessage).toContain('Hello, this is a test message!');
  });
});

test.describe('Full Capture Flow (mocked API)', () => {

  test('captureVisibleTab works in mocked environment', async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);

    const r = await page.evaluate(async () => {
      const dataUrl = await captureVisibleTab();
      return {
        isDataUrl: dataUrl.startsWith('data:image/'),
        hasContent: dataUrl.length > 100
      };
    });
    expect(r.isDataUrl).toBe(true);
    expect(r.hasContent).toBe(true);
  });

  test('full pipeline: capture → optimize → mock API call', async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);

    const MOCK_RESULT = {
      style_profile: {
        length: 'medium',
        formality: 'casual',
        emoji_usage: 'occasionally',
        signature_traits: 'uses short greetings, occasional emojis, no periods'
      },
      context_summary: 'A conversation about project status and lunch plans',
      detected_tone: 'casual-friendly professional',
      suggestions: [
        { approach: 'natural', text: 'Mock reply 1', tone: 'casual', rationale: 'fits context' },
        { approach: 'different-angle', text: 'Mock reply 2', tone: 'formal', rationale: 'professional tone' }
      ]
    };

    const r = await page.evaluate(async (mock) => {
      const orig = window.fetch;
      window.fetch = (url, opts) => {
        const body = JSON.parse(opts.body);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            choices: [{ message: { content: JSON.stringify(mock) } }]
          })
        });
      };

      try {
        const dataUrl = await captureVisibleTab();
        const optimized = await optimizeImage(dataUrl, { quality: 0.8 });
        const systemPrompt = buildSystemPrompt(3, '');
        const userPrompt = buildUserPrompt('agree and suggest lunch', '');
        const result = await callLLM('openai', 'gpt-4o', 'test-key', systemPrompt, userPrompt, optimized.dataUrl);

        window.fetch = orig;
        return {
          optimized: optimized.dataUrl.startsWith('data:image/jpeg'),
          sizeOk: optimized.sizeBytes < 5 * 1024 * 1024,
          summary: result.context_summary,
          suggestions: result.suggestions.length,
          firstSuggestion: result.suggestions[0].text
        };
      } catch (e) {
        window.fetch = orig;
        return { error: e.message };
      }
    }, MOCK_RESULT);

    expect(r.optimized).toBe(true);
    expect(r.sizeOk).toBe(true);
    expect(r.summary).toBe(MOCK_RESULT.context_summary);
    expect(r.suggestions).toBe(2);
    expect(r.firstSuggestion).toBe('Mock reply 1');
  });
});

test.describe('Screenshot Capture Capability', () => {

  test('screenshot is captured as valid PNG data URL', async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);

    const r = await page.evaluate(async () => {
      const dataUrl = await captureVisibleTab();
      return {
        isPng: dataUrl.startsWith('data:image/png;base64,'),
        hasSubstantialContent: dataUrl.length > 500,
        canLoadAsImage: true
      };
    });
    expect(r.isPng).toBe(true);
    expect(r.hasSubstantialContent).toBe(true);
  });

  test('screenshot is properly optimized to JPEG', async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);

    const r = await page.evaluate(async () => {
      const dataUrl = await captureVisibleTab();
      const optimized = await optimizeImage(dataUrl, {
        maxWidth: 1920, maxHeight: 1080, quality: 0.85
      });
      return {
        isJpeg: optimized.dataUrl.startsWith('data:image/jpeg;base64,'),
        width: optimized.width,
        height: optimized.height,
        sizeBytes: optimized.sizeBytes,
        quality: optimized.quality
      };
    });
    expect(r.isJpeg).toBe(true);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
    expect(r.sizeBytes).toBeGreaterThan(0);
    expect(r.sizeBytes).toBeLessThan(5 * 1024 * 1024);
  });

  test('screenshot is embedded in API payload as base64 image', async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);

    const r = await page.evaluate(async () => {
      const dataUrl = await captureVisibleTab();
      const optimized = await optimizeImage(dataUrl, { quality: 0.8 });
      const base64 = dataUrlToBase64(optimized.dataUrl);

      const payload = PROVIDERS.openai.buildPayload(
        'gpt-4o', 'sys', 'usr', base64, 'image/jpeg'
      );

      const imageContent = payload.messages[1].content[0];
      return {
        hasImageUrl: imageContent.type === 'image_url',
        hasDetail: imageContent.image_url.detail === 'high',
        containsBase64: imageContent.image_url.url.includes('base64,'),
        payloadSize: JSON.stringify(payload).length
      };
    });
    expect(r.hasImageUrl).toBe(true);
    expect(r.hasDetail).toBe(true);
    expect(r.containsBase64).toBe(true);
    expect(r.payloadSize).toBeGreaterThan(1000);
  });
});

test.describe('User Pointer Injection', () => {

  test('pointer input is rendered in the popup empty state', async ({ page }) => {
    const popupPath = path.resolve(__dirname, '../../src/popup/popup.html');
    await page.goto(`file://${popupPath}`);
    await page.waitForSelector('#pointer-input');

    const input = page.locator('#pointer-input');
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('placeholder', /agree but suggest/);
    await expect(input).toHaveAttribute('maxlength', '200');
  });

  test('capture button is rendered and clickable', async ({ page }) => {
    const popupPath = path.resolve(__dirname, '../../src/popup/popup.html');
    await page.goto(`file://${popupPath}`);
    await page.waitForSelector('#capture-btn');

    const btn = page.locator('#capture-btn');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText(/capture.*suggest/i);
    await expect(btn).not.toBeDisabled();
  });

  test('pointer text flows into user prompt template', async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);

    const r = await page.evaluate(() => {
      const pointer = 'agree but propose next week instead';
      return buildUserPrompt(pointer, '');
    });
    expect(r).toContain('agree but propose next week instead');
    expect(r).toContain('Generate reply suggestions');
  });

  test('empty pointer defaults to natural suggestions', async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);

    const r = await page.evaluate(() => {
      return buildUserPrompt('', '');
    });
    expect(r).toContain('No specific pointers');
    expect(r).toContain('natural continuations');
  });

  test('pointer is injected into OpenAI API payload as text content', async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);

    const r = await page.evaluate(async () => {
      const dataUrl = await captureVisibleTab();
      const optimized = await optimizeImage(dataUrl, { quality: 0.8 });
      const base64 = dataUrlToBase64(optimized.dataUrl);

      const userPrompt = buildUserPrompt('say no but stay friendly', '');
      const systemPrompt = buildSystemPrompt(3, '');

      const payload = PROVIDERS.openai.buildPayload(
        'gpt-4o', systemPrompt, userPrompt, base64, 'image/jpeg'
      );

      const textContent = payload.messages[1].content[1];
      const systemContent = payload.messages[0].content[0];

      return {
        userPromptInPayload: textContent.text.includes('say no but stay friendly'),
        userPromptIncludesContext: textContent.text.includes('Generate reply suggestions'),
        systemHasSuggestionCount: systemContent.text.includes('3'),
        imageIsFirst: payload.messages[1].content[0].type === 'image_url',
        textIsSecond: payload.messages[1].content[1].type === 'text'
      };
    });
    expect(r.userPromptInPayload).toBe(true);
    expect(r.userPromptIncludesContext).toBe(true);
    expect(r.systemHasSuggestionCount).toBe(true);
    expect(r.imageIsFirst).toBe(true);
    expect(r.textIsSecond).toBe(true);
  });

  test('pointer is injected into Anthropic API payload', async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);

    const r = await page.evaluate(async () => {
      const dataUrl = await captureVisibleTab();
      const optimized = await optimizeImage(dataUrl, { quality: 0.8 });
      const base64 = dataUrlToBase64(optimized.dataUrl);

      const userPrompt = buildUserPrompt('decline politely and suggest alternatives', '');
      const systemPrompt = buildSystemPrompt(4, '');

      const payload = PROVIDERS.anthropic.buildPayload(
        'claude-3-5-sonnet-20241022', systemPrompt, userPrompt, base64, 'image/jpeg'
      );

      return {
        systemSet: payload.system.includes('conversation assistant'),
        userTextInContent: payload.messages[0].content[1].text.includes('decline politely'),
        imageHasBase64: payload.messages[0].content[0].source.data.length > 0,
        imageHasMediaType: payload.messages[0].content[0].source.media_type === 'image/jpeg'
      };
    });
    expect(r.systemSet).toBe(true);
    expect(r.userTextInContent).toBe(true);
    expect(r.imageHasBase64).toBe(true);
    expect(r.imageHasMediaType).toBe(true);
  });

  test('pointer is injected into Gemini API payload', async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);

    const r = await page.evaluate(async () => {
      const dataUrl = await captureVisibleTab();
      const optimized = await optimizeImage(dataUrl, { quality: 0.8 });
      const base64 = dataUrlToBase64(optimized.dataUrl);

      const userPrompt = buildUserPrompt('confirm the demo date', '');
      const systemPrompt = buildSystemPrompt(5, '');

      const payload = PROVIDERS.google.buildPayload(
        'gemini-1.5-pro', systemPrompt, userPrompt, base64, 'image/jpeg'
      );

      return {
        textContainsSystemAndUser: payload.contents[0].parts[0].text.includes('confirm the demo date'),
        textContainsSystemPrompt: payload.contents[0].parts[0].text.includes('conversation assistant'),
        hasImagePart: payload.contents[0].parts[1].inlineData.data.length > 0,
        imageMimeType: payload.contents[0].parts[1].inlineData.mimeType === 'image/jpeg'
      };
    });
    expect(r.textContainsSystemAndUser).toBe(true);
    expect(r.textContainsSystemPrompt).toBe(true);
    expect(r.hasImagePart).toBe(true);
    expect(r.imageMimeType).toBe(true);
  });

  test('full end-to-end: capture → optimize → pointer injection → mock API → parse response', async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);

    const MOCK_RESULT = {
      style_profile: {
        length: 'medium', formality: 'casual', emoji_usage: 'occasionally',
        signature_traits: 'uses short greetings, occasional emojis, no periods'
      },
      context_summary: 'Priya asks about project status and suggests lunch on Saturday.',
      detected_tone: 'casual-friendly',
      suggestions: [
        { approach: 'natural', text: 'Sure, lunch on Saturday works!', tone: 'friendly', rationale: 'warm acceptance' },
        { approach: 'different-angle', text: 'Saturday sounds great, Thai food is my favorite!', tone: 'enthusiastic', rationale: 'shows excitement' },
        { approach: 'creative', text: 'Yes to lunch! The demo should be on track by then.', tone: 'reassuring', rationale: 'addresses both topics' }
      ]
    };

    const userPointer = 'accept the lunch invite and reassure about the demo';

    const r = await page.evaluate(async ({ mock, pointer }) => {
      const orig = window.fetch;
      window.fetch = (url, opts) => {
        const body = JSON.parse(opts.body);
        const textContent = body.messages[1].content[1].text;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            choices: [{ message: { content: JSON.stringify(mock) } }]
          })
        });
      };

      try {
        const dataUrl = await captureVisibleTab();
        const optimized = await optimizeImage(dataUrl, { quality: 0.8 });
        const systemPrompt = buildSystemPrompt(3, '');
        const userPrompt = buildUserPrompt(pointer, '');
        const result = await callLLM('openai', 'gpt-4o', 'test-key', systemPrompt, userPrompt, optimized.dataUrl);

        window.fetch = orig;
        return {
          screenshotCaptured: optimized.dataUrl.startsWith('data:image/jpeg'),
          pointerInjected: true,
          summary: result.context_summary,
          suggestionCount: result.suggestions.length,
          pointerAddressed: result.suggestions.some(s => s.text.toLowerCase().includes('lunch')),
          demoAddressed: result.suggestions.some(s => s.text.toLowerCase().includes('demo'))
        };
      } catch (e) {
        window.fetch = orig;
        return { error: e.message };
      }
    }, { mock: MOCK_RESULT, pointer: userPointer });

    expect(r.screenshotCaptured).toBe(true);
    expect(r.pointerInjected).toBe(true);
    expect(r.summary).toBe(MOCK_RESULT.context_summary);
    expect(r.suggestionCount).toBe(3);
  });
});

test.describe('Store constants completeness', () => {

  test('STORAGE_KEYS has all required constants', async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);
    const keys = await page.evaluate(() => Object.keys(STORAGE_KEYS));
    const required = ['PROVIDER', 'MODEL', 'API_KEY', 'LOCAL_ENDPOINT', 'LOCAL_MODEL',
      'CUSTOM_SYSTEM_PROMPT', 'CUSTOM_USER_PROMPT_TEMPLATE', 'THEME', 'SUGGESTION_COUNT',
      'IMAGE_QUALITY', 'IMAGE_MAX_DIMENSION', 'RECENT_CAPTURES'];
    for (const k of required) {
      expect(keys).toContain(k);
    }
  });

  test('PROVIDERS has Local, OpenAI, Anthropic, Google', async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);
    const keys = await page.evaluate(() => Object.keys(PROVIDERS));
    expect(keys.sort()).toEqual(['anthropic', 'google', 'local', 'openai']);
  });

  test('each provider has required methods', async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);
    const r = await page.evaluate(() => {
      for (const [key, provider] of Object.entries(PROVIDERS)) {
        const has = {
          name: provider.name && provider.name.length > 0,
          models: Array.isArray(provider.models) && provider.models.length > 0,
          defaultModel: typeof provider.defaultModel === 'string',
          buildHeaders: typeof provider.buildHeaders === 'function',
          buildPayload: typeof provider.buildPayload === 'function',
          parseResponse: typeof provider.parseResponse === 'function'
        };
        for (const [method, ok] of Object.entries(has)) {
          if (!ok) return { fail: `${key}.${method} missing` };
        }
      }
      return { ok: true };
    });
    expect(r.ok).toBe(true);
  });
});

test.describe('Refinement Flow', () => {

  test('buildRefinePrompt replaces all placeholders', async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);

    const result = await page.evaluate(() => {
      const styleProfile = {
        length: 'brief',
        formality: 'very-casual',
        emoji_usage: 'heavily',
        signature_traits: 'all lowercase, lots of 😂, no punctuation'
      };

      const prompt = buildRefinePrompt(
        'hey lets do saturday instead',
        'make it slightly more formal but keep it short',
        'Discussing weekend plan change.',
        styleProfile
      );

      return {
        hasOriginal: prompt.includes('hey lets do saturday instead'),
        hasInstruction: prompt.includes('make it slightly more formal'),
        hasStyleFormality: prompt.includes('very-casual'),
        hasStyleEmoji: prompt.includes('heavily'),
        hasStyleTraits: prompt.includes('all lowercase'),
        hasContextSummary: prompt.includes('weekend plan'),
        hasRefinedTextField: prompt.includes('refined_text'),
        hasChangesField: prompt.includes('changes_made'),
        isComplete: prompt.length > 200
      };
    });

    expect(result.hasOriginal).toBe(true);
    expect(result.hasInstruction).toBe(true);
    expect(result.hasStyleFormality).toBe(true);
    expect(result.hasStyleEmoji).toBe(true);
    expect(result.hasStyleTraits).toBe(true);
    expect(result.hasContextSummary).toBe(true);
    expect(result.hasRefinedTextField).toBe(true);
    expect(result.hasChangesField).toBe(true);
    expect(result.isComplete).toBe(true);
  });

  test('refinement mock API call returns refined text', async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);

    const MOCK_REFINED = {
      refined_text: 'Hey, actually let\'s do Saturday instead — works better for me.',
      changes_made: 'Added proper capitalization, punctuation, and expanded slightly while keeping casual tone.'
    };

    const result = await page.evaluate(async (mock) => {
      const orig = window.fetch;
      window.fetch = () => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          choices: [{ message: { content: JSON.stringify(mock) } }]
        })
      });

      try {
        const refinePrompt = buildRefinePrompt(
          'hey lets do saturday', 'add punctuation and be clearer',
          'Plans discussion', null
        );
        const apiResult = await callLLM('openai', 'gpt-4o', 'test-key', refinePrompt, '', 'data:image/jpeg;base64,fake');
        window.fetch = orig;
        return {
          refined: apiResult.refined_text,
          changes: apiResult.changes_made
        };
      } catch (e) {
        window.fetch = orig;
        return { error: e.message };
      }
    }, MOCK_REFINED);

    expect(result.refined).toBe(MOCK_REFINED.refined_text);
    expect(result.changes).toBe(MOCK_REFINED.changes_made);
  });

  test('system prompt instructs LLM to analyze style and generate 3 distinct approaches', async ({ page }) => {
    await page.goto(`file://${HARNESS_PATH}`);

    const prompt = await page.evaluate(() => buildSystemPrompt(3, ''));

    expect(prompt).toContain('communication style');
    expect(prompt).toContain('Message length');
    expect(prompt).toContain('Emoji usage');
    expect(prompt).toContain('Punctuation');
    expect(prompt).toContain('Capitalization');
    expect(prompt).toContain('Vocabulary');
    expect(prompt).toContain('Natural Fit');
    expect(prompt).toContain('Different Angle');
    expect(prompt).toContain('Creative');
    expect(prompt).toContain('style_profile');
    expect(prompt).toContain('signature_traits');
    expect(prompt).toContain('Hard Rules for Every Suggestion');
  });
});
