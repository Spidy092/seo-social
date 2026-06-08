const config = require('../config');
const { createLogger } = require('./logger');

const log = createLogger('ai-helper');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Clean and parse JSON from LLM response content.
 */
function extractJson(content) {
    const trimmed = String(content || '').trim();

    try {
        return JSON.parse(trimmed);
    } catch (err) {
        // Continue with fenced/embedded JSON extraction below.
    }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
        return JSON.parse(fenced[1].trim());
    }

    const firstObject = trimmed.indexOf('{');
    const firstArray = trimmed.indexOf('[');
    const starts = [firstObject, firstArray].filter(index => index >= 0);
    if (!starts.length) {
        throw new Error('No JSON object or array found in AI response');
    }

    const start = Math.min(...starts);
    const open = trimmed[start];
    const close = open === '[' ? ']' : '}';
    const end = trimmed.lastIndexOf(close);
    if (end <= start) {
        throw new Error('Incomplete JSON found in AI response');
    }

    return JSON.parse(trimmed.slice(start, end + 1));
}

/**
 * Perform a resilient LLM chat completions request with retries, backoffs,
 * timeout controls, and automatic provider fallbacks (OpenRouter -> Groq).
 * 
 * @param {Object} params
 * @param {string} params.prompt - The user prompt.
 * @param {string} [params.systemPrompt] - Optional system prompt.
 * @param {boolean} [params.expectJson=true] - Whether the response is expected to be JSON.
 * @param {number} [params.timeoutMs=30000] - Timeout per attempt in milliseconds.
 * @param {number} [params.maxRetries=3] - Maximum retry attempts per provider.
 * @param {string[]} [params.providerOrder] - Optional provider order, e.g. ['OpenRouter'].
 * @param {boolean} [params.allowFallback=true] - Whether to try additional providers after the first configured provider.
 * @param {number} [params.maxTokens] - Optional response token limit.
 */
async function resilientLlmRequest({ prompt, systemPrompt, expectJson = true, timeoutMs = 30000, maxRetries = 3, providerOrder, allowFallback = true, maxTokens }) {
    const providers = [];

    // Add OpenRouter as provider 1 if configured
    if (config.apis.openRouter && config.apis.openRouter.key) {
        providers.push({
            name: 'OpenRouter',
            url: config.apis.openRouter.url,
            key: config.apis.openRouter.key,
            model: config.apis.openRouter.model,
            headers: {
                'Authorization': `Bearer ${config.apis.openRouter.key}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.APP_URL || `http://localhost:${config.server.port || 4000}`,
                'X-Title': 'Keyword Analyzer'
            }
        });
    }

    // Add Groq as provider 2 if configured
    if (config.apis.groq && config.apis.groq.key) {
        providers.push({
            name: 'Groq',
            url: config.apis.groq.url,
            key: config.apis.groq.key,
            model: config.apis.groq.model,
            headers: {
                'Authorization': `Bearer ${config.apis.groq.key}`,
                'Content-Type': 'application/json'
            }
        });
    }

    let activeProviders = providers;

    if (Array.isArray(providerOrder) && providerOrder.length > 0) {
        const preferred = providerOrder.map(name => String(name).toLowerCase());
        activeProviders = providers
            .filter(provider => preferred.includes(provider.name.toLowerCase()))
            .sort((a, b) => preferred.indexOf(a.name.toLowerCase()) - preferred.indexOf(b.name.toLowerCase()));
    }

    if (!allowFallback) {
        activeProviders = activeProviders.slice(0, 1);
    }

    if (activeProviders.length === 0) {
        throw new Error('No AI providers configured. Please set OPENROUTER_API_KEY or GROQ_API_KEY in your .env file.');
    }

    let lastError = null;

    for (const provider of activeProviders) {
        let attempt = 0;
        let useJsonFormat = expectJson;

        log.debug({ provider: provider.name, model: provider.model }, 'Attempting request with provider');

        while (attempt < maxRetries) {
            attempt++;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const messages = [];
                if (systemPrompt) {
                    messages.push({ role: 'system', content: systemPrompt });
                }
                messages.push({ role: 'user', content: prompt });

                const payload = {
                    model: provider.model,
                    messages
                };

                if (Number.isFinite(maxTokens) && maxTokens > 0) {
                    payload.max_tokens = maxTokens;
                }

                // Apply JSON mode format if requested and supported
                if (useJsonFormat) {
                    payload.response_format = { type: 'json_object' };
                }

                const response = await fetch(provider.url, {
                    method: 'POST',
                    headers: provider.headers,
                    body: JSON.stringify(payload),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (response.ok) {
                    const data = await response.json();
                    const content = data?.choices?.[0]?.message?.content;
                    if (!content) {
                        throw new Error('Empty response content received from model');
                    }
                    return content; // Successfully received content!
                }

                // Handle 400 bad request due to response_format not supported by the model
                if (response.status === 400 && useJsonFormat) {
                    const errorText = await response.text();
                    log.warn({ provider: provider.name, error: errorText }, 'JSON format parameter not supported. Disabling JSON mode parameter and retrying.');
                    useJsonFormat = false;
                    attempt--; // Don't count this payload adjustment as a transient error attempt
                    continue;
                }

                const errorText = await response.text();
                log.warn({ provider: provider.name, attempt, status: response.status, error: errorText }, 'Provider attempt failed');

                // If it's a client error (e.g. 401 Unauthorized, 404 Model Not Found) except 429 Rate Limit, don't retry this provider
                if (response.status !== 429 && response.status < 500) {
                    throw new Error(`Provider ${provider.name} failed with status ${response.status}: ${errorText}`);
                }

                lastError = new Error(`Status ${response.status}: ${errorText}`);
            } catch (error) {
                clearTimeout(timeoutId);
                const isAbort = error.name === 'AbortError';
                log.warn({ provider: provider.name, attempt, error: isAbort ? 'Timeout' : error.message }, 'Attempt error');
                
                lastError = error;
                if (attempt >= maxRetries) {
                    break; // Move to next provider
                }
            }

            // Exponential backoff: 1s, 2s, 4s...
            const backoffMs = Math.pow(2, attempt) * 500 + Math.random() * 200;
            await delay(backoffMs);
        }
    }

    throw new Error(`All AI providers failed. Last error: ${lastError ? lastError.message : 'Unknown'}`);
}

module.exports = {
    resilientLlmRequest,
    extractJson
};
