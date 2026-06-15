// PM2 Ecosystem Config - Keyword Analyzer
//
// Workers run as separate PM2 processes so a crash in one does not bring
// down the API server. Every worker now uses the single generic entry
// point `src/workers/runner.js <job-name>` — see src/workers/registry.js
// for the list of available jobs.

const WORKER = 'src/workers/runner.js';

function makeWorkerApp(name, jobName, memLimit = '300M') {
    return {
        name:             `keyword-analyzer-${name}`,
        script:           WORKER,
        args:             jobName,
        instances:        1,
        exec_mode:        'fork',
        watch:            false,
        max_memory_restart: memLimit,
        env_production: { NODE_ENV: 'production' },
        log_date_format:  'YYYY-MM-DD HH:mm:ss',
        out_file:         `./logs/pm2-${name}-out.log`,
        error_file:       `./logs/pm2-${name}-error.log`,
        merge_logs:       true,
        restart_delay:    10000,
        max_restarts:     5,
        autorestart:      true,
    };
}

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

        // ─── Worker processes (one PM2 app per job) ───
        makeWorkerApp('rank-tracker',     'rank-tracker',     '300M'),
        makeWorkerApp('post-scheduler',   'post-scheduler',   '200M'),
        makeWorkerApp('gsc-sync',         'gsc-sync',         '200M'),
        makeWorkerApp('ga4-sync',         'ga4-sync',         '200M'),
        makeWorkerApp('scheduled-reports','scheduled-reports','300M'),
        makeWorkerApp('analytics-sync',   'analytics-sync',   '200M'),
    ],
};
