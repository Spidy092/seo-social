/**
 * Job wrapper for the social-post scheduler.
 * Auto-discovered by src/workers/registry.js.
 */
const { startScheduler } = require('../postScheduler');

module.exports = {
    name: 'post-scheduler',
    runOnce: true, // startScheduler sets up its own '* * * * *' cron
    run: async () => {
        startScheduler();
    },
};
