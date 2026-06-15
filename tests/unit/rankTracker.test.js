vi.mock('node-cron', () => ({ schedule: vi.fn() }));
vi.mock('../../src/config', () => ({
    rankTracking: {
        checkInterval: 86400,
        rateLimitDelay: 0,
        batchConcurrency: 2,
        rankDropThreshold: 5,
        rankImprovementThreshold: 10,
        alertWebhook: null,
        webhookTimeout: 5000,
    },
}));
vi.mock('../../src/utils/logger', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../../src/utils/domainUtils', () => ({
    extractDomain: (value) => String(value || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0],
}));
vi.mock('axios');

const keywordService = require('../../src/services/keywordService');
const { checkAllRankings, createAlert } = require('../../src/workers/rankTracker');

describe('rankTracker', () => {
    let mockDb;

    beforeEach(() => {
        mockDb = { query: vi.fn() };
        vi.spyOn(keywordService, 'getSERPResults').mockReset();
    });

    it('skips when no active projects have linked keywords', async () => {
        mockDb.query.mockResolvedValueOnce({ rows: [] });
        const result = await checkAllRankings(mockDb);
        expect(result.checkedProjects).toBe(0);
        expect(mockDb.query).toHaveBeenCalledTimes(1);
    });

    it('checks only keywords linked to tracked projects', async () => {
        mockDb.query
            .mockResolvedValueOnce({ rows: [{ project_id: 'p1', client_id: 'c1', agency_id: 'a1', website_url: 'https://example.com', tracking_domain: null, target_location: 'India' }] })
            .mockResolvedValueOnce({ rows: [{ id: 10, keyword: 'seo agency', location: 'India', search_volume: 100 }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ id: 1 }] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] });

        keywordService.getSERPResults.mockResolvedValueOnce([{ domain: 'example.com', position: 3, url: 'https://example.com/seo' }]);

        const result = await checkAllRankings(mockDb);
        expect(result.checkedProjects).toBe(1);
        expect(result.succeeded).toBe(1);
        expect(keywordService.getSERPResults).toHaveBeenCalledWith('seo agency', 'India', 50);
        expect(mockDb.query.mock.calls.some(call => String(call[0]).includes('FROM seo_project_keywords spk'))).toBe(true);
        expect(mockDb.query.mock.calls.some(call => String(call[0]).includes('FROM keywords ORDER BY id'))).toBe(false);
    });

    it('deduplicates repeated alerts for the same project keyword movement window', async () => {
        mockDb.query.mockResolvedValueOnce({ rows: [{ id: 99 }] });
        const result = await createAlert(mockDb, {
            agencyId: 'a1',
            clientId: 'c1',
            projectId: 'p1',
            domain: 'example.com',
            keywordId: 10,
            alertType: 'rank_drop',
            severity: 'high',
            message: 'Rank dropped',
            oldValue: '4',
            newValue: '12',
            metadata: { movement: 'down' },
        });
        expect(result.id).toBe(99);
        expect(mockDb.query).toHaveBeenCalledTimes(1);
        expect(String(mockDb.query.mock.calls[0][0])).toContain('created_at > NOW()');
    });
});
