/**
 * Job wrapper for the social analytics cron.
 * Auto-discovered by src/workers/registry.js.
 */
const { startAnalyticsCron } = require('../../services/analyticsSync');

module.exports = {
    name: 'analytics-sync',
    runOnce: true, // startAnalyticsCron sets up its own '0 2 * * *' cron
    run: async () => {
        startAnalyticsCron();
    },
};
