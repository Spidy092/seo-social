const { resilientLlmRequest, extractJson } = require('../utils/aiHelper');
const { createLogger } = require('../utils/logger');

const log = createLogger('social-caption-ai');

async function generateCaptions(originalCaption, platforms) {
  const cleanCaption = String(originalCaption || '').trim();
  const cleanPlatforms = Array.isArray(platforms)
    ? platforms.map(platform => String(platform || '').trim().toLowerCase()).filter(Boolean)
    : [];

  if (!cleanCaption) {
    throw new Error('Base caption is required.');
  }

  if (!cleanPlatforms.length) {
    throw new Error('At least one platform must be selected.');
  }

  const systemPrompt = [
    'You are an expert social media copywriter. You will be provided with a base caption and a list of target platforms.',
    'Provide an optimized, platform-specific caption for each requested platform in JSON format.',
    'Adhere strictly to the requested platforms and use the exact platform name in lowercase as the JSON key.',
    'Constraints per platform:',
    '- instagram: Engaging, uses relevant emojis, max 30 hashtags.',
    '- facebook: Conversational, encourages interaction, fewer hashtags.',
    '- linkedin: Professional, value-driven, 3-5 appropriate hashtags.',
    '- youtube: Detailed description, includes call to action.',
    '',
    'RESPOND ONLY WITH VALID JSON. Do not include markdown code block backticks. Just the raw JSON object.',
    'Example: {"instagram": "...", "facebook": "..."}',
  ].join('\n');

  const prompt = [
    'Base caption:',
    cleanCaption,
    '',
    'Target platforms:',
    cleanPlatforms.join(', '),
  ].join('\n');

  try {
    const content = await resilientLlmRequest({
      prompt,
      systemPrompt,
      expectJson: true,
      timeoutMs: 30000,
      maxRetries: 3,
    });

    const parsed = extractJson(content);
    return normalizeCaptions(parsed, cleanPlatforms);
  } catch (err) {
    log.error({ err: err.message, platforms: cleanPlatforms }, 'caption generation failed');
    throw new Error('Caption generation failed: ' + err.message);
  }
}

function normalizeCaptions(parsed, platforms) {
  const normalized = {};

  platforms.forEach(platform => {
    const value = parsed?.[platform];
    normalized[platform] = typeof value === 'string' && value.trim()
      ? value.trim()
      : '';
  });

  return normalized;
}

module.exports = { generateCaptions };
