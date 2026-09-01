const { buildSourceHealth, classifySourceStatus, normalizeSourceRow } = require('../../src/services/sourceHealthService');

describe('sourceHealthService', () => {
    const now = new Date('2026-08-29T12:00:00.000Z');

    it('classifies a recent collection as fresh', () => {
        expect(classifySourceStatus({ lastCollectedAt: '2026-08-29T10:00:00Z', thresholdHours: 24 }, now)).toMatchObject({
            status: 'fresh',
            ageHours: 2,
        });
    });

    it('classifies old data as stale and failed attempts as failed', () => {
        expect(classifySourceStatus({ lastCollectedAt: '2026-08-20T10:00:00Z', thresholdHours: 24 }, now).status).toBe('stale');
        expect(classifySourceStatus({ lastCollectedAt: '2026-08-20T10:00:00Z', lastAttemptAt: '2026-08-29T11:00:00Z', lastStatus: 'failed' }, now).status).toBe('failed');
    });

    it('keeps optional providers neutral when not configured', () => {
        const result = buildSourceHealth({
            workspace: { lastCollectedAt: '2026-08-29T11:00:00Z', recordCount: 2 },
            gsc: { configured: false },
            ga4: { configured: false },
        }, now);

        expect(result.overallStatus).toBe('missing');
        expect(result.sources.find((source) => source.key === 'gsc')).toMatchObject({ status: 'not_configured' });
        expect(result.sources.find((source) => source.key === 'ga4')).toMatchObject({ status: 'not_configured' });
    });

    it('normalizes database aggregate fields before classification', () => {
        expect(normalizeSourceRow({
            last_collected_at: '2026-08-29T10:00:00Z',
            last_attempt_at: '2026-08-29T10:00:00Z',
            last_status: 'success',
            record_count: '12',
            configured_clients: '2',
        })).toMatchObject({
            lastCollectedAt: '2026-08-29T10:00:00Z',
            lastAttemptAt: '2026-08-29T10:00:00Z',
            lastStatus: 'success',
            recordCount: '12',
            configuredClients: '2',
        });
    });
});
