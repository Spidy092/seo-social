function cleanInput(value) {
    return String(value || '').trim();
}

function normalizeDomain(value) {
    const raw = cleanInput(value);
    if (!raw) return '';

    try {
        const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        return new URL(withProtocol).hostname.toLowerCase().replace(/^www\./, '');
    } catch (_) {
        return raw
            .replace(/^https?:\/\//i, '')
            .replace(/^www\./i, '')
            .split('/')[0]
            .toLowerCase();
    }
}

function normalizePath(value) {
    const raw = cleanInput(value);
    if (!raw || raw === '/') return '/';

    let path = raw;
    try {
        const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://placeholder.test${raw.startsWith('/') ? raw : `/${raw}`}`);
        path = parsed.pathname || '/';
    } catch (_) {
        path = raw.split('#')[0].split('?')[0];
    }

    try {
        path = decodeURI(path);
    } catch (_) {
        // Keep original path if it contains malformed escape sequences.
    }

    path = path.startsWith('/') ? path : `/${path}`;
    path = path.replace(/\/{2,}/g, '/');
    if (path.length > 1) path = path.replace(/\/+$/, '');
    return path || '/';
}

function buildAbsoluteUrl(pathOrUrl, baseUrl) {
    const raw = cleanInput(pathOrUrl);
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;

    const domain = normalizeDomain(baseUrl);
    if (!domain) return raw;

    return `https://${domain}${normalizePath(raw)}`;
}

function normalizeUrl(value, baseUrl = '') {
    const raw = cleanInput(value);
    if (!raw) return '';

    const absolute = buildAbsoluteUrl(raw, baseUrl);
    try {
        const parsed = new URL(/^https?:\/\//i.test(absolute) ? absolute : `https://${absolute}`);
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        const path = normalizePath(parsed.pathname || '/');
        return `${host}${path === '/' ? '' : path}`;
    } catch (_) {
        const domain = normalizeDomain(baseUrl || raw);
        const path = normalizePath(raw.replace(/^https?:\/\/[^/]+/i, ''));
        return domain ? `${domain}${path === '/' ? '' : path}` : path;
    }
}

module.exports = {
    normalizeDomain,
    normalizePath,
    normalizeUrl,
    buildAbsoluteUrl,
};
