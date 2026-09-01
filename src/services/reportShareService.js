const crypto = require('crypto');

const DEFAULT_EXPIRY_HOURS = 168;
const MAX_EXPIRY_HOURS = 24 * 30;

function normalizeExpiryHours(value) {
    const hours = Number(value);
    if (!Number.isFinite(hours)) return DEFAULT_EXPIRY_HOURS;
    return Math.min(MAX_EXPIRY_HOURS, Math.max(1, Math.round(hours)));
}

function hashShareToken(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createShareToken() {
    const token = crypto.randomBytes(32).toString('hex');
    return { token, tokenHash: hashShareToken(token) };
}

function createShareExpiry(now = new Date(), expiryHours = DEFAULT_EXPIRY_HOURS) {
    const start = now instanceof Date ? now : new Date(now);
    return new Date(start.getTime() + normalizeExpiryHours(expiryHours) * 60 * 60 * 1000);
}

module.exports = { createShareExpiry, createShareToken, hashShareToken, normalizeExpiryHours };
