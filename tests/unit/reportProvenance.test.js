const { buildReportProvenance, latestTimestamp, sourceEntry } = require('../../src/services/reportProvenance');

describe('report provenance', () => {
    it('returns the newest usable timestamp', () => {
        expect(
            latestTimestamp(
                [{ checked_at: '2026-01-02T10:00:00Z' }, { checked_at: '2026-01-04T10:00:00Z' }],
                ['checked_at'],
            ),
        ).toBe('2026-01-04T10:00:00.000Z');
    });

    it('marks missing sources as not collected instead of zero', () => {
        expect(sourceEntry('gsc', 'Search Console', [], ['created_at'])).toMatchObject({
            status: 'not_collected',
            recordCount: 0,
            lastCollectedAt: null,
        });
    });

    it('labels crawl-derived PageSpeed data as a proxy', () => {
        const provenance = buildReportProvenance({
            pageSpeed: { source: 'technical-crawl', fetchedAt: '2026-01-05T10:00:00Z' },
        });
        expect(provenance.pageSpeed).toMatchObject({
            status: 'proxy',
            source: 'Technical crawl proxy',
            note: 'Load-time signal derived from the technical crawl',
        });
    });
});
