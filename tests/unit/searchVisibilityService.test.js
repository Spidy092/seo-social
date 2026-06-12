const {
    parseWebUrl,
    siteUrlAllows,
    clientAllowsUrl,
    buildUrlInspectionRecommendations,
    notifyGoogleIndexing,
} = require('../../src/services/searchVisibilityService');

describe('searchVisibilityService URL safety', () => {
    it('rejects localhost and private network URLs', () => {
        expect(() => parseWebUrl('http://localhost/post')).toThrow('private network');
        expect(() => parseWebUrl('https://127.0.0.1/post')).toThrow('private network');
        expect(() => parseWebUrl('https://192.168.1.20/post')).toThrow('private network');
        expect(() => parseWebUrl('ftp://example.com/post')).toThrow('http or https');
    });

    it('matches URL-prefix Search Console properties by host and path prefix', () => {
        expect(siteUrlAllows('https://www.example.com/blog/', 'https://example.com/blog/post')).toBe(true);
        expect(siteUrlAllows('https://www.example.com/blog/', 'https://example.com/services/page')).toBe(false);
        expect(siteUrlAllows('https://example.com/', 'https://other.com/post')).toBe(false);
    });

    it('matches domain Search Console properties across subdomains and protocols', () => {
        expect(siteUrlAllows('sc-domain:example.com', 'https://www.example.com/post')).toBe(true);
        expect(siteUrlAllows('sc-domain:example.com', 'http://blog.example.com/post')).toBe(true);
        expect(siteUrlAllows('sc-domain:example.com', 'https://example.org/post')).toBe(false);
    });

    it('keeps client URLs inside the connected client domain', () => {
        const client = {
            website_url: 'https://example.com',
            gsc_site_url: 'https://example.com/',
        };
        expect(clientAllowsUrl(client, 'https://example.com/blog/post')).toBe(true);
        expect(clientAllowsUrl(client, 'https://www.example.com/blog/post')).toBe(true);
        expect(clientAllowsUrl(client, 'https://evil-example.com/blog/post')).toBe(false);
    });
});

describe('searchVisibilityService recommendations', () => {
    it('builds recommendations from URL Inspection blockers', () => {
        const recommendations = buildUrlInspectionRecommendations({
            inspectionResult: {
                indexStatusResult: {
                    verdict: 'FAIL',
                    coverageState: 'Crawled - currently not indexed',
                    robotsTxtState: 'BLOCKED',
                    indexingState: 'BLOCKED_BY_NOINDEX',
                    pageFetchState: 'SERVER_ERROR',
                    userCanonical: 'https://example.com/post',
                    googleCanonical: 'https://example.com/other-post',
                    sitemap: [],
                },
            },
        });

        expect(recommendations.join(' ')).toContain('Robots.txt');
        expect(recommendations.join(' ')).toContain('noindex');
        expect(recommendations.join(' ')).toContain('different canonical');
        expect(recommendations.join(' ')).toContain('trouble fetching');
        expect(recommendations.join(' ')).toContain('sitemap');
    });
});

describe('searchVisibilityService Google Indexing API guard', () => {
    it('blocks normal pages before calling Google Indexing API', async () => {
        const insertedActions = [];
        const db = {
            async query(sql, params) {
                if (sql.includes('FROM seo_clients')) {
                    return {
                        rows: [{
                            id: 'client-1',
                            agency_id: 'agency-1',
                            website_url: 'https://example.com',
                            gsc_site_url: 'https://example.com/',
                        }],
                    };
                }
                if (sql.includes('INSERT INTO indexing_actions')) {
                    insertedActions.push(params);
                    return { rows: [{ id: 'action-1', status: params[5] }] };
                }
                return { rows: [] };
            },
        };

        await expect(notifyGoogleIndexing(db, {
            clientId: 'client-1',
            agencyId: 'agency-1',
            userId: 'user-1',
            url: 'https://example.com/blog/normal-post',
            type: 'URL_UPDATED',
            pageType: 'blog',
        })).rejects.toThrow('only available for eligible');

        expect(insertedActions).toHaveLength(1);
        expect(insertedActions[0][3]).toBe('google_indexing_api');
        expect(insertedActions[0][4]).toBe('blocked_google_indexing_request');
        expect(insertedActions[0][5]).toBe('blocked');
    });
});
