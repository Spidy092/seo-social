const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const db = require('./src/db');

async function check() {
    try {
        console.log('🔍 Checking for duplicate keywords in database...');
        const result = await db.query(`
            SELECT keyword, COUNT(*) 
            FROM keywords 
            GROUP BY keyword 
            HAVING COUNT(*) > 1
        `);
        console.log('Duplicate keyword groups:', result.rows);

        const allKeywords = await db.query(`
            SELECT id, keyword, location 
            FROM keywords 
            WHERE keyword IN (
                SELECT keyword FROM keywords GROUP BY keyword HAVING COUNT(*) > 1
            )
        `);
        console.log('Detailed duplicate keywords:', allKeywords.rows);

        process.exit(0);
    } catch (err) {
        console.error('❌ Check failed:', err);
        process.exit(1);
    }
}

check();
