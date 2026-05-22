let lastScreenshot = null, lastPointer = '', lastResult = null, selectedSuggestion = null;

const $ = id => document.getElementById(id);
const els = {
  emptyState: $('empty-state'), loadingState: $('loading-state'),
  resultsState: $('results-state'), errorState: $('error-state'),
  captureBtn: $('capture-btn'), pointerInput: $('pointer-input'),
  loadingStatus: $('loading-status'), suggestionsList: $('suggestions-list'),
  regenerateBtn: $('regenerate-btn'), newCaptureBtn: $('new-capture-btn'),
  errorMessage: $('error-message'), retryBtn: $('retry-btn'), settingsBtn: $('settings-btn')
};

function showState(state) {
  els.emptyState.classList.toggle('active', state === 'empty');
  els.loadingState.classList.toggle('active', state === 'loading');
  els.resultsState.classList.toggle('active', state === 'results');
  els.errorState.classList.toggle('active', state === 'error');
  els.captureBtn.disabled = state !== 'empty';
}

function setStep(stepName) {
  document.querySelectorAll('.step').forEach(el => {
    el.classList.remove('active', 'complete');
    if (el.dataset.step === stepName) el.classList.add('active');
  });
}

function showError(msg) { els.errorMessage.textContent = msg; showState('error'); }

function deselectAll() {
  selectedSuggestion = null;
  document.querySelectorAll('.suggestion-card.selected').forEach(c => {
    c.classList.remove('selected');
    const box = c.querySelector('.refine-inline');
    if (box) box.remove();
  });
}

function selectSuggestion(card, suggestion) {
  const alreadySelected = card.classList.contains('selected');
  deselectAll();
  if (alreadySelected) return;

  card.classList.add('selected');
  selectedSuggestion = suggestion;

  // Build inline refine UI
  const box = document.createElement('div');
  box.className = 'refine-inline';

  const selected = document.createElement('div');
  selected.className = 'refine-selected';
  selected.textContent = '"' + (suggestion.text || '').slice(0, 80) + '"';
  box.appendChild(selected);

  const row = document.createElement('div');
  row.className = 'refine-row';
  const input = document.createElement('input');
  input.type = 'text'; input.className = 'refine-input';
  input.placeholder = 'make it shorter, more formal, add a joke...';
  input.maxLength = 200;
  row.appendChild(input);

  const btn = document.createElement('button');
  btn.className = 'btn-refine'; btn.textContent = 'Refine';
  btn.addEventListener('click', () => doRefine(card, suggestion, input));
  row.appendChild(btn);
  box.appendChild(row);

  // Result area
  const result = document.createElement('div');
  result.className = 'refine-result';
  const resultText = document.createElement('p');
  resultText.className = 'refine-result-text';
  const resultChanges = document.createElement('span');
  resultChanges.className = 'refine-result-changes';
  const resultBtns = document.createElement('div');
  resultBtns.className = 'refine-result-btns';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn-sm'; copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', async () => {
    const t = resultText.textContent;
    if (t && await copyToClipboard(t)) showToast('Copied!');
  });
  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'btn-sm'; dismissBtn.textContent = 'Dismiss';
  dismissBtn.addEventListener('click', () => result.classList.remove('visible'));

  resultBtns.appendChild(copyBtn);
  resultBtns.appendChild(dismissBtn);
  result.appendChild(resultText);
  result.appendChild(resultChanges);
  result.appendChild(resultBtns);
  box.appendChild(result);

  card.appendChild(box);
  input.focus();

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') doRefine(card, suggestion, input);
  });
}

async function doRefine(card, suggestion, input) {
  const refinementInput = input.value.trim();
  if (!refinementInput) { showToast('Enter instructions first.'); return; }

  const [provider, apiKey, model] = await Promise.all([get(STORAGE_KEYS.PROVIDER), get(STORAGE_KEYS.API_KEY), get(STORAGE_KEYS.MODEL)]);
  if (provider !== 'local' && !apiKey) { showError('API key needed.'); return; }

  const refineBtn = card.querySelector('.btn-refine');
  const resultDiv = card.querySelector('.refine-result');
  refineBtn.disabled = true;
  refineBtn.textContent = '...';
  resultDiv.classList.remove('visible');

  const sp = lastResult?.style_profile || null;
  const prompt = buildRefinePrompt(suggestion.text, refinementInput, lastResult?.context_summary || '', sp);
  const refineOpts = {};
  if (provider === 'local') {
    let ep = await get(STORAGE_KEYS.LOCAL_ENDPOINT);
    if (!ep.endsWith('/chat/completions')) ep = ep.replace(/\/+$/, '') + '/chat/completions';
    refineOpts.endpoint = ep;
    if (!model || model === getDefaultModel('local')) refineOpts.model = await get(STORAGE_KEYS.LOCAL_MODEL);
  }

  try {
    const result = await callLLM(provider, refineOpts.model || model, apiKey, prompt, '', lastScreenshot, refineOpts);
    card.querySelector('.refine-result-text').textContent = result.refined_text || '';
    card.querySelector('.refine-result-changes').textContent = result.changes_made || '';
    resultDiv.classList.add('visible');
  } catch (e) { showError(e.message || 'Refinement failed.'); }
  finally { refineBtn.disabled = false; refineBtn.textContent = 'Refine'; }
}

