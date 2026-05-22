# Reply Helper — Chrome Extension Technical Specification

## 1. Product Overview

**Reply Helper** is a Chrome extension that captures a screenshot of an active chat conversation in the browser, uses a vision-capable LLM to understand the conversation context, and generates contextual reply suggestions based on the conversation history and brief user-provided pointers about what they want to say.

### 1.1 Core Use Case

1. User is in a chat interface (WhatsApp Web, Slack, Telegram Web, Messenger, Discord, etc.)
2. User opens the extension popup
3. User optionally types a short pointer (e.g., "agree but propose another time next week")
4. User clicks "Capture & Suggest"
5. The extension captures a screenshot of the visible chat area
6. The screenshot is sent to a vision LLM along with the user's pointer
7. The LLM extracts the conversation context and generates 3–5 reply suggestions
8. Suggestions are displayed in the popup with one-click copy

---

## 2. Functional Requirements

### FR-1: Screenshot Capture
- **FR-1.1** Capture the full viewport screenshot of the active tab.
- **FR-1.2** Optionally allow the user to crop/select a region (v2).
- **FR-1.3** Optimize image (resize/compress to ≤ 5 MB) before sending to API.
- **FR-1.4** Handle scroll — if the chat is long, offer to capture only the visible portion (v1) or stitch multiple screenshots (v2).

### FR-2: LLM Vision Integration
- **FR-2.1** Support at least one vision-capable model (GPT-4o, Claude 3.5 Sonnet / Opus, Gemini 1.5 Pro).
- **FR-2.2** Allow the user to configure their own API key in settings.
- **FR-2.3** Allow model selection from a pre-defined list.
- **FR-2.4** Construct a prompt that:
  - Instructs the model to read the conversation from the screenshot.
  - Identifies who said what (speaker detection).
  - Understands the conversation context and tone.
  - Generates reply suggestions consistent with the user's persona.
- **FR-2.5** Handle API errors gracefully (rate limits, auth failures, timeouts).

### FR-3: Reply Suggestion Generation
- **FR-3.1** Accept user input: an optional text field for reply pointers/intent.
- **FR-3.2** Generate 3–5 distinct reply suggestions.
- **FR-3.3** Each suggestion should be:
  - Contextually relevant to the conversation.
  - Aligned with the user's pointer (if provided).
  - Varied in tone (casual, formal, concise, detailed).
- **FR-3.4** Regenerate button to get a fresh set of suggestions.
- **FR-3.5** One-click copy for each suggestion.

### FR-4: Settings & Configuration
- **FR-4.1** API key management (stored securely via `chrome.storage.local`).
- **FR-4.2** Model selection dropdown.
- **FR-4.3** Custom prompt template configuration (override the system prompt).
- **FR-4.4** Toggle for auto-compression / image quality.
- **FR-4.5** Toggle for dark/light theme.

### FR-5: UI / UX
- **FR-5.1** Popup window (~400×600px) with:
  - Header with extension name and settings icon.
  - Capture area (preview of last screenshot).
  - Text input for user pointers.
  - "Capture & Suggest" primary button.
  - Results area with suggestion cards and copy buttons.
  - Loading state with spinner / skeleton.
  - Error state with retry option.
  - Empty state (before first capture).
- **FR-5.2** Keyboard shortcut to trigger capture (e.g., `Ctrl+Shift+R`).
- **FR-5.3** Toast notification on copy success.

---

## 3. Non-Functional Requirements

### NFR-1: Privacy & Security
- **NFR-1.1** API keys are stored exclusively in `chrome.storage.local` and never logged.
- **NFR-1.2** Screenshots are sent directly to the LLM API; no intermediary server.
- **NFR-1.3** No telemetry or analytics collection.
- **NFR-1.4** Screenshots are not persisted to disk after API call completes.

### NFR-2: Performance
- **NFR-2.1** Screenshot capture + compression completes in < 1 second.
- **NFR-2.2** API call timeout set to 30 seconds with a user-visible countdown.
- **NFR-2.3** Popup loads in < 300ms.

