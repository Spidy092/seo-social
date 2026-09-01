/* global afterEach */

vi.mock('axios');
vi.mock('../../src/utils/logger', () => ({
    createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    }),
}));

const axios = require('axios');
const config = require('../../src/config');
const keywordService = require('../../src/services/keywordService');

describe('OpenSERP fallback', () => {
    const originalOpenSerp = { ...config.apis.openSerp };
    const originalSerper = { ...config.apis.serper };

    afterEach(() => {
        Object.assign(config.apis.openSerp, originalOpenSerp);
        Object.assign(config.apis.serper, originalSerper);
        vi.clearAllMocks();
    });

    it('normalizes regional mega-search results into the app SERP shape', async () => {
        axios.get = vi.fn();
        config.apis.serper.keys = [];
        config.apis.serper.key = undefined;
        config.apis.openSerp = {
            url: 'http://127.0.0.1:7000',
            apiKey: 'test-key',
            engine: 'google,bing',
            mode: 'balanced',
        };
        axios.get.mockResolvedValueOnce({
            data: {
                results: [
                    {
                        rank: 2,
                        position: { absolute: 2 },
                        url: 'https://example.com/page',
                        domain: 'example.com',
                        title: 'Example result',
                        snippet: 'A result from OpenSERP',
                        engine: 'bing',
                    },
                ],
                serp_features: [{ type: 'people_also_ask' }],
            },
        });

        const results = await keywordService.getSERPResults('seo tools', 'Whitefield', 10);

        expect(results).toEqual([
            {
                position: 2,
                url: 'https://example.com/page',
                domain: 'example.com',
                title: 'Example result',
                description: 'A result from OpenSERP',
                provider: 'openserp',
                engine: 'bing',
                features: [{ type: 'people_also_ask' }],
            },
        ]);
        expect(axios.get).toHaveBeenCalledWith(
            'http://127.0.0.1:7000/mega/search',
            expect.objectContaining({
                params: expect.objectContaining({
                    text: 'seo tools',
                    engines: 'google,bing',
                    mode: 'balanced',
                    region: 'Whitefield, Bangalore, Karnataka, India',
                    lang: 'EN',
                    limit: 10,
                    format: 'json',
                    features: true,
                }),
                headers: { Authorization: 'Bearer test-key' },
            }),
        );
    });
});
