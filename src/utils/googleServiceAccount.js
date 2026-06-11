/**
 * Shared Google service account helpers.
 *
 * Prefer GOOGLE_SERVICE_ACCOUNT_JSON so one service account can power both
 * GSC and GA4. Keep service-specific fallbacks for existing installs.
 */

function readServiceAccountJson({ primaryEnv = 'GOOGLE_SERVICE_ACCOUNT_JSON', fallbackEnv, label = 'Google' } = {}) {
    const raw = process.env[primaryEnv] || (fallbackEnv ? process.env[fallbackEnv] : null);
    if (!raw) {
        const names = [primaryEnv, fallbackEnv].filter(Boolean).join(' or ');
        throw new Error(`${names} is not set in .env. Add your ${label} service account JSON as a single-line value.`);
    }

    try {
        return JSON.parse(raw);
    } catch (err) {
        throw new Error(`${primaryEnv}${fallbackEnv ? ` or ${fallbackEnv}` : ''} is not valid JSON: ${err.message}`);
    }
}

function hasServiceAccountJson(fallbackEnv) {
    return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || (fallbackEnv && process.env[fallbackEnv]));
}

module.exports = {
    readServiceAccountJson,
    hasServiceAccountJson,
};
