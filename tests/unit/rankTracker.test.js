// Mock dependencies before requiring the module
vi.mock('node-cron', () => ({ schedule: vi.fn() }));
vi.mock('../../src/config', () => ({
    rankTracking: {
        checkInterval: 86400,
        rateLimitDelay: 100,
        batchConcurrency: 2,
        rankDropThreshold: 5,
        rankImprovementThreshold: 10,
        alertWebhook: null,
        webhookTimeout: 5000,
    },
}));
vi.mock('../../src/utils/logger', () => ({
    createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }),
}));
vi.mock('../../src/services/keywordService', () => ({
    getSERPResults: vi.fn(),
}));
vi.mock('../../src/utils/domainUtils', () => ({
    extractDomain: (d) => d,
}));
vi.mock('axios');

const { checkAllRankings } = require('../../src/workers/rankTracker');

describe('rankTracker', () => {
    let mockDb;

    beforeEach(() => {
        mockDb = {
            query: vi.fn(),
        };
    });

    it('skips when no domains tracked', async () => {
        mockDb.query.mockResolvedValueOnce({ rows: [] }); // domains query
        await checkAllRankings(mockDb);
        expect(mockDb.query).toHaveBeenCalledTimes(1);
    });

    it('skips when no keywords exist', async () => {
        mockDb.query
            .mockResolvedValueOnce({ rows: [{ domain: 'example.com' }] }) // domains
            .mockResolvedValueOnce({ rows: [] }); // keywords
        await checkAllRankings(mockDb);
        expect(mockDb.query).toHaveBeenCalledTimes(2);
    });
});