### NFR-3: Compatibility
- **NFR-3.1** Chrome 110+ (Manifest V3).
- **NFR-3.2** Works on Windows, macOS, Linux, ChromeOS.
- **NFR-3.3** Works on chat platforms: WhatsApp Web, Telegram Web, Slack, Discord, Messenger, Google Chat, Microsoft Teams, LinkedIn Messaging, iMessage (web), any text-based chat in the browser.

### NFR-4: Reliability
- **NFR-4.1** Graceful degradation when API is unreachable.
- **NFR-4.2** Retry logic with exponential backoff (max 3 retries).
- **NFR-4.3** Offline detection — show appropriate message.

---

## 4. Technical Architecture

### 4.1 Extension Structure (Manifest V3)

```
reply_helper/
├── manifest.json                 # Extension manifest (MV3)
├── src/
│   ├── background/
│   │   └── service-worker.js     # Background service worker
│   ├── content/
│   │   └── content-script.js     # Injected into pages (optional, for region selection)
│   ├── popup/
│   │   ├── popup.html            # Popup UI
│   │   ├── popup.css             # Popup styles
│   │   └── popup.js              # Popup logic & API calls
│   ├── settings/
│   │   ├── settings.html         # Settings page
│   │   ├── settings.css
│   │   └── settings.js
│   ├── lib/
│   │   ├── api.js                # LLM API client (provider-agnostic)
│   │   ├── capture.js            # Screenshot capture utilities
│   │   ├── storage.js            # chrome.storage wrapper
│   │   ├── prompts.js            # Prompt templates
│   │   └── utils.js              # Shared utilities
│   └── assets/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── dist/                         # Build output (if using bundler)
├── package.json
└── docs/
    └── SPECIFICATION.md
```

### 4.2 Component Communication

```
┌─────────────────────────────────────────────────┐
│                   Chrome Browser                  │
│                                                  │
│  ┌──────────┐    chrome.tabs.captureVisibleTab   │
│  │  Popup   │◄───────────────────────────────────┤
│  │   UI     │                                    │
│  │          │──── API call ────►  LLM API        │
│  │          │   (direct from   (OpenAI/Claude/   │
│  │          │    popup via      Gemini)          │
│  │          │    fetch)                          │
│  └────┬─────┘                                    │
│       │                                          │
│       │ chrome.runtime.sendMessage               │
│       ▼                                          │
│  ┌──────────┐    chrome.tabs.captureVisibleTab   │
│  │ Service  │◄───────────────────────────────────┤
│  │ Worker   │   (screenshot capture)             │
│  └──────────┘                                    │
│                                                  │
│  ┌──────────┐                                    │
│  │ Content  │   (optional: region selection,     │
│  │ Script   │    DOM element detection)          │
│  └──────────┘                                    │
└─────────────────────────────────────────────────┘
```

### 4.3 Data Flow

```
User clicks "Capture & Suggest"
        │
        ▼
Popup sends message to service worker
        │
        ▼
Service worker calls chrome.tabs.captureVisibleTab()
        │
        ▼
Returns dataURL (base64 PNG) to popup
        │
        ▼
Popup compresses image to JPEG (< 5 MB)
        │
        ▼
Popup constructs payload:
  {
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } },
          { type: "text", text: "User pointer: {user_input}\nSuggest replies." }
        ]
      }
    ]
  }
        │
        ▼
Popup sends POST to LLM API with API key from storage
        │
        ▼
Parse response → extract reply suggestions
        │
        ▼
Render suggestions in popup UI
```

### 4.4 API Abstraction Layer

```javascript
// lib/api.js — Provider-agnostic interface

const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    endpoint: 'https://api.openai.com/v1/chat/completions',
    buildPayload(model, systemPrompt, imageBase64, userPointer) { /* ... */ },
    parseResponse(data) { /* ... */ }
  },
  anthropic: {
    name: 'Anthropic',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
    endpoint: 'https://api.anthropic.com/v1/messages',
    buildPayload(model, systemPrompt, imageBase64, userPointer) { /* ... */ },
    parseResponse(data) { /* ... */ }
  },
  google: {
    name: 'Google Gemini',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash'],
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
    buildPayload(model, systemPrompt, imageBase64, userPointer) { /* ... */ },
    parseResponse(data) { /* ... */ }
  }
};
```

