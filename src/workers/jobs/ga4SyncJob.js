/**
 * Job wrapper for the GA4 daily sync.
 * Auto-discovered by src/workers/registry.js.
 */
const { startGa4Sync } = require('../ga4Sync');

module.exports = {
    name: 'ga4-sync',
    runOnce: true, // startGa4Sync sets up its own '0 5 * * *' cron
    run: async (db) => {
        startGa4Sync(db);
    },
};
