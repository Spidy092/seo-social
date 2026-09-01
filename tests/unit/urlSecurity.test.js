const { assertSafeHttpUrl, isPrivateIp } = require('../../src/utils/urlSecurity');

describe('url security', () => {
    it('recognizes private and special-use IP ranges', () => {
        expect(isPrivateIp('127.0.0.1')).toBe(true);
        expect(isPrivateIp('10.20.30.40')).toBe(true);
        expect(isPrivateIp('192.168.1.20')).toBe(true);
        expect(isPrivateIp('169.254.169.254')).toBe(true);
    expect(isPrivateIp('::1')).toBe(true);
    expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIp('::ffff:7f00:1')).toBe(true);
        expect(isPrivateIp('8.8.8.8')).toBe(false);
    });

    it('rejects local and non-http URLs before any network lookup', async () => {
        await expect(assertSafeHttpUrl('http://127.0.0.1:8080')).rejects.toThrow(/Private or local/);
        await expect(assertSafeHttpUrl('http://localhost/admin')).rejects.toThrow(/Private or local/);
        await expect(assertSafeHttpUrl('file:///etc/passwd')).rejects.toThrow(/Only HTTP/);
        await expect(assertSafeHttpUrl('https://user:pass@example.com')).rejects.toThrow(/embedded credentials/);
    });
});