### 4.5 Prompt Engineering

#### System Prompt (Default)

```
You are an expert conversation assistant. You are given a screenshot of a chat
conversation. Your task:

1. Read and understand the full conversation visible in the screenshot.
2. Identify who the user is (the person whose replies you'll help craft).
3. Understand the context, tone, and relationship between participants.
4. The user may provide a brief pointer describing what they want to say next.
5. Generate 3-5 high-quality reply suggestions that:
   - Match the user's communication style and tone observed in the chat.
   - Address the pointer if provided, otherwise provide natural continuations.
   - Vary in tone/approach (e.g., casual, formal, humorous, direct, diplomatic).
   - Are ready to copy-paste and send — no placeholders.
   - Are concise (1-3 sentences each unless the context demands more).

6. Return your response as a JSON object with this exact structure:
{
  "context_summary": "<1-2 sentence summary of the conversation>",
  "user_identity": "<who the user appears to be in this conversation>",
  "detected_tone": "<casual/formal/professional/friendly/etc.>",
  "suggestions": [
    {
      "text": "<reply text>",
      "tone": "<casual/formal/direct/etc.>",
      "rationale": "<brief 1-line explanation>"
    }
  ]
}

If you cannot read the screenshot clearly, set "context_summary" to "Unable to read conversation" and provide generic suggestions.
```

#### User Prompt (Dynamic)

```
User pointer: {user_input_if_provided_else_"No specific pointers. Suggest natural replies."}

Generate reply suggestions based on the conversation in the screenshot.
```

### 4.6 Screenshot Capture & Optimization

```javascript
// lib/capture.js

async function captureScreenshot() {
  // Capture visible tab
  const dataUrl = await chrome.tabs.captureVisibleTab(null, {
    format: 'png',
    quality: 100
  });

  // Optimize: resize if too large, convert to JPEG for smaller payload
  const optimized = await optimizeImage(dataUrl, {
    maxWidth: 1920,
    maxHeight: 1080,
    quality: 0.85,
    maxSizeBytes: 5 * 1024 * 1024  // 5 MB
  });

  return optimized; // base64 JPEG data URL
}

async function optimizeImage(dataUrl, options) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;

      // Scale down if exceeds max dimensions
      const scale = Math.min(
        options.maxWidth / width,
        options.maxHeight / height,
        1
      );
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Binary search for quality that fits maxSizeBytes
      let quality = options.quality;
      let result = canvas.toDataURL('image/jpeg', quality);

      while (result.length > options.maxSizeBytes && quality > 0.1) {
        quality -= 0.1;
        result = canvas.toDataURL('image/jpeg', quality);
      }

      resolve(result);
    };
    img.src = dataUrl;
  });
}
```

### 4.7 Storage Schema

```javascript
// chrome.storage.local keys

{
  // Provider configuration
  "provider": "openai",           // "openai" | "anthropic" | "google"
  "model": "gpt-4o",              // selected model ID
  "apiKey": "sk-...",              // encrypted API key (or plaintext in local storage)

  // Prompt customization
  "customSystemPrompt": "",       // empty = use default
  "customUserPromptTemplate": "", // empty = use default

  // UI preferences
  "theme": "system",              // "light" | "dark" | "system"
  "suggestionCount": 3,           // number of suggestions to generate (3-5)

  // Image settings
  "imageQuality": 0.85,           // JPEG compression quality (0.1 - 1.0)
  "imageMaxDimension": 1920,      // max width/height for captured image

  // Recent history (last 5 captures, for "regenerate")
  "recentCaptures": []            // array of { timestamp, dataUrl, pointers, suggestions }
}
```

---

## 5. UI Design Specification

### 5.1 Popup Layout

