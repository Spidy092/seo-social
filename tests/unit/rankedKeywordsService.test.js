// Mock heavy deps so the service loads in isolation
vi.mock('axios');
vi.mock('../../src/utils/logger', () => ({
    createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }),
}));

const rankedSvc = require('../../src/services/rankedKeywordsService');

describe('normalizeTargetUrl', () => {
    it('strips protocol and www, lowercases', () => {
        expect(rankedSvc.normalizeTargetUrl('https://www.Example.com')).toBe('example.com');
        expect(rankedSvc.normalizeTargetUrl('HTTP://Example.COM')).toBe('example.com');
    });

    it('preserves path for sub-pages', () => {
        expect(rankedSvc.normalizeTargetUrl('example.com/services/ent'))
            .toBe('example.com/services/ent');
        expect(rankedSvc.normalizeTargetUrl('https://www.example.com/Services/ENT'))
            .toBe('example.com/services/ent');
    });

    it('drops the trailing slash for host-only inputs', () => {
        expect(rankedSvc.normalizeTargetUrl('https://example.com/')).toBe('example.com');
    });

    it('handles garbage gracefully', () => {
        expect(rankedSvc.normalizeTargetUrl(null)).toBe('');
        expect(rankedSvc.normalizeTargetUrl(undefined)).toBe('');
        expect(rankedSvc.normalizeTargetUrl('')).toBe('');
        expect(rankedSvc.normalizeTargetUrl('   ')).toBe('');
    });
});

describe('extractHost', () => {
    it('returns the host portion of a normalized URL', () => {
        expect(rankedSvc.extractHost('https://www.example.com/path/x')).toBe('example.com');
        expect(rankedSvc.extractHost('example.com')).toBe('example.com');
    });

    it('returns empty string for empty input', () => {
        expect(rankedSvc.extractHost('')).toBe('');
        expect(rankedSvc.extractHost(null)).toBe('');
    });
});

describe('locationToSerperParams', () => {
    it('maps India + Indian cities/states to gl=in, hl=en', () => {
        const in_ = ['India', 'Coimbatore', 'Chennai', 'Bangalore', 'Bengaluru',
            'Mumbai', 'Delhi', 'Hyderabad', 'Pune', 'Kolkata',
            'Tamil Nadu', 'Karnataka', 'Maharashtra', 'Kerala', 'Gujarat'];
        for (const loc of in_) {
            expect(rankedSvc.locationToSerperParams(loc)).toEqual({ gl: 'in', hl: 'en' });
        }
    });

    it('maps US/UK/CA/AU to their gl codes', () => {
        expect(rankedSvc.locationToSerperParams('United States')).toEqual({ gl: 'us', hl: 'en' });
        expect(rankedSvc.locationToSerperParams('USA')).toEqual({ gl: 'us', hl: 'en' });
        expect(rankedSvc.locationToSerperParams('United Kingdom')).toEqual({ gl: 'gb', hl: 'en' });
        expect(rankedSvc.locationToSerperParams('UK')).toEqual({ gl: 'gb', hl: 'en' });
        expect(rankedSvc.locationToSerperParams('Canada')).toEqual({ gl: 'ca', hl: 'en' });
        expect(rankedSvc.locationToSerperParams('Australia')).toEqual({ gl: 'au', hl: 'en' });
    });

    it('maps other regions to their language + country', () => {
        expect(rankedSvc.locationToSerperParams('Germany')).toEqual({ gl: 'de', hl: 'de' });
        expect(rankedSvc.locationToSerperParams('France')).toEqual({ gl: 'fr', hl: 'fr' });
        expect(rankedSvc.locationToSerperParams('Japan')).toEqual({ gl: 'jp', hl: 'ja' });
    });

    it('defaults to in/en for unknown / empty inputs', () => {
        expect(rankedSvc.locationToSerperParams('')).toEqual({ gl: 'in', hl: 'en' });
        expect(rankedSvc.locationToSerperParams('Atlantis')).toEqual({ gl: 'in', hl: 'en' });
        expect(rankedSvc.locationToSerperParams(null)).toEqual({ gl: 'in', hl: 'en' });
    });
});

describe('serperLocationString', () => {
    it('appends ", India" when no country is in the string', () => {
        expect(rankedSvc.serperLocationString('Coimbatore')).toBe('Coimbatore, India');
        expect(rankedSvc.serperLocationString('Chennai')).toBe('Chennai, India');
    });

    it('does not double-append when the string already has a country', () => {
        expect(rankedSvc.serperLocationString('Coimbatore, India')).toBe('Coimbatore, India');
        expect(rankedSvc.serperLocationString('New York, United States')).toBe('New York, United States');
    });

    it('returns "India" for empty / null input', () => {
        expect(rankedSvc.serperLocationString('')).toBe('India');
        expect(rankedSvc.serperLocationString(null)).toBe('India');
    });
});

