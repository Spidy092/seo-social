const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const db = require('./src/db');

async function cleanup() {
    console.log('🧹 Cleaning up invalid domain data...');
    try {
        const invalidDomains = ['https:', 'http:', 'https', 'http'];
        const result = await db.query(
            "DELETE FROM my_domains WHERE domain = ANY($1) RETURNING *",
            [invalidDomains]
        );
        console.log(`✅ Deleted ${result.rowCount} invalid domains:`, result.rows.map(r => r.domain));
        
        const resultHistory = await db.query(
            "DELETE FROM rank_history WHERE domain = ANY($1)",
            [invalidDomains]
        );
        console.log(`✅ Deleted ${resultHistory.rowCount} history entries for invalid domains.`);

        const resultRankings = await db.query(
            "DELETE FROM domain_rankings WHERE domain = ANY($1)",
            [invalidDomains]
        );
        console.log(`✅ Deleted ${resultRankings.rowCount} current rankings for invalid domains.`);

        process.exit(0);
    } catch (err) {
        console.error('❌ Cleanup failed:', err);
        process.exit(1);
    }
}

cleanup();
