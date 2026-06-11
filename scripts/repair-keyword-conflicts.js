#!/usr/bin/env node
require('dotenv').config();
const db = require('../src/db');

(async () => {
    await db.repairKeywordConflictIndexes();
    console.log('Keyword conflict repair complete.');
    await db.pool.end();
})().catch(async err => {
    console.error('Keyword conflict repair failed:', err.message);
    try { await db.pool.end(); } catch (_) {}
    process.exit(1);
});