describe('resolveClientLocation', () => {
    it('returns most-common keyword location when present', async () => {
        const mockDb = {
            query: vi.fn().mockResolvedValueOnce({ rows: [{ location: 'Chennai', n: '4' }] }),
        };
        const ctx = { projectId: 'p1', projectTargetLocation: 'Tamil Nadu', clientTargetLocations: ['Bangalore'] };
        const loc = await rankedSvc.resolveClientLocation(mockDb, ctx);
        expect(loc).toBe('Chennai');
        expect(mockDb.query).toHaveBeenCalledTimes(1);
    });

    it('falls back to project target_location when no keyword locations', async () => {
        const mockDb = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) };
        const ctx = { projectId: 'p1', projectTargetLocation: 'Coimbatore', clientTargetLocations: [] };
        const loc = await rankedSvc.resolveClientLocation(mockDb, ctx);
        expect(loc).toBe('Coimbatore');
    });

    it('falls back to first client target_locations element', async () => {
        const mockDb = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) };
        const ctx = { projectId: 'p1', projectTargetLocation: null, clientTargetLocations: ['Bangalore', 'Whitefield'] };
        const loc = await rankedSvc.resolveClientLocation(mockDb, ctx);
        expect(loc).toBe('Bangalore');
    });

    it('falls back to "India" when nothing is set', async () => {
        const mockDb = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) };
        const ctx = { projectId: 'p1', projectTargetLocation: null, clientTargetLocations: [] };
        const loc = await rankedSvc.resolveClientLocation(mockDb, ctx);
        expect(loc).toBe('India');
    });

    it('survives a DB error and falls back gracefully', async () => {
        const mockDb = { query: vi.fn().mockRejectedValueOnce(new Error('boom')) };
        const ctx = { projectId: 'p1', projectTargetLocation: 'Pune', clientTargetLocations: [] };
        const loc = await rankedSvc.resolveClientLocation(mockDb, ctx);
        expect(loc).toBe('Pune');
    });
});

describe('getRankedKeywords — full integration with mocked deps', () => {
    let mockDb;
    let originalPostSerper;

    beforeEach(() => {
        mockDb = { query: vi.fn() };
        originalPostSerper = require('../../src/services/keywordService').postSerperSearch;
    });

    afterEach(() => {
        require('../../src/services/keywordService').postSerperSearch = originalPostSerper;
    });

    it('returns cache hit without re-running the chain', async () => {
        // 1: project context
        mockDb.query.mockResolvedValueOnce({ rows: [{
            id: 'p1', name: 'Test', client_id: 'c1', tracking_domain: 'example.com',
            target_location: null, client_name: 'C', website_url: 'https://example.com',
            gsc_site_url: null, ga4_property_id: null, agency_id: 'a1', target_locations: [],
        }] });
        // 2: location resolution (no keyword locations → falls back to project/client/India)
        mockDb.query.mockResolvedValueOnce({ rows: [] });
        // 3: cache lookup
        mockDb.query.mockResolvedValueOnce({ rows: [{
            id: 's1', source: 'serper', count: 2, payload: { keywords: [
                { keyword: 'a', position: 5 }, { keyword: 'b', position: 12 },
            ]}, checked_at: new Date(), expires_at: new Date(Date.now() + 3600_000), location: 'India',
        }] });

        const r = await rankedSvc.getRankedKeywords(mockDb, { projectId: 'p1' });
        expect(r.source).toBe('cache');
        expect(r.cached).toBe(true);
        expect(r.count).toBe(2);
        expect(r.keywords.map(k => k.keyword)).toEqual(['a', 'b']);
    });

    it('falls back to rank_tracker when GSC and Serper both return nothing', async () => {
        // 1: project context
        mockDb.query.mockResolvedValueOnce({ rows: [{
            id: 'p1', name: 'Test', client_id: 'c1', tracking_domain: 'example.com',
            target_location: 'India', client_name: 'C', website_url: 'https://example.com',
            gsc_site_url: null, ga4_property_id: null, agency_id: 'a1', target_locations: [],
        }] });
        // 2: location resolution
        mockDb.query.mockResolvedValueOnce({ rows: [{ location: 'India', n: '3' }] });
        // 3: cache lookup — miss
        mockDb.query.mockResolvedValueOnce({ rows: [] });
        // 4: Serper seed keywords (none linked)
        mockDb.query.mockResolvedValueOnce({ rows: [] });
        // 5: rank_tracker lookup (new schema)
        mockDb.query.mockResolvedValueOnce({ rows: [{
            keyword_id: 1, rank_position: 7, url: 'https://example.com/x',
            checked_at: new Date(), keyword: 'free vpn', location: 'India',
            search_volume: 100, difficulty: 30,
        }] });
        // 6: snapshot insert
        mockDb.query.mockResolvedValueOnce({ rows: [{ checked_at: new Date() }] });

        // Make postSerperSearch throw to simulate "no key"
        require('../../src/services/keywordService').postSerperSearch = vi.fn().mockRejectedValue(new Error('SERPER_API_KEY or SERPER_API_KEYS is required'));

        const r = await rankedSvc.getRankedKeywords(mockDb, { projectId: 'p1', forceRefresh: true });
        expect(r.source).toBe('rank_tracker');
        expect(r.count).toBe(1);
        expect(r.keywords[0].keyword).toBe('free vpn');
        expect(r.keywords[0].position).toBe(7);
    });

    it('returns empty (no source) when there is no URL to query', async () => {
        mockDb.query.mockResolvedValueOnce({ rows: [{
            id: 'p1', name: 'Test', client_id: 'c1', tracking_domain: '',
            target_location: null, client_name: 'C', website_url: '',
            gsc_site_url: null, ga4_property_id: null, agency_id: 'a1', target_locations: [],
        }] });
        // 2: location resolution (returns rows.length === 0 but still hits DB)
        mockDb.query.mockResolvedValueOnce({ rows: [] });

        const r = await rankedSvc.getRankedKeywords(mockDb, { projectId: 'p1' });
        expect(r.source).toBe('none');
        expect(r.count).toBe(0);
        expect(r.keywords).toEqual([]);
        expect(r.url).toBe('');
    });
});
