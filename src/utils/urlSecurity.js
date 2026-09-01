'use strict';

const dns = require('dns').promises;
const net = require('net');

const BLOCKED_HOSTNAMES = new Set([
    'localhost',
    'localhost.localdomain',
    'metadata.google.internal',
    'metadata.google.internal.',
]);

function ipv4ToParts(value) {
    if (net.isIP(value) !== 4) return null;
    const parts = value.split('.').map(Number);
    return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
        ? parts
        : null;
}

function ipv6ToParts(value) {
    const [head, tail] = String(value).split('::');
    if (String(value).split('::').length > 2) return null;
    const left = head ? head.split(':').filter(Boolean) : [];
    const right = tail ? tail.split(':').filter(Boolean) : [];
    const missing = 8 - left.length - right.length;
    if (missing < 0 || (!String(value).includes('::') && missing !== 0)) return null;
    const parts = [...left, ...Array(missing).fill('0'), ...right].map((part) => parseInt(part, 16));
    return parts.length === 8 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 0xffff)
        ? parts
        : null;
}

function isPrivateIp(value) {
    const ip = String(value || '')
        .trim()
        .toLowerCase();
    const v4 = ipv4ToParts(ip);

    if (v4) {
        const [a, b, c] = v4;
        return (
            a === 0 ||
            a === 10 ||
            a === 127 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 0 && c === 0) ||
            (a === 192 && b === 168) ||
            (a === 198 && (b === 18 || b === 19)) ||
            a >= 224
        );
    }

    if (net.isIP(ip) !== 6) return false;
    if (ip === '::' || ip === '::1') return true;

    // IPv4-mapped IPv6 addresses can bypass a string-only IPv4 check.
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    const ipv6Parts = ipv6ToParts(ip);
    if (ipv6Parts && ipv6Parts.slice(0, 5).every((part) => part === 0) && ipv6Parts[5] === 0xffff) {
        const mappedV4 = [ipv6Parts[6] >> 8, ipv6Parts[6] & 0xff, ipv6Parts[7] >> 8, ipv6Parts[7] & 0xff].join('.');
        return isPrivateIp(mappedV4);
    }

    // Unique-local, link-local, and multicast IPv6 ranges.
    return /^(fc|fd)[0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip) || /^ff[0-9a-f]{2}:/.test(ip);
}

function normalizeHostname(hostname) {
    return String(hostname || '')
        .replace(/^\[|\]$/g, '')
        .replace(/\.$/, '')
        .toLowerCase();
}

async function assertSafeHttpUrl(value, { allowPrivateNetwork = false } = {}) {
    const raw = String(value || '').trim();
    if (!raw || raw.length > 2048) {
        throw new Error('URL must be between 1 and 2048 characters');
    }

    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        throw new Error('Invalid URL');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Only HTTP and HTTPS URLs are allowed');
    }
    if (parsed.username || parsed.password) {
        throw new Error('URLs with embedded credentials are not allowed');
    }
    if (allowPrivateNetwork) return parsed;

    const hostname = normalizeHostname(parsed.hostname);
    if (
        !hostname ||
        BLOCKED_HOSTNAMES.has(hostname) ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal')
    ) {
        throw new Error('Private or local network URLs are not allowed');
    }

    let addresses;
    if (net.isIP(hostname)) {
        addresses = [hostname];
    } else {
        try {
            addresses = (await dns.lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
        } catch {
            throw new Error('Could not resolve URL host');
        }
    }

    if (!addresses.length || addresses.some(isPrivateIp)) {
        throw new Error('Private or local network URLs are not allowed');
    }

    return parsed;
}

module.exports = { assertSafeHttpUrl, isPrivateIp };
