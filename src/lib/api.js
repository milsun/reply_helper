const PROVIDERS = {
  local: {
    name: 'Local / Ollama',
    models: ['gemma-4-E2B-it-UD-Q4_K_XL.gguf', 'gemma-4-E4B-it-Q4_K_M.gguf', 'minicpm-v', 'llava', 'llava-phi3', 'bakllava', 'gemma3:12b'],
    defaultModel: 'gemma-4-E2B-it-UD-Q4_K_XL.gguf',
    endpoint: '',

    buildHeaders(apiKey) {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      return headers;
    },

    buildPayload(model, systemPrompt, userPrompt, imageBase64, imageMediaType) {
      return {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:${imageMediaType};base64,${imageBase64}` }
              },
              { type: 'text', text: userPrompt }
            ]
          }
        ],
        max_tokens: 32768,
        temperature: 0.7,
        stream: false
      };
    },

    parseResponse(data) {
      return safeParseJson(data.choices[0].message.content);
    }
  },

  openai: {
    name: 'OpenAI',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    defaultModel: 'gpt-4o',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    buildHeaders(apiKey) {
      return {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      };
    },
    buildPayload(model, systemPrompt, userPrompt, imageBase64, imageMediaType) {
      return {
        model,
        messages: [
          {
            role: 'system',
            content: [{ type: 'text', text: systemPrompt }]
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${imageMediaType};base64,${imageBase64}`,
                  detail: 'high'
                }
              },
              { type: 'text', text: userPrompt }
            ]
          }
        ],
        max_tokens: 32768,
        temperature: 0.7,
        response_format: { type: 'json_object' }
      };
    },
    parseResponse(data) {
      return safeParseJson(data.choices[0].message.content);
    }
  },

  anthropic: {
    name: 'Anthropic',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
    defaultModel: 'claude-3-5-sonnet-20241022',
    endpoint: 'https://api.anthropic.com/v1/messages',
    buildHeaders(apiKey) {
      return {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      };
    },
    buildPayload(model, systemPrompt, userPrompt, imageBase64, imageMediaType) {
      return {
        model,
        max_tokens: 32768,
        temperature: 0.7,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: imageMediaType,
                  data: imageBase64
                }
              },
              { type: 'text', text: userPrompt }
            ]
          }
        ]
      };
    },
    parseResponse(data) {
      return safeParseJson(data.content[0].text);
    }
  },

  google: {
    name: 'Google Gemini',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
    defaultModel: 'gemini-1.5-pro',
    endpoint(model) {
      return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    },
    buildHeaders(apiKey) {
      return {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      };
    },
    buildPayload(model, systemPrompt, userPrompt, imageBase64, imageMediaType) {
      return {
        contents: [
          {
            parts: [
              { text: `${systemPrompt}\n\n${userPrompt}` },
              {
                inlineData: {
                  mimeType: imageMediaType,
                  data: imageBase64
                }
              }
            ]
          }
        ],
        generationConfig: {
          maxOutputTokens: 32768,
          temperature: 0.7,
          responseMimeType: 'application/json'
        }
      };
    },
    getEndpoint(model) {
      return this.endpoint(model);
    },
    parseResponse(data) {
      return safeParseJson(data.candidates[0].content.parts[0].text);
    }
  }
};

async function callLLM(providerKey, model, apiKey, systemPrompt, userPrompt, imageDataUrl, options = {}) {
  const provider = PROVIDERS[providerKey];
  if (!provider) {
    throw new Error(`Unknown provider: ${providerKey}`);
  }

  if (!imageDataUrl) {
    throw new Error('No image provided. A screenshot is required.');
  }

  const imageBase64 = imageDataUrl.split(',')[1];
  const imageMediaType = imageDataUrl.match(/data:(image\/\w+);/)?.[1] || 'image/jpeg';

  const payload = provider.buildPayload(model, systemPrompt, userPrompt, imageBase64, imageMediaType);

  if (options.thinking) {
    payload.chat_template_kwargs = { enable_thinking: true };
  }
  const headers = provider.buildHeaders(apiKey);
  const endpoint = options.endpoint || (provider.getEndpoint ? provider.getEndpoint(model) : provider.endpoint);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      if (response.status === 401) {
        throw new Error('Invalid API key. Please check Settings.');
      }
      if (response.status === 429) {
        throw new Error('Rate limited. Please wait a moment and try again.');
      }
      if (response.status >= 500) {
        throw new Error('Service temporarily unavailable. Please try again.');
      }
      throw new Error(`API error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return provider.parseResponse(data);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. The image may be too large. Try showing less conversation.');
    }
    if (err.message.startsWith('Invalid API key') ||
        err.message.startsWith('Rate limited') ||
        err.message.startsWith('Service temporarily') ||
        err.message.startsWith('API error') ||
        err.message.startsWith('Request timed out') ||
        err.message.startsWith('Unknown provider')) {
      throw err;
    }
    if (err instanceof TypeError) {
      throw new Error('Network error. Check your connection and retry.');
    }
    throw err;
  }
}

function getModelsForProvider(providerKey) {
  const provider = PROVIDERS[providerKey];
  return provider ? provider.models : [];
}

function getDefaultModel(providerKey) {
  const provider = PROVIDERS[providerKey];
  return provider ? provider.defaultModel : 'gemma-4-E2B-it-UD-Q4_K_XL.gguf';
}

function getProviderNames() {
  return Object.entries(PROVIDERS).map(([key, val]) => ({
    key,
    name: val.name
  }));
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const cleaned = text
      .replace(/^```(?:json)?\s*/, '')
      .replace(/\s*```$/, '')
      .trim();
    return JSON.parse(cleaned);
  }
}
