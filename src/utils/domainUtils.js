/**
 * Shared domain extraction utility.
 *
 * Centralises the single canonical implementation that was previously duplicated
 * across keywordService.js and onpageService.js.
 *
 * Rules:
 *  - Strips leading protocol (http / https) if missing before parsing
 *  - Strips "www." prefix
 *  - Falls back to a simple regex split on parse failure (handles bare
 *    "example.com" strings that are not valid URL input)
 *  - Returns '' for null / undefined / empty input
 */
function extractDomain(url) {
    if (!url) return '';
    try {
        let cleanUrl = url.trim().toLowerCase();
        if (!cleanUrl.startsWith('http')) {
            cleanUrl = 'https://' + cleanUrl;
        }
        const urlObj = new URL(cleanUrl);
        let host = urlObj.hostname;
        if (host.startsWith('www.')) host = host.substring(4);

        // Reject weird hosts (no dot, trailing colon)
        if (host.includes('.') && !host.endsWith(':')) {
            return host;
        }
        return url; // fallback to original if host looks wrong
    } catch {
        // Bare strings like "example.com/path" or malformed URLs
        return url
            .replace(/^https?:\/\//i, '')
            .replace(/^www\./i, '')
            .split('/')[0];
    }
}

module.exports = { extractDomain };
