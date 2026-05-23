const STORAGE_KEYS = {
  PROVIDER: 'provider',
  MODEL: 'model',
  API_KEY: 'apiKey',
  LOCAL_ENDPOINT: 'localEndpoint',
  LOCAL_MODEL: 'localModel',
  CUSTOM_SYSTEM_PROMPT: 'customSystemPrompt',
  CUSTOM_USER_PROMPT_TEMPLATE: 'customUserPromptTemplate',
  THEME: 'theme',
  ENABLE_THINKING: 'enableThinking',
  SUGGESTION_COUNT: 'suggestionCount',
  IMAGE_QUALITY: 'imageQuality',
  IMAGE_MAX_DIMENSION: 'imageMaxDimension',
  RECENT_CAPTURES: 'recentCaptures',
  STORAGE_VERSION: 'storageVersion'
};

const CURRENT_VERSION = 2;

const DEFAULTS = {
  [STORAGE_KEYS.STORAGE_VERSION]: CURRENT_VERSION,
  [STORAGE_KEYS.PROVIDER]: 'google',
  [STORAGE_KEYS.MODEL]: 'gemini-3.1-flash-lite',
  [STORAGE_KEYS.API_KEY]: 'AIzaSyATzbTtdAGKq_2eAj3CgFeemSULfIBSmmw',
  [STORAGE_KEYS.LOCAL_ENDPOINT]: 'http://localhost:8080/v1/chat/completions',
  [STORAGE_KEYS.LOCAL_MODEL]: 'gemma-4-E2B-it-UD-Q4_K_XL.gguf',
  [STORAGE_KEYS.CUSTOM_SYSTEM_PROMPT]: '',
  [STORAGE_KEYS.CUSTOM_USER_PROMPT_TEMPLATE]: '',
  [STORAGE_KEYS.THEME]: 'system',
  [STORAGE_KEYS.ENABLE_THINKING]: false,
  [STORAGE_KEYS.SUGGESTION_COUNT]: 3,
  [STORAGE_KEYS.IMAGE_QUALITY]: 0.85,
  [STORAGE_KEYS.IMAGE_MAX_DIMENSION]: 1920,
  [STORAGE_KEYS.RECENT_CAPTURES]: []
};

async function get(key) {
  try {
    const result = await chrome.storage.local.get(key);
    return result[key] !== undefined ? result[key] : DEFAULTS[key];
  } catch (err) {
    console.error('Storage get error:', err);
    return DEFAULTS[key];
  }
}

async function set(key, value) {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (err) {
    console.error('Storage set error:', err);
  }
}

async function getAll() {
  try {
    const keys = Object.values(STORAGE_KEYS);
    const result = await chrome.storage.local.get(keys);
    const all = {};
    for (const key of keys) {
      all[key] = result[key] !== undefined ? result[key] : DEFAULTS[key];
    }
    return all;
  } catch (err) {
    console.error('Storage getAll error:', err);
    return { ...DEFAULTS };
  }
}

async function resetToDefaults() {
  try {
    await chrome.storage.local.clear();
    await chrome.storage.local.set(DEFAULTS);
  } catch (err) {
    console.error('Storage reset error:', err);
  }
}

async function addRecentCapture(captureData) {
  const recent = await get(STORAGE_KEYS.RECENT_CAPTURES);
  recent.unshift({
    timestamp: Date.now(),
    ...captureData
  });
  const trimmed = recent.slice(0, 5);
  await set(STORAGE_KEYS.RECENT_CAPTURES, trimmed);
}

async function migrateIfNeeded() {
  const storedVersion = await get(STORAGE_KEYS.STORAGE_VERSION);
  if (!storedVersion || storedVersion < CURRENT_VERSION) {
    await resetToDefaults();
  }
}
