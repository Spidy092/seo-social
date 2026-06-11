// PM2 Ecosystem Config - Keyword Analyzer
// Workers are separated into their own processes so a crash in one
// does not bring down the API server.
module.exports = {
    apps: [
        // ─── API Server ───
        {
            name:             'keyword-analyzer',
            script:           'index.js',
            instances:        1,
            exec_mode:        'fork',
            watch:            false,
            max_memory_restart: '500M',
            env_production: {
                NODE_ENV: 'production',
                PORT: 4000,
                WORKER_ENABLED: 'false', // workers run as separate PM2 apps
            },
            log_date_format:  'YYYY-MM-DD HH:mm:ss',
            out_file:         './logs/pm2-out.log',
            error_file:       './logs/pm2-error.log',
            merge_logs:       true,
            restart_delay:    5000,
            max_restarts:     10,
            autorestart:      true,
        },

        // ─── Rank Tracker Worker ───
        {
            name:             'keyword-analyzer-rank-tracker',
            script:           'src/workers/runners/rankTrackerRunner.js',
            instances:        1,
            exec_mode:        'fork',
            watch:            false,
            max_memory_restart: '300M',
            env_production: {
                NODE_ENV: 'production',
            },
            log_date_format:  'YYYY-MM-DD HH:mm:ss',
            out_file:         './logs/pm2-rank-tracker-out.log',
            error_file:       './logs/pm2-rank-tracker-error.log',
            merge_logs:       true,
            restart_delay:    10000,
            max_restarts:     5,
            autorestart:      true,
        },

        // ─── Post Scheduler Worker ───
        {
            name:             'keyword-analyzer-post-scheduler',
            script:           'src/workers/runners/postSchedulerRunner.js',
            instances:        1,
            exec_mode:        'fork',
            watch:            false,
            max_memory_restart: '200M',
            env_production: {
                NODE_ENV: 'production',
            },
            log_date_format:  'YYYY-MM-DD HH:mm:ss',
            out_file:         './logs/pm2-scheduler-out.log',
            error_file:       './logs/pm2-scheduler-error.log',
            merge_logs:       true,
            restart_delay:    5000,
            max_restarts:     10,
            autorestart:      true,
        },

        // ─── GSC Sync + Analytics Worker ───
        {
            name:             'keyword-analyzer-gsc-sync',
            script:           'src/workers/runners/gscSyncRunner.js',
            instances:        1,
            exec_mode:        'fork',
            watch:            false,
            max_memory_restart: '200M',
            env_production: {
                NODE_ENV: 'production',
            },
            log_date_format:  'YYYY-MM-DD HH:mm:ss',
            out_file:         './logs/pm2-gsc-sync-out.log',
            error_file:       './logs/pm2-gsc-sync-error.log',
            merge_logs:       true,
            restart_delay:    10000,
            max_restarts:     5,
            autorestart:      true,
        },

        // ─── Scheduled Email Reports Worker ───
        {
            name:             'keyword-analyzer-scheduled-reports',
            script:           'src/workers/runners/scheduledReportsRunner.js',
            instances:        1,
            exec_mode:        'fork',
            watch:            false,
            max_memory_restart: '300M',
            env_production: {
                NODE_ENV: 'production',
            },
            log_date_format:  'YYYY-MM-DD HH:mm:ss',
            out_file:         './logs/pm2-scheduled-reports-out.log',
            error_file:       './logs/pm2-scheduled-reports-error.log',
            merge_logs:       true,
            restart_delay:    10000,
            max_restarts:     5,
            autorestart:      true,
        },
    ],
};
