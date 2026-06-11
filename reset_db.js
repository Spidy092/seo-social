require('dotenv').config();
const db = require('./src/db');

async function resetDatabase() {
    console.log('🔄 Resetting database...');
    try {
        console.log('🗑️ Dropping schema public...');
        await db.query('DROP SCHEMA public CASCADE');
        
        console.log('🏗️ Recreating schema public...');
        await db.query('CREATE SCHEMA public');
        await db.query('GRANT ALL ON SCHEMA public TO postgres');
        await db.query('GRANT ALL ON SCHEMA public TO public');

        console.log('✨ Re-initializing database schema...');
        await db.initializeDatabase();
        
        console.log('✅ Database reset successfully!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Failed to reset database:', err);
        process.exit(1);
    }
}

resetDatabase();
