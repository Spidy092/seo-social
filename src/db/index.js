const { Pool } = require('pg');
const config = require('../config');
const { createLogger } = require('../utils/logger');

const log = createLogger('database');

const pool = new Pool(config.db);

pool.on('connect', () => log.debug('new DB connection'));
pool.on('error', (err) => log.error({ err }, 'unexpected DB pool error'));

/**
 * Run a query against the database.
 */
async function query(text, params) {
    const start = Date.now();
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    log.debug({ query: text.slice(0, 80), duration, rows: result.rowCount }, 'query');
    return result;
}

/**
 * Get a client from the pool for transactions.
 */
async function getClient() {
    return pool.connect();
}

async function repairKeywordConflictIndexes() {
    log.info('repairing keyword conflict indexes...');

    await query(`
        WITH ranked AS (
            SELECT id,
                   MIN(id) OVER (PARTITION BY keyword, location) AS keep_id
            FROM keywords
        )
        UPDATE competitors c
        SET keyword_id = ranked.keep_id
        FROM ranked
        WHERE c.keyword_id = ranked.id AND ranked.id <> ranked.keep_id
    `);

    await query(`
        WITH ranked AS (
            SELECT id,
                   MIN(id) OVER (PARTITION BY keyword, location) AS keep_id
            FROM keywords
        )
        UPDATE ranking_pages rp
        SET keyword_id = ranked.keep_id
        FROM ranked
        WHERE rp.keyword_id = ranked.id AND ranked.id <> ranked.keep_id
    `);

    await query(`
        WITH ranked AS (
            SELECT id,
                   MIN(id) OVER (PARTITION BY keyword, location) AS keep_id
            FROM keywords
        )
        UPDATE domain_rankings dr
        SET keyword_id = ranked.keep_id
        FROM ranked
        WHERE dr.keyword_id = ranked.id AND ranked.id <> ranked.keep_id
    `);

    await query(`
        WITH ranked AS (
            SELECT id,
                   MIN(id) OVER (PARTITION BY keyword, location) AS keep_id
            FROM keywords
        )
        UPDATE rank_history rh
        SET keyword_id = ranked.keep_id
        FROM ranked
        WHERE rh.keyword_id = ranked.id AND ranked.id <> ranked.keep_id
    `);

    await query(`
        WITH ranked AS (
            SELECT id,
                   MIN(id) OVER (PARTITION BY keyword, location) AS keep_id
            FROM keywords
        )
        UPDATE alerts a
        SET keyword_id = ranked.keep_id
        FROM ranked
        WHERE a.keyword_id = ranked.id AND ranked.id <> ranked.keep_id
    `);

    await query(`
        WITH ranked AS (
            SELECT id,
                   MIN(id) OVER (PARTITION BY keyword, location) AS keep_id
            FROM keywords
        )
        UPDATE analysis_reports ar
        SET keyword_id = ranked.keep_id
        FROM ranked
        WHERE ar.keyword_id = ranked.id AND ranked.id <> ranked.keep_id
    `);

    await query(`
        WITH ranked AS (
            SELECT id,
                   MIN(id) OVER (PARTITION BY keyword, location) AS keep_id
            FROM keywords
        )
        UPDATE seo_project_keywords spk
        SET keyword_id = ranked.keep_id
        FROM ranked
        WHERE spk.keyword_id = ranked.id AND ranked.id <> ranked.keep_id
    `);

    await query(`
        DELETE FROM competitors a
        USING competitors b
        WHERE a.id > b.id
          AND a.domain = b.domain
          AND a.keyword_id = b.keyword_id
    `);

    await query(`
        DELETE FROM ranking_pages a
        USING ranking_pages b
        WHERE a.id > b.id
          AND a.domain = b.domain
          AND a.keyword_id = b.keyword_id
    `);

    await query(`
        DELETE FROM domain_rankings a
        USING domain_rankings b
        WHERE a.id > b.id
          AND a.domain = b.domain
          AND a.keyword_id = b.keyword_id
    `);

    await query(`
        DELETE FROM seo_project_keywords a
        USING seo_project_keywords b
        WHERE a.created_at < b.created_at
          AND a.project_id = b.project_id
          AND a.keyword_id = b.keyword_id
    `);

    await query(`
        DELETE FROM keywords k
        USING keywords keep
        WHERE k.id > keep.id
          AND k.keyword = keep.keyword
          AND k.location = keep.location
    `);

    await query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_keywords_keyword_location ON keywords(keyword, location)`);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_competitors_domain_keyword ON competitors(domain, keyword_id)`);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_ranking_pages_keyword_domain ON ranking_pages(keyword_id, domain)`);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_domain_rankings_domain_keyword ON domain_rankings(domain, keyword_id)`);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_seo_project_keywords_project_keyword ON seo_project_keywords(project_id, keyword_id)`);
}

/**
 * Initialize the database schema.
 */
async function initializeDatabase() {
    log.info('initializing database schema...');

    // ─── Keywords Table ───
    await query(`
        CREATE TABLE IF NOT EXISTS keywords (
            id SERIAL PRIMARY KEY,
            keyword VARCHAR(500) NOT NULL,
            location VARCHAR(255) DEFAULT 'India',
            search_volume INTEGER DEFAULT 0,
            competition VARCHAR(20) DEFAULT 'unknown',
            cpc DECIMAL(10,2) DEFAULT 0,
            difficulty INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(keyword, location)
        )
    `);

    // ─── Competitors Table ───
    await query(`
        CREATE TABLE IF NOT EXISTS competitors (
            id SERIAL PRIMARY KEY,
            domain VARCHAR(255) NOT NULL,
            keyword_id INTEGER REFERENCES keywords(id) ON DELETE CASCADE,
            rank_position INTEGER DEFAULT 0,
            url TEXT,
            title TEXT,
            description TEXT,
            discovered_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(domain, keyword_id)
        )
    `);

    // ─── Ranking Pages Table ───
    await query(`
        CREATE TABLE IF NOT EXISTS ranking_pages (
            id SERIAL PRIMARY KEY,
            keyword_id INTEGER REFERENCES keywords(id) ON DELETE CASCADE,
            domain VARCHAR(255) NOT NULL,
            url TEXT NOT NULL,
            rank_position INTEGER DEFAULT 0,
            title TEXT,
            description TEXT,
            word_count INTEGER DEFAULT 0,
            keyword_count INTEGER DEFAULT 0,
            keyword_density DECIMAL(5,2) DEFAULT 0,
            has_h1 BOOLEAN DEFAULT FALSE,
            has_meta_description BOOLEAN DEFAULT FALSE,
            page_speed_score INTEGER DEFAULT 0,
            backlinks INTEGER DEFAULT 0,
            domain_authority INTEGER DEFAULT 0,
            analyzed_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(keyword_id, domain)
        )
    `);

    // ─── My Domains Table ───
    await query(`
        CREATE TABLE IF NOT EXISTS my_domains (
            id SERIAL PRIMARY KEY,
            domain VARCHAR(255) NOT NULL UNIQUE,
            added_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // ─── Domain Rankings Table ───
    await query(`
        CREATE TABLE IF NOT EXISTS domain_rankings (
            id SERIAL PRIMARY KEY,
            domain VARCHAR(255) NOT NULL,
            keyword_id INTEGER REFERENCES keywords(id) ON DELETE CASCADE,
            rank_position INTEGER DEFAULT 0,
            url TEXT,
            checked_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(domain, keyword_id)
        )
    `);

    // ─── Rank History Table (for tracking changes) ───
    await query(`
        CREATE TABLE IF NOT EXISTS rank_history (
            id SERIAL PRIMARY KEY,
            domain VARCHAR(255) NOT NULL,
            keyword_id INTEGER REFERENCES keywords(id) ON DELETE CASCADE,
            rank_position INTEGER DEFAULT 0,
            previous_rank INTEGER DEFAULT 0,
            change_direction VARCHAR(10) DEFAULT 'same',
            checked_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // ─── Alerts Table ───
    await query(`
        CREATE TABLE IF NOT EXISTS alerts (
            id SERIAL PRIMARY KEY,
            domain VARCHAR(255) NOT NULL,
            keyword_id INTEGER REFERENCES keywords(id) ON DELETE CASCADE,
            alert_type VARCHAR(50) NOT NULL,
            message TEXT NOT NULL,
            old_value VARCHAR(100),
            new_value VARCHAR(100),
            is_read BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // ─── Analysis Reports Table ───
    await query(`
        CREATE TABLE IF NOT EXISTS analysis_reports (
            id SERIAL PRIMARY KEY,
            keyword_id INTEGER REFERENCES keywords(id) ON DELETE CASCADE,
            my_domain VARCHAR(255) NOT NULL,
            competitor_domain VARCHAR(255) NOT NULL,
            comparison_data JSONB,
            suggestions JSONB,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // ─── Indexes ───
    await query(`CREATE INDEX IF NOT EXISTS idx_keywords_keyword ON keywords(keyword)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_competitors_domain ON competitors(domain)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_ranking_pages_domain ON ranking_pages(domain)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_domain_rankings_domain ON domain_rankings(domain)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_rank_history_domain ON rank_history(domain)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_alerts_domain ON alerts(domain)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_alerts_read ON alerts(is_read)`);

    // ─── Social Media & Auth Tables (Merged from post-mutiple) ───
    await query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await query(`
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS platform_connections (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            platform TEXT NOT NULL,
            access_token TEXT NOT NULL,
            refresh_token TEXT,
            token_expires_at TIMESTAMPTZ,
            platform_user_id TEXT,
            platform_username TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(user_id, platform)
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS posts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            media_url TEXT NOT NULL,
            media_type TEXT NOT NULL,
            caption_original TEXT,
            platforms JSONB NOT NULL,
            scheduled_at TIMESTAMPTZ,
            status TEXT DEFAULT 'draft',
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS post_results (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
            platform TEXT NOT NULL,
            status TEXT NOT NULL,
            platform_post_id TEXT,
            error_message TEXT,
            posted_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS analytics_snapshots (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            post_result_id UUID REFERENCES post_results(id) ON DELETE CASCADE,
            likes INT DEFAULT 0,
            comments INT DEFAULT 0,
            shares INT DEFAULT 0,
            views INT DEFAULT 0,
            reach INT DEFAULT 0,
            snapped_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS content_rewrite_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            input_text TEXT NOT NULL,
            output_text TEXT NOT NULL,
            mode TEXT DEFAULT 'standard',
            primary_keyword TEXT,
            related_keywords JSONB DEFAULT '[]'::jsonb,
            tone TEXT DEFAULT 'natural',
            audience TEXT,
            brand_voice TEXT,
            preserve_keywords JSONB DEFAULT '[]'::jsonb,
            preserve_html BOOLEAN DEFAULT FALSE,
            max_change TEXT DEFAULT 'balanced',
            summary TEXT,
            verification JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS seo_clients (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            website_url TEXT,
            industry TEXT,
            target_locations JSONB DEFAULT '[]'::jsonb,
            competitors JSONB DEFAULT '[]'::jsonb,
            audience TEXT,
            services JSONB DEFAULT '[]'::jsonb,
            goals TEXT,
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS seo_projects (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            client_id UUID REFERENCES seo_clients(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            project_type TEXT DEFAULT 'keyword-research',
            target_location TEXT,
            goals TEXT,
            status TEXT DEFAULT 'active',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS seo_project_keywords (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id UUID REFERENCES seo_projects(id) ON DELETE CASCADE,
            keyword_id INTEGER REFERENCES keywords(id) ON DELETE CASCADE,
            intent TEXT,
            priority_score INTEGER DEFAULT 0,
            notes TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(project_id, keyword_id)
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS technical_audits (
            id SERIAL PRIMARY KEY,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            site_url TEXT NOT NULL,
            status VARCHAR(30) DEFAULT 'completed',
            pages_crawled INTEGER DEFAULT 0,
            overall_score INTEGER DEFAULT 0,
            summary JSONB DEFAULT '{}'::jsonb,
            issues JSONB DEFAULT '[]'::jsonb,
            pages JSONB DEFAULT '[]'::jsonb,
            robots_txt JSONB DEFAULT '{}'::jsonb,
            sitemaps JSONB DEFAULT '[]'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS page_optimizations (
            id SERIAL PRIMARY KEY,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            url TEXT NOT NULL,
            keyword TEXT NOT NULL,
            location TEXT DEFAULT 'India',
            my_score INTEGER DEFAULT 0,
            avg_competitor_score INTEGER DEFAULT 0,
            gaps JSONB DEFAULT '[]'::jsonb,
            my_data JSONB DEFAULT '{}'::jsonb,
            competitors JSONB DEFAULT '[]'::jsonb,
            summary JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS content_briefs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            project_id UUID REFERENCES seo_projects(id) ON DELETE SET NULL,
            keyword TEXT NOT NULL,
            location TEXT DEFAULT 'India',
            brief JSONB NOT NULL,
            source_metrics JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`ALTER TABLE content_rewrite_history ADD COLUMN IF NOT EXISTS primary_keyword TEXT`);
    await query(`ALTER TABLE content_rewrite_history ADD COLUMN IF NOT EXISTS related_keywords JSONB DEFAULT '[]'::jsonb`);


    await query(`CREATE INDEX IF NOT EXISTS idx_content_rewrite_history_user_created ON content_rewrite_history(user_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_content_briefs_user_created ON content_briefs(user_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_content_briefs_project_created ON content_briefs(project_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_technical_audits_site_created ON technical_audits(site_url, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_technical_audits_user_created ON technical_audits(user_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_seo_clients_user_created ON seo_clients(user_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_seo_projects_client_created ON seo_projects(client_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_seo_project_keywords_project ON seo_project_keywords(project_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_page_optimizations_user_created ON page_optimizations(user_id, created_at DESC)`);

    // ─── SEO Reports Table ───
    await query(`
        CREATE TABLE IF NOT EXISTS seo_reports (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            client_name TEXT,
            domain TEXT,
            period_days INTEGER DEFAULT 30,
            report_data JSONB NOT NULL,
            generated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_seo_reports_generated ON seo_reports(generated_at DESC)`);

    // ─── SEO Tasks Table ───
    await query(`
        CREATE TABLE IF NOT EXISTS seo_tasks (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            client_id UUID REFERENCES seo_clients(id) ON DELETE CASCADE,
            project_id UUID REFERENCES seo_projects(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            description TEXT,
            category TEXT DEFAULT 'general',
            impact TEXT DEFAULT 'medium',
            effort TEXT DEFAULT 'medium',
            priority TEXT DEFAULT 'medium',
            status TEXT DEFAULT 'todo',
            ai_notes JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await query(`ALTER TABLE seo_tasks ADD COLUMN IF NOT EXISTS ai_notes JSONB DEFAULT '{}'::jsonb`);
    await query(`CREATE INDEX IF NOT EXISTS idx_seo_tasks_project ON seo_tasks(project_id, status)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_seo_tasks_user ON seo_tasks(user_id, status)`);

    await repairKeywordConflictIndexes();

    log.info('✅ database schema initialized');
}

module.exports = {
    query,
    getClient,
    initializeDatabase,
    pool,
};
