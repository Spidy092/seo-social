const fs = require('node:fs');
const path = require('node:path');

describe('login form validation', () => {
    it('keeps native validation enabled for required credentials', () => {
        // Regression: ISSUE-001 — empty login submissions bypassed browser validation
        // Found by /qa on 2026-09-01
        // Report: .gstack/qa-reports/qa-report-localhost-4000-2026-09-01.md
        const template = fs.readFileSync(path.join(__dirname, '../../views/login.ejs'), 'utf8');
        const authForm = template.match(/<form[^>]+id="authForm"[^>]*>/)?.[0] || '';

        expect(authForm).not.toContain('novalidate');
        expect(template).toMatch(/id="emailInput"[^>]+required/);
        expect(template).toMatch(/id="passwordInput"[^>]+required/);
    });
});
