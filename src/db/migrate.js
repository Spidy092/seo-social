/**
 * Migration stub — schema is managed by src/db/index.js initializeDatabase().
 * Kept so `npm run migrate` doesn't fail.
 */
const { initializeDatabase } = require('./index');

(async () => {
    await initializeDatabase();
    console.log('Migration complete (schema already up to date).');
    process.exit(0);
})().catch(err => {
    console.error('Migration failed:', err.message);
    process.exit(1);
});
