// PM2 Ecosystem Config - Keyword Analyzer
module.exports = {
    apps: [{
        name:         'keyword-analyzer',
        script:       './src/server.js',
        instances:    2,               // 2 CPU cores — adjust to your EC2 size
        exec_mode:    'cluster',       // load-balanced cluster mode
        watch:        false,
        max_memory_restart: '500M',

        env_production: {
            NODE_ENV: 'production',
            PORT:     3000,
        },

        // Logging
        log_date_format:  'YYYY-MM-DD HH:mm:ss',
        out_file:         './logs/pm2-out.log',
        error_file:       './logs/pm2-error.log',
        merge_logs:       true,

        // Auto-restart settings
        restart_delay:    5000,
        max_restarts:     10,
        autorestart:      true,
    }],
};
