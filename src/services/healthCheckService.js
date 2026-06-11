const axios = require('axios');
const config = require('../config');
const { createLogger } = require('./logger');

const log = createLogger('health-check');

const CHECK_TIMEOUT = 5000;

async function checkSerper() {
    if (!config.apis.serper.key && !config.apis.serper.keys?.length) {
        return { status: 'skipped', reason: 'not configured' };
    }
    try {
        const key = config.apis.serper.keys?.[0] || config.apis.serper.key;
        await axios.post(config.apis.serper.url, { q: 'test', num: 1 }, {
            headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
            timeout: CHECK_TIMEOUT,
        });
        return { status: 'ok' };
    } catch (err) {
        const code = err.response?.status || err.code;
        return { status: 'error', error: err.message, code };
    }
}

async function checkGoogleAds() {
    const required = ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_DEV_TOKEN'];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length) {
        return { status: 'skipped', reason: `missing: ${missing.join(', ')}` };
    }
    try {
        const { checkCredentials } = require('./googleAdsService');
        const result = await checkCredentials();
        return result.valid ? { status: 'ok' } : { status: 'error', error: result.error };
    } catch (err) {
        return { status: 'error', error: err.message };
    }
}

async function checkPageSpeed() {
    const key = process.env.GOOGLE_PAGESPEED_API_KEY || process.env.GOOGLE_CSE_API_KEY;
    if (!key) {
        return { status: 'skipped', reason: 'no API key' };
    }
    try {
        await axios.get('https://www.googleapis.com/pagespeedonline/v5/runPagespeed', {
            params: { url: 'https://example.com', key, category: 'performance' },
            timeout: CHECK_TIMEOUT,
        });
        return { status: 'ok' };
    } catch (err) {
        const code = err.response?.status || err.code;
        return { status: 'error', error: err.message, code };
    }
}

async function checkOpenRouter() {
    if (!config.apis.openRouter?.key) {
        return { status: 'skipped', reason: 'not configured' };
    }
    try {
        await axios.get('https://openrouter.ai/api/v1/models', {
            headers: { Authorization: `Bearer ${config.apis.openRouter.key}` },
            timeout: CHECK_TIMEOUT,
        });
        return { status: 'ok' };
    } catch (err) {
        const code = err.response?.status || err.code;
        return { status: 'error', error: err.message, code };
    }
}

async function checkGroq() {
    if (!config.apis.groq?.key) {
        return { status: 'skipped', reason: 'not configured' };
    }
    try {
        await axios.get('https://api.groq.com/openai/v1/models', {
            headers: { Authorization: `Bearer ${config.apis.groq.key}` },
            timeout: CHECK_TIMEOUT,
        });
        return { status: 'ok' };
    } catch (err) {
        const code = err.response?.status || err.code;
        return { status: 'error', error: err.message, code };
    }
}

async function checkCloudinary() {
    if (!process.env.CLOUDINARY_CLOUD_NAME) {
        return { status: 'skipped', reason: 'not configured' };
    }
    try {
        const cloudinary = require('cloudinary').v2;
        const result = await cloudinary.api.ping();
        return result?.status === 'ok' ? { status: 'ok' } : { status: 'error', error: 'ping failed' };
    } catch (err) {
        return { status: 'error', error: err.message };
    }
}

async function checkGoogleCse() {
    if (!config.apis.googleCse?.key) {
        return { status: 'skipped', reason: 'not configured' };
    }
    try {
        await axios.get(config.apis.googleCse.url, {
            params: { key: config.apis.googleCse.key, cx: config.apis.googleCse.cx, q: 'test', num: 1 },
            timeout: CHECK_TIMEOUT,
        });
        return { status: 'ok' };
    } catch (err) {
        const code = err.response?.status || err.code;
        return { status: 'error', error: err.message, code };
    }
}

async function runAllChecks() {
    const checks = await Promise.allSettled([
        checkSerper().then((r) => ['serper', r]),
        checkGoogleAds().then((r) => ['google_ads', r]),
        checkPageSpeed().then((r) => ['pagespeed', r]),
        checkOpenRouter().then((r) => ['openrouter', r]),
        checkGroq().then((r) => ['groq', r]),
        checkCloudinary().then((r) => ['cloudinary', r]),
        checkGoogleCse().then((r) => ['google_cse', r]),
    ]);

    const services = {};
    for (const result of checks) {
        if (result.status === 'fulfilled') {
            const [name, data] = result.value;
            services[name] = data;
        }
    }

    const hasErrors = Object.values(services).some((s) => s.status === 'error');

    return {
        status: hasErrors ? 'degraded' : 'ok',
        services,
        timestamp: new Date().toISOString(),
    };
}

module.exports = { runAllChecks, checkSerper, checkGoogleAds, checkPageSpeed, checkOpenRouter, checkGroq, checkCloudinary };
