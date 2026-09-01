const { createShareExpiry, createShareToken, hashShareToken, normalizeExpiryHours } = require('../../src/services/reportShareService');

describe('reportShareService', () => {
    it('creates an opaque token and deterministic hash', () => {
        const share = createShareToken();
        expect(share.token).toMatch(/^[a-f0-9]{64}$/);
        expect(share.tokenHash).toBe(hashShareToken(share.token));
        expect(share.tokenHash).not.toBe(share.token);
    });

    it('clamps share expiry and calculates it from the requested start time', () => {
        expect(normalizeExpiryHours(0)).toBe(1);
        expect(normalizeExpiryHours(9999)).toBe(720);
        expect(createShareExpiry('2026-08-29T12:00:00Z', 24).toISOString()).toBe('2026-08-30T12:00:00.000Z');
    });
});
