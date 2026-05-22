let currentState = 'empty';
let lastScreenshot = null;
let lastPointer = '';
let lastResult = null;
let selectedSuggestion = null;

const els = {
  emptyState: document.getElementById('empty-state'),
  loadingState: document.getElementById('loading-state'),
  resultsState: document.getElementById('results-state'),
  errorState: document.getElementById('error-state'),
  captureBtn: document.getElementById('capture-btn'),
  pointerInput: document.getElementById('pointer-input'),
  loadingStatus: document.getElementById('loading-status'),
  loadingPreview: document.getElementById('loading-preview'),
  screenshotPreview: document.getElementById('screenshot-preview'),
  togglePreviewBtn: document.getElementById('toggle-preview-btn'),
  previewWrap: document.getElementById('screenshot-preview-wrap'),
  pointerDisplay: document.getElementById('pointer-display'),
  contextSummary: document.getElementById('context-summary'),
  suggestionsList: document.getElementById('suggestions-list'),
  regenerateBtn: document.getElementById('regenerate-btn'),
  newCaptureBtn: document.getElementById('new-capture-btn'),
  errorMessage: document.getElementById('error-message'),
  retryBtn: document.getElementById('retry-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  refineSection: document.getElementById('refine-section'),
  refineSelectedText: document.getElementById('refine-selected-text'),
  refineInput: document.getElementById('refine-input'),
  refineBtn: document.getElementById('refine-btn'),
  refineResult: document.getElementById('refine-result'),
  refineResultText: document.getElementById('refine-result-text'),
  refineResultChanges: document.getElementById('refine-result-changes'),
  refineCopyBtn: document.getElementById('refine-copy-btn'),
  refineDismissBtn: document.getElementById('refine-dismiss-btn')
};

function setState(state) {
  currentState = state;
  els.emptyState.classList.toggle('active', state === 'empty');
  els.loadingState.classList.toggle('active', state === 'loading');
  els.resultsState.classList.toggle('active', state === 'results');
  els.errorState.classList.toggle('active', state === 'error');
  els.captureBtn.disabled = state !== 'empty';
}

function setLoadingStatus(text) {
  els.loadingStatus.textContent = text;
}

function showError(message) {
  els.errorMessage.textContent = message;
  setState('error');
}

function clearSelection() {
  selectedSuggestion = null;
  document.querySelectorAll('.suggestion-card.selected').forEach(c => c.classList.remove('selected'));
  els.refineSection.classList.remove('visible');
  els.refineResult.classList.remove('visible');
  els.refineInput.value = '';
}

function selectSuggestion(card, suggestion) {
  document.querySelectorAll('.suggestion-card.selected').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  selectedSuggestion = suggestion;

  els.refineSelectedText.textContent = '"' + suggestion.text + '"';
  els.refineInput.value = '';
  els.refineSection.classList.add('visible');
  els.refineResult.classList.remove('visible');
  els.refineInput.focus();
}

function renderSuggestions(result) {
  els.contextSummary.textContent = result.context_summary || '';

  if (result.style_profile) {
    const sp = result.style_profile;
    const traits = sp.signature_traits ? ` · ${sp.signature_traits}` : '';
    els.contextSummary.textContent = (result.context_summary || '') +
      ` | Style: ${sp.length}, ${sp.formality}, emojis: ${sp.emoji_usage}${traits}`;
  }

  els.suggestionsList.innerHTML = '';
  clearSelection();

  (result.suggestions || []).forEach((suggestion, index) => {
    const card = document.createElement('div');
    card.className = 'suggestion-card';
    card.setAttribute('data-index', index);

    card.addEventListener('click', () => {
      selectSuggestion(card, suggestion);
    });

    const approach = document.createElement('div');
    approach.className = 'suggestion-approach';
    approach.textContent = suggestion.approach || suggestion.tone || '';
    card.appendChild(approach);

    if (suggestion.rationale) {
      const rationale = document.createElement('div');
      rationale.className = 'suggestion-rationale';
      rationale.textContent = suggestion.rationale;
      card.appendChild(rationale);
    }

    const text = document.createElement('div');
    text.className = 'suggestion-text';
    text.textContent = suggestion.text;
    card.appendChild(text);

    const meta = document.createElement('div');
    meta.className = 'suggestion-meta';

    const tone = document.createElement('span');
    tone.className = 'suggestion-tone';
    tone.textContent = suggestion.tone || suggestion.approach || 'general';
    meta.appendChild(tone);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.title = 'Copy to clipboard';
    copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const success = await copyToClipboard(suggestion.text);
      if (success) {
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        showToast('Copied!');
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
        }, 2000);
      }
    });
    meta.appendChild(copyBtn);

    card.appendChild(meta);
    els.suggestionsList.appendChild(card);
  });

  if (lastPointer) {
    els.pointerDisplay.textContent = `Your pointer: "${lastPointer}"`;
    els.pointerDisplay.classList.add('visible');
  } else {
    els.pointerDisplay.classList.remove('visible');
  }
}