```
┌────────────────────────────────────┐
│  🔮 Reply Helper          ⚙️ [×]  │  ← Header (fixed)
├────────────────────────────────────┤
│                                    │
│  ┌──────────────────────────────┐  │
│  │                              │  │
│  │    Screenshot Preview        │  │  ← Collapsible preview of last capture
│  │    (collapsed by default)    │  │
│  │                              │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ What do you want to say?     │  │  ← Text input for user pointers
│  │                              │  │
│  └──────────────────────────────┘  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │      Capture & Suggest       │  │  ← Primary CTA button
│  └──────────────────────────────┘  │
│                                    │
│  ─── Suggestions ─────────────────  │
│                                    │
│  ┌──────────────────────────────┐  │
│  │ Suggestion 1 text here...    │  │
│  │ Tone: casual            [📋] │  │  ← Suggestion card with copy
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │ Suggestion 2 text here...    │  │
│  │ Tone: formal            [📋] │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │ Suggestion 3 text here...    │  │
│  │ Tone: friendly          [📋] │  │
│  └──────────────────────────────┘  │
│                                    │
│  [🔄 Regenerate]                   │
│                                    │
└────────────────────────────────────┘
```

### 5.2 States

| State | Description | UI Treatment |
|-------|-------------|-------------|
| **Empty** | No capture done yet | Show illustration + CTA |
| **Capturing** | Screenshot being taken | Button shows spinner + "Capturing..." |
| **Analyzing** | API call in progress | Skeleton cards with shimmer animation, elapsed time |
| **Results** | Suggestions received | Suggestion cards with copy buttons |
| **Error** | API call failed | Error message + "Retry" button |
| **No Suggestions** | API returned no usable suggestions | "Try again with different pointers" message |

### 5.3 Settings Page

```
┌────────────────────────────────────────────────┐
│  ⚙️ Settings                                    │
│                                                │
│  Provider                                      │
│  ┌──────────────────────────────────────────┐  │
│  │ [OpenAI ▼]                               │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  Model                                         │
│  ┌──────────────────────────────────────────┐  │
│  │ [GPT-4o ▼]                               │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  API Key                                       │
│  ┌──────────────────────────────────────────┐  │
│  │ ••••••••••••••••••    [👁 Show]          │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  Suggestions                                   │
│  ┌──────────────────────────────────────────┐  │
│  │ Number of suggestions: [3]              │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  Image Quality                                 │
│  ┌──────────────────────────────────────────┐  │
│  │ [━━━━━━━━━●━━━━━━━━] 85%                │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  ─── Advanced ─────────────────────────────── │
│                                                │
│  Custom System Prompt (overrides default)      │
│  ┌──────────────────────────────────────────┐  │
│  │ [expandable textarea]                    │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  [Reset to defaults]                           │
└────────────────────────────────────────────────┘
```

---

## 6. Manifest (manifest.json)

```json
{
  "manifest_version": 3,
  "name": "Reply Helper",
  "version": "1.0.0",
  "description": "Capture chat screenshots and get AI-powered reply suggestions based on conversation context.",
  "permissions": [
    "activeTab",
    "storage",
    "commands"
  ],
  "host_permissions": [
    "https://api.openai.com/*",
    "https://api.anthropic.com/*",
    "https://generativelanguage.googleapis.com/*"
  ],
  "action": {
    "default_popup": "src/popup/popup.html",
    "default_title": "Reply Helper",
    "default_icon": {
      "16": "src/assets/icon16.png",
      "48": "src/assets/icon48.png",
      "128": "src/assets/icon128.png"
    }
  },
  "background": {
    "service_worker": "src/background/service-worker.js"
  },
  "commands": {
    "capture-suggest": {
      "suggested_key": {
        "default": "Ctrl+Shift+R",
        "mac": "Command+Shift+R"
      },
      "description": "Capture screenshot and get reply suggestions"
    }
  },
  "icons": {
    "16": "src/assets/icon16.png",
    "48": "src/assets/icon48.png",
    "128": "src/assets/icon128.png"
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

---

## 7. API Request Specifications

### 7.1 OpenAI (GPT-4o / GPT-4o-mini)

```
POST https://api.openai.com/v1/chat/completions
Headers:
  Authorization: Bearer {apiKey}
  Content-Type: application/json

