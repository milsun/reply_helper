document.addEventListener('DOMContentLoaded', async () => {
  const elements = {
    providerSelect: document.getElementById('provider-select'),
    modelSelect: document.getElementById('model-select'),
    apiKeyInput: document.getElementById('api-key-input'),
    apiKeyHint: document.getElementById('api-key-hint'),
    toggleApiKey: document.getElementById('toggle-api-key'),
    localSettings: document.getElementById('local-settings'),
    localEndpointInput: document.getElementById('local-endpoint-input'),
    localModelInput: document.getElementById('local-model-input'),
    suggestionCount: document.getElementById('suggestion-count-range'),
    countDisplay: document.getElementById('count-display'),
    qualityRange: document.getElementById('quality-range'),
    qualityDisplay: document.getElementById('quality-display'),
    customSystemPrompt: document.getElementById('custom-system-prompt'),
    customUserTemplate: document.getElementById('custom-user-template'),
    toggleAdvanced: document.getElementById('toggle-advanced'),
    advancedContent: document.getElementById('advanced-content'),
    resetBtn: document.getElementById('reset-btn')
  };

  let savedApiKey = '';

  function populateModelSelect(providerKey) {
    const models = getModelsForProvider(providerKey);
    elements.modelSelect.innerHTML = '';
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      elements.modelSelect.appendChild(option);
    });
  }

  function toggleLocalSettings(providerKey) {
    const isLocal = providerKey === 'local';
    elements.localSettings.classList.toggle('visible', isLocal);
    elements.apiKeyInput.parentElement.classList.toggle('local-provider', isLocal);
    elements.apiKeyHint.textContent = isLocal ? 'Optional — leave empty if no auth is required' : (savedApiKey ? 'API key configured' : 'No API key set');
  }

  async function loadSettings() {
    const provider = await get(STORAGE_KEYS.PROVIDER);
    const model = await get(STORAGE_KEYS.MODEL);
    savedApiKey = await get(STORAGE_KEYS.API_KEY);
    const localEndpoint = await get(STORAGE_KEYS.LOCAL_ENDPOINT);
    const localModel = await get(STORAGE_KEYS.LOCAL_MODEL);
    const suggestionCount = await get(STORAGE_KEYS.SUGGESTION_COUNT);
    const quality = await get(STORAGE_KEYS.IMAGE_QUALITY);
    const customSystemPrompt = await get(STORAGE_KEYS.CUSTOM_SYSTEM_PROMPT);
    const customUserTemplate = await get(STORAGE_KEYS.CUSTOM_USER_PROMPT_TEMPLATE);

    elements.providerSelect.value = provider;
    populateModelSelect(provider);
    toggleLocalSettings(provider);

    const availableModels = getModelsForProvider(provider);
    elements.modelSelect.value = availableModels.includes(model) ? model : availableModels[0];

    elements.apiKeyInput.value = savedApiKey;
    elements.apiKeyHint.textContent = provider === 'local'
      ? 'Optional — leave empty if no auth is required'
      : (savedApiKey ? 'API key configured' : 'No API key set');

    elements.localEndpointInput.value = localEndpoint;
    elements.localModelInput.value = localModel;

    elements.suggestionCount.value = suggestionCount;
    elements.countDisplay.textContent = suggestionCount;
    elements.qualityRange.value = Math.round(quality * 100);
    elements.qualityDisplay.textContent = Math.round(quality * 100) + '%';
    elements.customSystemPrompt.value = customSystemPrompt;
    elements.customUserTemplate.value = customUserTemplate;
  }

  async function saveSetting(key, value) {
    await set(key, value);
  }

  elements.providerSelect.addEventListener('change', async (e) => {
    const provider = e.target.value;
    await saveSetting(STORAGE_KEYS.PROVIDER, provider);
    populateModelSelect(provider);
    toggleLocalSettings(provider);
    const defaultModel = getDefaultModel(provider);
    elements.modelSelect.value = defaultModel;
    await saveSetting(STORAGE_KEYS.MODEL, defaultModel);

    elements.apiKeyHint.textContent = provider === 'local'
      ? 'Optional — leave empty if no auth is required'
      : (savedApiKey ? 'API key configured' : 'No API key set');
  });

  elements.modelSelect.addEventListener('change', async (e) => {
    await saveSetting(STORAGE_KEYS.MODEL, e.target.value);
  });

  let apiKeyTimer;
  elements.apiKeyInput.addEventListener('input', async (e) => {
    savedApiKey = e.target.value;
    elements.apiKeyHint.textContent = savedApiKey ? 'API key configured' : 'No API key set';
    clearTimeout(apiKeyTimer);
    apiKeyTimer = setTimeout(async () => {
      await saveSetting(STORAGE_KEYS.API_KEY, savedApiKey);
    }, 500);
  });

  elements.toggleApiKey.addEventListener('click', () => {
    const isPassword = elements.apiKeyInput.type === 'password';
    elements.apiKeyInput.type = isPassword ? 'text' : 'password';
    const icon = elements.toggleApiKey.querySelector('svg');
    if (isPassword) {
      icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
    } else {
      icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
    }
  });

  let localEndpointTimer;
  elements.localEndpointInput.addEventListener('input', () => {
    clearTimeout(localEndpointTimer);
    localEndpointTimer = setTimeout(async () => {
      await saveSetting(STORAGE_KEYS.LOCAL_ENDPOINT, elements.localEndpointInput.value.trim() || 'http://localhost:11434/v1');
    }, 500);
  });

  let localModelTimer;
  elements.localModelInput.addEventListener('input', () => {
    clearTimeout(localModelTimer);
    localModelTimer = setTimeout(async () => {
      const val = elements.localModelInput.value.trim();
      await saveSetting(STORAGE_KEYS.LOCAL_MODEL, val || 'minicpm-v');
    }, 500);
  });

  elements.suggestionCount.addEventListener('input', async (e) => {
    const count = parseInt(e.target.value);
    elements.countDisplay.textContent = count;
    await saveSetting(STORAGE_KEYS.SUGGESTION_COUNT, count);
  });

  elements.qualityRange.addEventListener('input', async (e) => {
    const quality = parseInt(e.target.value) / 100;
    elements.qualityDisplay.textContent = e.target.value + '%';
    await saveSetting(STORAGE_KEYS.IMAGE_QUALITY, quality);
  });

  let systemPromptTimer;
  elements.customSystemPrompt.addEventListener('input', () => {
    clearTimeout(systemPromptTimer);
    systemPromptTimer = setTimeout(async () => {
      await saveSetting(STORAGE_KEYS.CUSTOM_SYSTEM_PROMPT, elements.customSystemPrompt.value);
    }, 500);
  });

  let userTemplateTimer;
  elements.customUserTemplate.addEventListener('input', () => {
    clearTimeout(userTemplateTimer);
    userTemplateTimer = setTimeout(async () => {
      await saveSetting(STORAGE_KEYS.CUSTOM_USER_PROMPT_TEMPLATE, elements.customUserTemplate.value);
    }, 500);
  });

  elements.toggleAdvanced.addEventListener('click', () => {
    const hidden = elements.advancedContent.classList.toggle('hidden');
    elements.toggleAdvanced.textContent = hidden ? 'Show' : 'Hide';
  });

  elements.resetBtn.addEventListener('click', async () => {
    await resetToDefaults();
    await loadSettings();
  });

  await loadSettings();
});
