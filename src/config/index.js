module.exports = {
    // ─── Database ───
    db: {
        connectionString: process.env.DATABASE_URL,
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'keyword_analyzer',
        user: process.env.DB_USER || 'keyword_user',
        password: process.env.DB_PASSWORD || 'keyword_pass',
        max: 20,
        idleTimeoutMillis: 30000,
    },

    // ─── Redis ───
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
    },

    // ─── API Keys ───
    apis: {
        serper: { 
            key: process.env.SERPER_API_KEY, 
            dailyLimit: parseInt(process.env.SERPER_DAILY_LIMIT || '2500'),
            url: 'https://google.serper.dev/search',
        },
        googleCse: {
            key: process.env.GOOGLE_CSE_API_KEY,
            cx: process.env.GOOGLE_CSE_CX,
            dailyLimit: 100,
            url: 'https://www.googleapis.com/customsearch/v1',
        },
        openPageRank: { 
            key: process.env.OPENPAGERANK_API_KEY, 
            dailyLimit: 33000,
            url: 'https://openpagerank.com/api/v1.0/getPageRank',
        },
        openRouter: {
            key: process.env.OPENROUTER_API_KEY,
            url: 'https://openrouter.ai/api/v1/chat/completions',
            model: 'stepfun/step-3.5-flash:free',
        },
        groq: {
            key: process.env.GROQ_API_KEY,
            url: 'https://api.groq.com/openai/v1/chat/completions',
            model: 'llama-3.3-70b-versatile',
        },
    },

    // ─── Server ───
    server: {
        port: parseInt(process.env.PORT || '3000'),
        host: process.env.HOST || '0.0.0.0',
    },

    // ─── Rank Tracking ───
    rankTracking: {
        checkInterval: parseInt(process.env.CHECK_INTERVAL || '86400'),
        alertWebhook: process.env.ALERT_WEBHOOK_URL,
        webhookTimeout: parseInt(process.env.WEBHOOK_TIMEOUT || '5000'),
        rankDropThreshold: parseInt(process.env.RANK_DROP_THRESHOLD || '5'),
        rankImprovementThreshold: parseInt(process.env.RANK_IMPROVEMENT_THRESHOLD || '10'),
        rateLimitDelay: parseInt(process.env.RATE_LIMIT_DELAY || '3000'),
    },

    // ─── Search Settings ───
    search: {
        defaultLocation: 'India',
        defaultLanguage: 'en',
        maxResults: 100,
        resultsPerPage: 10,
    },
};