Body:
{
  "model": "gpt-4o",
  "messages": [
    {
      "role": "system",
      "content": [{ "type": "text", "text": "{system_prompt}" }]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,{base64_image}",
            "detail": "high"
          }
        },
        {
          "type": "text",
          "text": "{user_prompt}"
        }
      ]
    }
  ],
  "max_tokens": 1024,
  "temperature": 0.7,
  "response_format": { "type": "json_object" }
}

Expected Response (parsed from choices[0].message.content):
{
  "context_summary": "Alice and Bob are discussing weekend plans. Alice wants to go hiking, Bob prefers staying in.",
  "user_identity": "The user appears to be Alice.",
  "detected_tone": "casual",
  "suggestions": [
    { "text": "...", "tone": "...", "rationale": "..." },
    ...
  ]
}
```

### 7.2 Anthropic (Claude 3.5 Sonnet / Opus)

```
POST https://api.anthropic.com/v1/messages
Headers:
  x-api-key: {apiKey}
  anthropic-version: 2023-06-01
  Content-Type: application/json

Body:
{
  "model": "claude-3-5-sonnet-20241022",
  "max_tokens": 1024,
  "system": "{system_prompt}",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image",
          "source": {
            "type": "base64",
            "media_type": "image/jpeg",
            "data": "{base64_image}"
          }
        },
        {
          "type": "text",
          "text": "{user_prompt}"
        }
      ]
    }
  ]
}

Expected Response (parsed from content[0].text as JSON):
{ same JSON schema as OpenAI }
```

### 7.3 Google Gemini (1.5 Pro / Flash)

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}
Headers:
  Content-Type: application/json

Body:
{
  "contents": [
    {
      "parts": [
        { "text": "{system_prompt}\n\n{user_prompt}" },
        {
          "inlineData": {
            "mimeType": "image/jpeg",
            "data": "{base64_image}"
          }
        }
      ]
    }
  ],
  "generationConfig": {
    "maxOutputTokens": 1024,
    "temperature": 0.7,
    "responseMimeType": "application/json"
  }
}

Expected Response (parsed from candidates[0].content.parts[0].text as JSON):
{ same JSON schema as OpenAI }
```

---

## 8. Error Handling Matrix

| Error Scenario | User-Facing Message | Retryable? |
|---------------|-------------------|-----------|
| No API key configured | "Please configure your API key in Settings." | No |
| Invalid API key (401) | "Invalid API key. Please check Settings." | No |
| Rate limited (429) | "Rate limited. Please wait a moment and try again." | Yes (after delay) |
| Server error (5xx) | "Service temporarily unavailable. Please try again." | Yes |
| Network error | "Network error. Check your connection and retry." | Yes |
| Timeout (30s) | "Request timed out. The image may be too large." | Yes (with smaller img) |
| Model overloaded | "The AI service is busy. Try again or switch models." | Yes |
| Empty/invalid response | "Could not generate suggestions. Try different pointers." | Yes |
| Screenshot capture failed | "Could not capture screenshot. Refresh the page and try again." | Yes |
| Screenshot too large | "Screenshot too large. Try scrolling to show less conversation." | No (auto-compressed) |
| Unsupported content | "Could not read the conversation. Make sure chat text is clearly visible." | Yes |

---

## 9. Build & Dependencies

### 9.1 Runtime Dependencies (bundled with extension)

- **None.** The extension will be built with vanilla JavaScript to avoid bundler complexity and keep the extension lightweight. All API calls use native `fetch`.

### 9.2 Development Dependencies (optional, for dev tooling)

```json
{
  "devDependencies": {
    "prettier": "^3.x",
    "eslint": "^8.x"
  }
}
```

### 9.3 No Build Step (v1)

The extension ships as plain HTML/CSS/JS files. No webpack, vite, or bundler needed for v1. If complexity grows, a bundler can be added in a future version.

---

## 10. Testing Strategy

### 10.1 Manual QA Checklist

