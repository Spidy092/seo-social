/**
 * Job wrapper for the rank tracker.
 * The actual scheduling logic lives in src/workers/rankTracker.js — we just
 * forward db to its startRankTracker() and let it do its thing.
 *
 * This file is auto-discovered by src/workers/registry.js.
 */
const { startRankTracker } = require('../rankTracker');

module.exports = {
    name: 'rank-tracker',
    // The rank tracker schedules itself internally; we mark runOnce=true
    // so the registry fires it once on startup, which then sets up its
    // own cron. (Leaving it periodic here would create a second schedule.)
    runOnce: true,
    run: async (db) => {
        startRankTracker(db);
    },
};