async function captureAndSuggest(pointer) {
  const apiKey = await get(STORAGE_KEYS.API_KEY);
  if (!apiKey) {
    showError('Please configure your API key in Settings.');
    return;
  }

  setState('loading');
  els.captureBtn.disabled = true;
  setLoadingStatus('Capturing screenshot...');

  let screenshot;
  try {
    screenshot = await captureVisibleTab();
  } catch (err) {
    showError(err.message || 'Failed to capture screenshot.');
    return;
  }

  setLoadingStatus('Optimizing image...');
  els.loadingPreview.style.display = 'block';
  els.loadingPreview.innerHTML = `<img src="${screenshot}" alt="Captured" />`;

  let optimized;
  try {
    const quality = await get(STORAGE_KEYS.IMAGE_QUALITY);
    const maxDimension = await get(STORAGE_KEYS.IMAGE_MAX_DIMENSION);
    optimized = await optimizeImage(screenshot, {
      maxWidth: maxDimension,
      maxHeight: maxDimension,
      quality
    });
  } catch (err) {
    showError('Failed to optimize screenshot. Please try again.');
    return;
  }

  setLoadingStatus('Analyzing conversation...');

  const [
    provider, model, suggestionCount, customSystemPrompt, customUserTemplate
  ] = await Promise.all([
    get(STORAGE_KEYS.PROVIDER),
    get(STORAGE_KEYS.MODEL),
    get(STORAGE_KEYS.SUGGESTION_COUNT),
    get(STORAGE_KEYS.CUSTOM_SYSTEM_PROMPT),
    get(STORAGE_KEYS.CUSTOM_USER_PROMPT_TEMPLATE)
  ]);

  const systemPrompt = buildSystemPrompt(suggestionCount, customSystemPrompt);
  const userPrompt = buildUserPrompt(pointer, customUserTemplate);

  try {
    const result = await callLLM(provider, model, apiKey, systemPrompt, userPrompt, optimized.dataUrl);
    lastScreenshot = optimized.dataUrl;
    lastPointer = pointer;
    lastResult = result;

    els.screenshotPreview.src = lastScreenshot;
    renderSuggestions(result);
    setState('results');

    await addRecentCapture({
      pointer: lastPointer,
      suggestionCount: (lastResult.suggestions || []).length,
      styleProfile: lastResult.style_profile || null
    });
  } catch (err) {
    showError(err.message || 'Something went wrong. Please try again.');
  }
}

async function refineSelectedReply() {
  if (!selectedSuggestion) return;

  const refinementInput = els.refineInput.value.trim();
  if (!refinementInput) {
    showToast('Enter refinement instructions first.');
    return;
  }

  const apiKey = await get(STORAGE_KEYS.API_KEY);
  if (!apiKey) {
    showError('Please configure your API key in Settings.');
    return;
  }

  const provider = await get(STORAGE_KEYS.PROVIDER);
  const model = await get(STORAGE_KEYS.MODEL);

  els.refineBtn.disabled = true;
  els.refineBtn.textContent = 'Refining...';
  els.refineResult.classList.remove('visible');

  const styleProfile = lastResult && lastResult.style_profile ? lastResult.style_profile : null;
  const contextSummary = lastResult ? lastResult.context_summary : '';
  const refinePrompt = buildRefinePrompt(selectedSuggestion.text, refinementInput, contextSummary, styleProfile);

  try {
    const result = await callLLM(provider, model, apiKey, refinePrompt, '', lastScreenshot);

    els.refineResultText.textContent = result.refined_text || '';
    els.refineResultChanges.textContent = result.changes_made || '';
    els.refineResult.classList.add('visible');
  } catch (err) {
    showError(err.message || 'Refinement failed. Please try again.');
  } finally {
    els.refineBtn.disabled = false;
    els.refineBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg> Refine`;
  }
}

async function checkPendingCapture() {
  const result = await chrome.storage.local.get('pendingCapture');
  if (result.pendingCapture) {
    const pending = result.pendingCapture;
    const age = Date.now() - pending.timestamp;
    if (age < 30000) {
      await chrome.storage.local.remove('pendingCapture');
      await captureAndSuggest('');
      return true;
    }
    await chrome.storage.local.remove('pendingCapture');
  }
  return false;
}

els.captureBtn.addEventListener('click', async () => {
  const pointer = els.pointerInput.value.trim();
  await captureAndSuggest(pointer);
});

els.pointerInput.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    const pointer = els.pointerInput.value.trim();
    await captureAndSuggest(pointer);
  }
});

els.regenerateBtn.addEventListener('click', async () => {
  await captureAndSuggest(lastPointer);
});

els.newCaptureBtn.addEventListener('click', () => {
  lastScreenshot = null;
  lastPointer = '';
  lastResult = null;
  selectedSuggestion = null;
  els.pointerInput.value = '';
  setState('empty');
});

els.retryBtn.addEventListener('click', async () => {
  await captureAndSuggest(lastPointer);
});

els.settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

els.togglePreviewBtn.addEventListener('click', () => {
  const collapsed = els.previewWrap.classList.toggle('collapsed');
  els.togglePreviewBtn.textContent = collapsed ? 'Show' : 'Hide';
});

els.refineBtn.addEventListener('click', refineSelectedReply);

els.refineInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') refineSelectedReply();
});

els.refineCopyBtn.addEventListener('click', async () => {
  const text = els.refineResultText.textContent;
  if (text) {
    const success = await copyToClipboard(text);
    if (success) showToast('Copied refined reply!');
  }
});

els.refineDismissBtn.addEventListener('click', () => {
  els.refineResult.classList.remove('visible');
});

document.addEventListener('DOMContentLoaded', async () => {
  const handled = await checkPendingCapture();
  if (!handled) {
    setState('empty');
  }
});