| Test Case | Steps | Expected |
|-----------|-------|----------|
| Setup flow | Install extension, open Settings, enter API key, select model | Settings persist across browser restarts |
| Basic capture | Open WhatsApp Web, click "Capture & Suggest" | Screenshot captured, shows in preview |
| AI analysis | After capture, wait for suggestions | 3-5 contextual suggestions appear |
| Copy suggestion | Click copy icon on a suggestion | Text copied to clipboard, toast shown |
| Regenerate | Click "Regenerate" | New set of suggestions generated |
| Error: no key | Clear API key, try capture | Shows settings prompt |
| Error: bad key | Enter invalid key, try capture | Shows auth error |
| Pointer input | Type "decline politely", capture | Suggestions reflect declining politely |
| Keyboard shortcut | Press Ctrl+Shift+R (Cmd+Shift+R on Mac) | Extension opens and captures |
| Different platforms | Test on WhatsApp, Slack, Telegram, Discord, Messenger | Works on all |
| Dark mode chat | Test on a dark-themed chat UI | Suggestions are still accurate |
| Long conversation | Chat with 30+ messages visible | All context captured |
| Non-English chat | Chat in Hindi, Spanish, etc. | Suggestions in the same language |

### 10.2 Unit Test Areas (future)

- API payload construction per provider
- Response parsing per provider
- Image compression/optimization
- Storage read/write operations
- Prompt template interpolation

---

## 11. Future Roadmap (v2+)

| Feature | Priority | Effort |
|---------|----------|--------|
| Region selection (crop specific area before capture) | High | Medium |
| Chat platform auto-detection (optimize prompt per platform) | Medium | Medium |
| Conversation history (persist suggestions for revisit) | Medium | Low |
| Custom tone presets (always formal, always casual, etc.) | Medium | Low |
| Multi-turn context (use previous suggestions as context) | Low | High |
| Direct reply injection (auto-paste into chat input) | Low | Medium |
| Stitch multiple screenshots for long conversations | Low | High |
| Offline canned responses (fallback when no API) | Low | Low |
| Team/shared prompt templates | Low | High |
| Analytics dashboard (usage stats) | Low | Medium |

---

## 12. Constraints & Assumptions

### Constraints
1. Manifest V3 only (Manifest V2 is deprecated).
2. `chrome.tabs.captureVisibleTab` captures the **entire viewport**, not a DOM element. Region selection requires either content script injection or user manual cropping.
3. Screenshots of chrome:// pages, extension pages, and the Chrome Web Store are not capturable.
4. API keys are stored in plaintext in `chrome.storage.local` (acceptable for local-only extension; no server component).
5. The extension makes API calls directly from the popup context. The popup must remain open during the API call.

### Assumptions
1. The user has their own API key for at least one supported LLM provider.
2. The user is on a chat platform that renders text in a readable format (not purely image-based captchas).
3. The user's browser window displays the chat clearly (no overlapping dialogs, sufficient font size).
4. Network connectivity is available when using the extension.

---

## 13. Implementation Order

| Phase | Tasks | Files |
|-------|-------|-------|
| **Phase 1: Scaffold** | `manifest.json`, extension icons, folder structure | `manifest.json`, `src/assets/` |
| **Phase 2: Storage** | Settings storage, API key management | `src/lib/storage.js` |
| **Phase 3: Capture** | Screenshot capture, image optimization | `src/lib/capture.js`, `src/background/service-worker.js` |
| **Phase 4: API Client** | OpenAI integration, Anthropic integration, Gemini integration | `src/lib/api.js`, `src/lib/prompts.js` |
| **Phase 5: Popup UI** | Popup HTML/CSS/JS with all states | `src/popup/` |
| **Phase 6: Settings** | Settings page with provider/model selection, API key input | `src/settings/` |
| **Phase 7: Polish** | Keyboard shortcuts, error handling, clipboard, toast notifications | various |
| **Phase 8: Test** | Manual QA across platforms, edge cases | — |
| **Phase 9: Ship** | Package as .zip, Chrome Web Store listing prep | `dist/` |
