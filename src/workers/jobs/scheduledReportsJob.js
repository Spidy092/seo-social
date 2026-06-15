/**
 * Job wrapper for the scheduled email reports.
 * Auto-discovered by src/workers/registry.js.
 */
const { startScheduledReports } = require('../scheduledReports');

module.exports = {
    name: 'scheduled-reports',
    runOnce: true, // startScheduledReports sets up its own '*/15 * * * *' cron
    run: async (db) => {
        startScheduledReports(db);
    },
};
