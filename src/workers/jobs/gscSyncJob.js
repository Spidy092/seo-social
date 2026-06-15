/**
 * Job wrapper for the GSC daily sync.
 * Auto-discovered by src/workers/registry.js.
 */
const { startGscSync } = require('../gscSync');

module.exports = {
    name: 'gsc-sync',
    runOnce: true, // startGscSync sets up its own '0 4 * * *' cron
    run: async (db) => {
        startGscSync(db);
    },
};