function renderCards(result) {
  els.suggestionsList.innerHTML = '';
  deselectAll();

  (result.suggestions || []).forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'suggestion-card';
    card.setAttribute('tabindex', '0');

    // Badge
    const badge = document.createElement('div');
    badge.className = 'card-badge';
    const dot = document.createElement('span');
    dot.className = 'card-badge-dot';
    dot.classList.add(['a','b','c'][i] || 'a');
    badge.appendChild(dot);
    const labels = { natural: 'Natural', 'different-angle': 'Alternate', creative: 'Creative' };
    const label = document.createElement('span');
    label.textContent = labels[s.approach] || s.approach || 'Natural';
    badge.appendChild(label);
    card.appendChild(badge);

    // Body
    const body = document.createElement('div');
    body.className = 'card-body';
    body.textContent = s.text || '';
    card.appendChild(body);

    // Rationale (hidden until selected)
    if (s.rationale) {
      const rationale = document.createElement('div');
      rationale.className = 'card-rationale';
      rationale.textContent = s.rationale;
      card.appendChild(rationale);
    }

    // Hint
    const hint = document.createElement('div');
    hint.className = 'card-hint';
    hint.textContent = 'Click to refine';
    card.appendChild(hint);

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'card-copy';
    copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy';
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await copyToClipboard(s.text);
      if (ok) {
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied';
        showToast('Copied!');
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy';
        }, 2000);
      }
    });
    card.appendChild(copyBtn);

    // Click card to toggle refine
    card.addEventListener('click', (e) => {
      if (e.target.closest('.card-copy') || e.target.closest('.btn-refine') || e.target.closest('.btn-sm')) return;
      selectSuggestion(card, s);
    });

    els.suggestionsList.appendChild(card);
  });
}

async function captureAndSuggest(pointer) {
  const [provider, apiKey] = await Promise.all([get(STORAGE_KEYS.PROVIDER), get(STORAGE_KEYS.API_KEY)]);
  if (provider !== 'local' && !apiKey) { showError('API key needed.'); return; }

  showState('loading');
  els.loadingStatus.textContent = 'Capturing screenshot...';
  setStep('capture');

  let screenshot;
  try { screenshot = await captureVisibleTab(); }
  catch (e) { showError(e.message || 'Capture failed.'); return; }

  els.loadingStatus.textContent = 'Optimizing image...';
  setStep('optimize');

  let optimized;
  try {
    const [quality, maxDim] = await Promise.all([get(STORAGE_KEYS.IMAGE_QUALITY), get(STORAGE_KEYS.IMAGE_MAX_DIMENSION)]);
    optimized = await optimizeImage(screenshot, { maxWidth: maxDim, maxHeight: maxDim, quality });
  } catch (e) { showError('Optimization failed.'); return; }

  els.loadingStatus.textContent = 'Analyzing conversation...';
  setStep('analyze');

  const [model, count, customSys, customUsr] = await Promise.all([
    get(STORAGE_KEYS.MODEL), get(STORAGE_KEYS.SUGGESTION_COUNT),
    get(STORAGE_KEYS.CUSTOM_SYSTEM_PROMPT), get(STORAGE_KEYS.CUSTOM_USER_PROMPT_TEMPLATE)
  ]);

  const callOpts = {};
  if (provider === 'local') {
    let ep = await get(STORAGE_KEYS.LOCAL_ENDPOINT);
    if (!ep.endsWith('/chat/completions')) ep = ep.replace(/\/+$/, '') + '/chat/completions';
    callOpts.endpoint = ep;
    if (!model || model === getDefaultModel('local')) callOpts.model = await get(STORAGE_KEYS.LOCAL_MODEL);
  }

  try {
    const result = await callLLM(provider, callOpts.model || model, apiKey,
      buildSystemPrompt(count, customSys), buildUserPrompt(pointer, customUsr),
      optimized.dataUrl, callOpts);

    lastScreenshot = optimized.dataUrl;
    lastPointer = pointer;
    lastResult = result;
    renderCards(result);
    showState('results');
    addRecentCapture({ pointer, suggestionCount: (result.suggestions || []).length, styleProfile: result.style_profile || null });
  } catch (e) { showError(e.message || 'Something went wrong.'); }
}

async function checkPending() {
  const d = await chrome.storage.local.get('pendingCapture');
  if (!d.pendingCapture) return false;
  if (Date.now() - d.pendingCapture.timestamp > 30000) { await chrome.storage.local.remove('pendingCapture'); return false; }
  await chrome.storage.local.remove('pendingCapture');
  await captureAndSuggest('');
  return true;
}

els.captureBtn.addEventListener('click', () => captureAndSuggest(els.pointerInput.value.trim()));
els.pointerInput.addEventListener('keydown', e => { if (e.key === 'Enter') captureAndSuggest(els.pointerInput.value.trim()); });
els.regenerateBtn.addEventListener('click', () => captureAndSuggest(lastPointer));
els.newCaptureBtn.addEventListener('click', () => { lastScreenshot = lastPointer = lastResult = null; selectedSuggestion = null; els.pointerInput.value = ''; showState('empty'); });
els.retryBtn.addEventListener('click', () => captureAndSuggest(lastPointer));
els.settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

document.addEventListener('DOMContentLoaded', async () => { if (!await checkPending()) showState('empty'); });
