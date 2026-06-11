const { extractDomain } = require('../../src/utils/domainUtils');

describe('extractDomain', () => {
    it('strips protocol and www', () => {
        expect(extractDomain('https://www.example.com')).toBe('example.com');
        expect(extractDomain('http://www.example.com/path')).toBe('example.com');
    });

    it('handles bare domains', () => {
        expect(extractDomain('example.com')).toBe('example.com');
        expect(extractDomain('sub.example.com')).toBe('sub.example.com');
    });

    it('handles domains with paths', () => {
        expect(extractDomain('example.com/path/to/page')).toBe('example.com');
    });

    it('returns empty string for null/undefined/empty', () => {
        expect(extractDomain(null)).toBe('');
        expect(extractDomain(undefined)).toBe('');
        expect(extractDomain('')).toBe('');
    });

    it('normalizes to lowercase', () => {
        expect(extractDomain('HTTPS://WWW.EXAMPLE.COM')).toBe('example.com');
    });

    it('handles URLs with ports', () => {
        expect(extractDomain('https://example.com:3000/path')).toBe('example.com');
    });
});
