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
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_seo_project_keywords_project_keyword ON seo_project_keywords(project_id, keyword_id)`);
}

async function ensureAgencyForeignKeys() {
    const tables = [
        'agency_members', 'agency_invites', 'seo_clients', 'seo_tasks', 'technical_audits',
        'page_optimizations', 'page_speed_checks', 'content_briefs', 'content_rewrite_history',
        'posts', 'platform_connections', 'seo_reports', 'gsc_search_analytics', 'gsc_sync_runs',
        'ga4_page_analytics', 'ga4_sync_runs', 'indexing_actions', 'my_domains'
    ];

    for (const table of tables) {
        const columnCheck = await query(
            `SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'agency_id'`,
            [table]
        );
        if (!columnCheck.rows.length) continue;

        const constraints = await query(
            `SELECT c.conname, c.confdeltype
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
             WHERE t.relname = $1 AND a.attname = 'agency_id' AND c.contype = 'f'`,
            [table]
        );

        for (const row of constraints.rows) {
            if (row.confdeltype !== 'n') {
                await query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${row.conname}`);
            }
        }

        const remaining = await query(
            `SELECT 1
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
             WHERE t.relname = $1 AND a.attname = 'agency_id' AND c.contype = 'f' AND c.confdeltype = 'n'
             LIMIT 1`,
            [table]
        );

        if (!remaining.rows.length) {
            await query(
                `ALTER TABLE ${table}
                 ADD CONSTRAINT fk_${table}_agency_id
                 FOREIGN KEY (agency_id) REFERENCES agencies(id) ON DELETE SET NULL`
            );
        }
    }
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
            agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
            domain VARCHAR(255) NOT NULL,
            added_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(agency_id, domain)
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

    // ─── Agencies Table ───
    await query(`
        CREATE TABLE IF NOT EXISTS agencies (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            created_by UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // ─── Agency Members Table (links users to agencies with roles) ───
    await query(`
        CREATE TABLE IF NOT EXISTS agency_members (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL DEFAULT 'agent',
            invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
            joined_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(agency_id, user_id)
        )
    `);

    // ─── Agency Invites Table ───
    await query(`
        CREATE TABLE IF NOT EXISTS agency_invites (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
            email TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'agent',
            token TEXT UNIQUE NOT NULL,
            invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
            accepted BOOLEAN DEFAULT FALSE,
            expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`CREATE INDEX IF NOT EXISTS idx_agency_members_user ON agency_members(user_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_agency_members_agency ON agency_members(agency_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_agency_invites_token ON agency_invites(token)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_agency_invites_email ON agency_invites(email)`);



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
        CREATE TABLE IF NOT EXISTS onpage_audits (
            id SERIAL PRIMARY KEY,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            project_id UUID REFERENCES seo_projects(id) ON DELETE CASCADE,
            url TEXT NOT NULL,
            keyword TEXT,
            overall_score INTEGER DEFAULT 0,
            summary JSONB DEFAULT '{}'::jsonb,
            issues JSONB DEFAULT '[]'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW()
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
        CREATE TABLE IF NOT EXISTS page_speed_checks (
            id SERIAL PRIMARY KEY,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            client_id UUID REFERENCES seo_clients(id) ON DELETE SET NULL,
            url TEXT NOT NULL,
            final_url TEXT,
            strategy TEXT DEFAULT 'mobile',
            performance_score INTEGER,
            accessibility_score INTEGER,
            best_practices_score INTEGER,
            seo_score INTEGER,
            result JSONB NOT NULL,
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

    await query(`
        CREATE TABLE IF NOT EXISTS gsc_search_analytics (
            id SERIAL PRIMARY KEY,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            client_id UUID REFERENCES seo_clients(id) ON DELETE CASCADE,
            site_url TEXT NOT NULL,
            date_start DATE NOT NULL,
            date_end DATE NOT NULL,
            dimension_type TEXT NOT NULL,
            query TEXT,
            page TEXT,
            device TEXT,
            country TEXT,
            clicks INTEGER DEFAULT 0,
            impressions INTEGER DEFAULT 0,
            ctr DECIMAL(12,6) DEFAULT 0,
            position DECIMAL(12,4) DEFAULT 0,
            raw JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);


    await query(`
        CREATE TABLE IF NOT EXISTS gsc_sync_runs (
            id SERIAL PRIMARY KEY,
            user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            client_id UUID REFERENCES seo_clients(id) ON DELETE CASCADE,
            site_url TEXT,
            sync_type TEXT NOT NULL DEFAULT 'manual',
            status TEXT NOT NULL,
            rows_synced INTEGER DEFAULT 0,
            date_start DATE,
            date_end DATE,
            error_message TEXT,
            started_at TIMESTAMPTZ DEFAULT NOW(),
            finished_at TIMESTAMPTZ DEFAULT NOW(),
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);


    await query(`
        CREATE TABLE IF NOT EXISTS ga4_page_analytics (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
            client_id UUID REFERENCES seo_clients(id) ON DELETE CASCADE,
            property_id TEXT NOT NULL,
            date_start DATE NOT NULL,
            date_end DATE NOT NULL,
            page_path TEXT,
            page_url TEXT,
            normalized_url TEXT,
            landing_page TEXT,
            source_medium TEXT,
            channel_group TEXT,
            device_category TEXT,
            country TEXT,
            city TEXT,
            sessions INTEGER DEFAULT 0,
            users INTEGER DEFAULT 0,
            new_users INTEGER DEFAULT 0,
            views INTEGER DEFAULT 0,
            bounce_rate NUMERIC DEFAULT 0,
            engagement_rate NUMERIC DEFAULT 0,
            avg_session_duration NUMERIC DEFAULT 0,
            conversions NUMERIC DEFAULT 0,
            event_count INTEGER DEFAULT 0,
            revenue NUMERIC DEFAULT 0,
            raw JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS ga4_sync_runs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
            client_id UUID REFERENCES seo_clients(id) ON DELETE CASCADE,
            property_id TEXT,
            sync_type TEXT NOT NULL DEFAULT 'manual',
            status TEXT NOT NULL,
            rows_synced INTEGER DEFAULT 0,
            date_start DATE,
            date_end DATE,
            error_message TEXT,
            started_at TIMESTAMPTZ DEFAULT NOW(),
            finished_at TIMESTAMPTZ DEFAULT NOW(),
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`ALTER TABLE my_domains ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL`);
    await query(`ALTER TABLE my_domains DROP CONSTRAINT IF EXISTS my_domains_domain_key`);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_my_domains_agency_domain ON my_domains(agency_id, domain)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_my_domains_agency ON my_domains(agency_id)`);

    await query(`ALTER TABLE seo_projects ADD COLUMN IF NOT EXISTS tracking_domain TEXT`);

    await query(`ALTER TABLE domain_rankings ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL`);
    await query(`ALTER TABLE domain_rankings ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES seo_clients(id) ON DELETE CASCADE`);
    await query(`ALTER TABLE domain_rankings ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES seo_projects(id) ON DELETE CASCADE`);
    await query(`ALTER TABLE domain_rankings DROP CONSTRAINT IF EXISTS domain_rankings_domain_keyword_key`);
    await query(`DROP INDEX IF EXISTS uniq_domain_rankings_domain_keyword`);
    await query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_domain_rankings_project_keyword ON domain_rankings(project_id, keyword_id) WHERE project_id IS NOT NULL`);
    await query(`CREATE INDEX IF NOT EXISTS idx_domain_rankings_project ON domain_rankings(project_id, checked_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_domain_rankings_agency ON domain_rankings(agency_id, domain)`);

    await query(`ALTER TABLE rank_history ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL`);
    await query(`ALTER TABLE rank_history ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES seo_clients(id) ON DELETE CASCADE`);
    await query(`ALTER TABLE rank_history ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES seo_projects(id) ON DELETE CASCADE`);
    await query(`CREATE INDEX IF NOT EXISTS idx_rank_history_project ON rank_history(project_id, checked_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_rank_history_agency ON rank_history(agency_id, domain, checked_at DESC)`);

    await query(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL`);
    await query(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES seo_clients(id) ON DELETE CASCADE`);
    await query(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES seo_projects(id) ON DELETE CASCADE`);
    await query(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'medium'`);
    await query(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb`);
    await query(`CREATE INDEX IF NOT EXISTS idx_alerts_project_created ON alerts(project_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_alerts_agency_unread ON alerts(agency_id, is_read, created_at DESC)`);

    await query(`ALTER TABLE seo_clients ADD COLUMN IF NOT EXISTS gsc_site_url TEXT`);
    await query(`ALTER TABLE seo_clients ADD COLUMN IF NOT EXISTS ga4_property_id TEXT`);
    await query(`ALTER TABLE seo_clients ADD COLUMN IF NOT EXISTS ga4_property_name TEXT`);
    await query(`ALTER TABLE seo_clients ADD COLUMN IF NOT EXISTS ga4_connected_at TIMESTAMPTZ`);
    await query(`ALTER TABLE seo_clients ADD COLUMN IF NOT EXISTS ga4_last_synced_at TIMESTAMPTZ`);
    await query(`ALTER TABLE seo_clients ADD COLUMN IF NOT EXISTS indexnow_key TEXT`);
    await query(`ALTER TABLE seo_clients ADD COLUMN IF NOT EXISTS indexnow_key_location TEXT`);
    await query(`ALTER TABLE seo_clients ADD COLUMN IF NOT EXISTS indexnow_connected_at TIMESTAMPTZ`);
    await query(`ALTER TABLE gsc_search_analytics ADD COLUMN IF NOT EXISTS normalized_url TEXT`);

    await query(`
        CREATE TABLE IF NOT EXISTS indexing_actions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
            client_id UUID REFERENCES seo_clients(id) ON DELETE CASCADE,
            provider TEXT NOT NULL,
            action_type TEXT NOT NULL,
            status TEXT NOT NULL,
            url TEXT,
            normalized_url TEXT,
            site_url TEXT,
            sitemap_url TEXT,
            page_type TEXT,
            request_payload JSONB DEFAULT '{}'::jsonb,
            response_payload JSONB DEFAULT '{}'::jsonb,
            recommendations JSONB DEFAULT '[]'::jsonb,
            error_message TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await query(`ALTER TABLE content_rewrite_history ADD COLUMN IF NOT EXISTS primary_keyword TEXT`);
    await query(`ALTER TABLE content_rewrite_history ADD COLUMN IF NOT EXISTS related_keywords JSONB DEFAULT '[]'::jsonb`);


    await query(`CREATE INDEX IF NOT EXISTS idx_content_rewrite_history_user_created ON content_rewrite_history(user_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_content_briefs_user_created ON content_briefs(user_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_content_briefs_project_created ON content_briefs(project_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_gsc_search_analytics_client_date ON gsc_search_analytics(client_id, date_start, date_end)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_gsc_search_analytics_client_dimension ON gsc_search_analytics(client_id, dimension_type, impressions DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_gsc_sync_runs_client_created ON gsc_sync_runs(client_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_gsc_sync_runs_user_created ON gsc_sync_runs(user_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_gsc_search_analytics_normalized_url ON gsc_search_analytics(client_id, normalized_url)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_ga4_page_analytics_client ON ga4_page_analytics(client_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_ga4_page_analytics_window ON ga4_page_analytics(client_id, date_start, date_end)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_ga4_page_analytics_url ON ga4_page_analytics(client_id, normalized_url)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_ga4_page_analytics_source ON ga4_page_analytics(client_id, source_medium, channel_group)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_ga4_sync_runs_client ON ga4_sync_runs(client_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_ga4_sync_runs_created ON ga4_sync_runs(created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_indexing_actions_client ON indexing_actions(client_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_indexing_actions_agency ON indexing_actions(agency_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_indexing_actions_created ON indexing_actions(created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_indexing_actions_url ON indexing_actions(client_id, normalized_url)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_indexing_actions_provider ON indexing_actions(client_id, provider, action_type)`);

    await query(`CREATE INDEX IF NOT EXISTS idx_technical_audits_site_created ON technical_audits(site_url, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_technical_audits_user_created ON technical_audits(user_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_seo_clients_user_created ON seo_clients(user_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_seo_projects_client_created ON seo_projects(client_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_seo_project_keywords_project ON seo_project_keywords(project_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_page_optimizations_user_created ON page_optimizations(user_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_page_speed_checks_client_created ON page_speed_checks(client_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_page_speed_checks_url_created ON page_speed_checks(url, created_at DESC)`);

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

    // ─── Add onboarding_dismissed to agencies ───
    await query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS onboarding_dismissed BOOLEAN DEFAULT FALSE`);

    // ─── Add agency_id to seo_clients (migration-safe) ───
    await query(`ALTER TABLE seo_clients ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL`);
    await query(`CREATE INDEX IF NOT EXISTS idx_seo_clients_agency ON seo_clients(agency_id)`);

    // ─── Add agency_id to seo_tasks ───
    await query(`ALTER TABLE seo_tasks ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL`);
    await query(`CREATE INDEX IF NOT EXISTS idx_seo_tasks_agency ON seo_tasks(agency_id)`);

    // ─── Add assigned_to for client/task assignment to specific members ───
    await query(`ALTER TABLE seo_clients ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL`);
    await query(`ALTER TABLE seo_tasks ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL`);
    await query(`CREATE INDEX IF NOT EXISTS idx_seo_clients_assigned ON seo_clients(assigned_to)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_seo_tasks_assigned ON seo_tasks(assigned_to)`);

    // ─── Add agency_id to technical_audits ───
    await query(`ALTER TABLE technical_audits ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL`);

    // ─── Add agency_id to page_optimizations ───
    await query(`ALTER TABLE page_optimizations ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL`);

    // ─── Add agency_id to page_speed_checks ───
    await query(`ALTER TABLE page_speed_checks ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL`);

    // ─── Add agency_id to content_briefs ───
    await query(`ALTER TABLE content_briefs ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL`);

    // ─── Add agency_id to content_rewrite_history ───
    await query(`ALTER TABLE content_rewrite_history ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL`);
    await query(`ALTER TABLE content_rewrite_history ADD COLUMN IF NOT EXISTS sample TEXT`);

    // ─── Add agency_id to posts ───
    await query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL`);

    // ─── Add agency_id to platform_connections ───
    await query(`ALTER TABLE platform_connections ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL`);

    // ─── Add agency_id to seo_reports ───
    await query(`ALTER TABLE seo_reports ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL`);

    // ─── Add agency_id to gsc tables ───
    await query(`ALTER TABLE gsc_search_analytics ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL`);
    await query(`ALTER TABLE gsc_sync_runs ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL`);

    await ensureAgencyForeignKeys();

    // ─── Scheduled Email Reports ───
    await query(`
        CREATE TABLE IF NOT EXISTS scheduled_reports (
            id SERIAL PRIMARY KEY,
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
            client_id UUID REFERENCES seo_clients(id) ON DELETE SET NULL,
            domain TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT 'Monthly SEO Report',
            recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
            frequency TEXT NOT NULL DEFAULT 'monthly',
            day_of_week INTEGER DEFAULT 1,
            day_of_month INTEGER DEFAULT 1,
            hour INTEGER DEFAULT 8,
            report_options JSONB DEFAULT '{}'::jsonb,
            is_active BOOLEAN DEFAULT TRUE,
            last_sent_at TIMESTAMPTZ,
            next_run_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_scheduled_reports_active ON scheduled_reports(is_active, next_run_at)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_scheduled_reports_agency ON scheduled_reports(agency_id)`);

    // ─── Project Audits (full SEO audit per project) ───
    // One row per audit run. status moves pending → running → (success|failed|partial).
    // progress is 0-100. results is a JSONB blob with per-check output.
    // summary holds the AI-generated prioritized action items.
    await query(`
        CREATE TABLE IF NOT EXISTS project_audits (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id UUID REFERENCES seo_projects(id) ON DELETE CASCADE,
            client_id UUID REFERENCES seo_clients(id) ON DELETE CASCADE,
            user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
            trigger_source TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'auto-on-create' | 'scheduled' | 'api'
            status TEXT NOT NULL DEFAULT 'pending',          -- 'pending' | 'running' | 'success' | 'failed' | 'partial' | 'cancelled'
            progress INTEGER NOT NULL DEFAULT 0,             -- 0..100
            checks_total INTEGER NOT NULL DEFAULT 0,
            checks_done INTEGER NOT NULL DEFAULT 0,
            checks_failed INTEGER NOT NULL DEFAULT 0,
            requested_checks JSONB NOT NULL DEFAULT '[]'::jsonb, -- snapshot of which checks were requested
            results JSONB NOT NULL DEFAULT '{}'::jsonb,      -- per-check { name: { status, startedAt, finishedAt, data, error } }
            summary JSONB NOT NULL DEFAULT '{}'::jsonb,      -- { score, topIssues, actions, headline }
            error_message TEXT,
            started_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ,
            cancelled_at TIMESTAMPTZ,
            cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_project_audits_project ON project_audits(project_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_project_audits_status ON project_audits(status, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_project_audits_agency ON project_audits(agency_id, created_at DESC)`);

    // ─── Per-project audit settings ───
    // One row per project. Anything unset falls back to global defaults
    // (see audit_settings_global below).
    await query(`
        CREATE TABLE IF NOT EXISTS project_audit_settings (
            project_id UUID PRIMARY KEY REFERENCES seo_projects(id) ON DELETE CASCADE,
            enabled_checks JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [] = inherit global; ['technical','onpage'] = override
            auto_audit_on_create BOOLEAN,                         -- NULL = inherit global default
            weekly_enabled BOOLEAN,                               -- NULL = inherit global
            weekly_day_of_week INTEGER,                           -- 0..6, NULL = inherit
            weekly_hour INTEGER,                                  -- 0..23, NULL = inherit
            monthly_enabled BOOLEAN,                              -- NULL = inherit
            monthly_day_of_month INTEGER,                         -- 1..28, NULL = inherit
            custom_keywords JSONB DEFAULT '[]'::jsonb,            -- extra keywords to include in keyword check
            custom_urls JSONB DEFAULT '[]'::jsonb,                -- extra URLs to include in on-page check
            notify_on_complete BOOLEAN NOT NULL DEFAULT FALSE,
            notify_emails JSONB DEFAULT '[]'::jsonb,
            notify_webhook TEXT,
            max_checks_concurrency INTEGER,                      -- NULL = inherit global
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // ─── Global audit settings (single row, id=1) ───
    // Master switch + defaults that all projects inherit from.
    await query(`
        CREATE TABLE IF NOT EXISTS audit_settings_global (
            id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
            enabled BOOLEAN NOT NULL DEFAULT TRUE,                -- master switch
            default_checks JSONB NOT NULL DEFAULT '[]'::jsonb,   -- default list of checks; [] = run all
            auto_audit_on_create BOOLEAN NOT NULL DEFAULT TRUE,
            weekly_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            weekly_day_of_week INTEGER NOT NULL DEFAULT 0,        -- 0=Sun
            weekly_hour INTEGER NOT NULL DEFAULT 2,
            monthly_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            monthly_day_of_month INTEGER NOT NULL DEFAULT 1,
            max_concurrent_audits INTEGER NOT NULL DEFAULT 2,
            poll_interval_ms INTEGER NOT NULL DEFAULT 30000,
            notify_on_complete BOOLEAN NOT NULL DEFAULT FALSE,
            notify_webhook TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    // Seed the single global row if missing
    await query(`
        INSERT INTO audit_settings_global (id) VALUES (1)
        ON CONFLICT (id) DO NOTHING
    `);

    // ─── Ranked Keywords cache config ───
    // 6 hours by default; admin can override via audit_settings_global.
    await query(`ALTER TABLE audit_settings_global ADD COLUMN IF NOT EXISTS ranked_kw_cache_hours INTEGER NOT NULL DEFAULT 6`);

    // ─── Ranked Keyword Snapshots ───
    // Cached result of "what keywords does this URL/domain rank for right now",
    // keyed by (project_id, target_url, location). TTL controlled by
    // audit_settings_global.ranked_kw_cache_hours. Location is part of the
    // key because the same URL ranked from different cities/countries can
    // surface different keywords (e.g. local SERP variation).
    await query(`
        CREATE TABLE IF NOT EXISTS ranked_keyword_snapshots (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id  UUID REFERENCES seo_projects(id) ON DELETE CASCADE,
            client_id   UUID REFERENCES seo_clients(id)  ON DELETE CASCADE,
            agency_id   UUID REFERENCES agencies(id)    ON DELETE SET NULL,
            target_url  TEXT NOT NULL,
            source      TEXT NOT NULL,
            count       INTEGER NOT NULL DEFAULT 0,
            payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
            location    TEXT,
            checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at  TIMESTAMPTZ NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await query(`ALTER TABLE ranked_keyword_snapshots ADD COLUMN IF NOT EXISTS location TEXT`);
    await query(`CREATE INDEX IF NOT EXISTS idx_ranked_kw_snap_lookup ON ranked_keyword_snapshots(project_id, target_url, location, expires_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_ranked_kw_snap_client ON ranked_keyword_snapshots(client_id, checked_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_ranked_kw_snap_agency ON ranked_keyword_snapshots(agency_id, checked_at DESC)`);


    // ─── Sitemap Generator History ───
    await query(`
        CREATE TABLE IF NOT EXISTS sitemap_generations (
            id          SERIAL PRIMARY KEY,
            user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
            agency_id   UUID REFERENCES agencies(id) ON DELETE SET NULL,
            client_id   UUID REFERENCES seo_clients(id) ON DELETE SET NULL,
            site_url    TEXT NOT NULL,
            total_urls  INTEGER DEFAULT 0,
            xml_content TEXT,
            options     JSONB DEFAULT '{}'::jsonb,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_sitemap_gen_client ON sitemap_generations(client_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_sitemap_gen_agency ON sitemap_generations(agency_id, created_at DESC)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_sitemap_gen_user ON sitemap_generations(user_id, created_at DESC)`);

    // Anonymous (Quick-mode) sitemap records — keyed by an anonymous client
    await query(`
        CREATE TABLE IF NOT EXISTS sitemap_anon_clients (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            owner_token TEXT NOT NULL UNIQUE,    -- random per-browser token; used to scope Quick results
            site_url    TEXT NOT NULL,
            label       TEXT,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_used   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_sitemap_anon_clients_token ON sitemap_anon_clients(owner_token, last_used DESC)`);
    // Allow sitemap_generations.client_id to reference the anon table too
    await query(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'sitemap_generations_client_id_fkey'
            ) THEN
                ALTER TABLE sitemap_generations
                  ADD CONSTRAINT sitemap_generations_client_id_fkey
                  FOREIGN KEY (client_id) REFERENCES seo_clients(id) ON DELETE SET NULL;
            END IF;
        END $$;
    `);
    await query(`
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'fk_sitemap_gen_anon_client'
            ) THEN
                ALTER TABLE sitemap_generations
                  ADD CONSTRAINT fk_sitemap_gen_anon_client
                  FOREIGN KEY (client_id) REFERENCES sitemap_anon_clients(id) ON DELETE SET NULL;
            END IF;
        END $$;
    `);

    // Pro feature columns on sitemap_generations (idempotent)
    await query(`ALTER TABLE sitemap_generations ADD COLUMN IF NOT EXISTS is_index BOOLEAN DEFAULT FALSE`);
    await query(`ALTER TABLE sitemap_generations ADD COLUMN IF NOT EXISTS sitemap_url TEXT`);
    await query(`ALTER TABLE sitemap_generations ADD COLUMN IF NOT EXISTS robots_txt TEXT`);
    await query(`ALTER TABLE sitemap_generations ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE`);
    await query(`ALTER TABLE sitemap_generations ADD COLUMN IF NOT EXISTS site_origin TEXT`);
    await query(`ALTER TABLE sitemap_generations ADD COLUMN IF NOT EXISTS total_pages INTEGER DEFAULT 0`);
    await query(`ALTER TABLE sitemap_generations ADD COLUMN IF NOT EXISTS broken_count INTEGER DEFAULT 0`);
    await query(`ALTER TABLE sitemap_generations ADD COLUMN IF NOT EXISTS redirect_count INTEGER DEFAULT 0`);
    await query(`ALTER TABLE sitemap_generations ADD COLUMN IF NOT EXISTS orphan_count INTEGER DEFAULT 0`);
    await query(`ALTER TABLE sitemap_generations ADD COLUMN IF NOT EXISTS duplicate_count INTEGER DEFAULT 0`);
    await query(`ALTER TABLE sitemap_generations ADD COLUMN IF NOT EXISTS options_v2 JSONB DEFAULT '{}'::jsonb`);
    await query(`CREATE INDEX IF NOT EXISTS idx_sitemap_gen_public ON sitemap_generations(client_id, is_public, created_at DESC) WHERE is_public = TRUE`);

    // Per-file XML storage for split sitemaps + public serving
    await query(`
        CREATE TABLE IF NOT EXISTS sitemap_saved_files (
            id              SERIAL PRIMARY KEY,
            generation_id   INTEGER NOT NULL REFERENCES sitemap_generations(id) ON DELETE CASCADE,
            agency_id       UUID REFERENCES agencies(id) ON DELETE SET NULL,
            client_id       UUID REFERENCES seo_clients(id) ON DELETE SET NULL,
            file_index      INTEGER NOT NULL,
            file_name       TEXT NOT NULL,
            file_kind       TEXT NOT NULL DEFAULT 'urlset',
            xml_content     TEXT NOT NULL,
            gzip_content    BYTEA,
            url_count       INTEGER NOT NULL DEFAULT 0,
            byte_size       INTEGER NOT NULL DEFAULT 0,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_sitemap_saved_files_gen ON sitemap_saved_files(generation_id, file_index)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_sitemap_saved_files_client ON sitemap_saved_files(client_id, created_at DESC)`);

    // Per-page metadata for reports
    await query(`
        CREATE TABLE IF NOT EXISTS sitemap_crawl_details (
            id              SERIAL PRIMARY KEY,
            generation_id   INTEGER NOT NULL REFERENCES sitemap_generations(id) ON DELETE CASCADE,
            client_id       UUID REFERENCES seo_clients(id) ON DELETE SET NULL,
            url             TEXT NOT NULL,
            canonical       TEXT,
            status          INTEGER,
            content_type    TEXT,
            content_length  INTEGER,
            response_time_ms INTEGER,
            redirect_chain  JSONB DEFAULT '[]'::jsonb,
            internal_link_count INTEGER DEFAULT 0,
            external_link_count INTEGER DEFAULT 0,
            in_degree       INTEGER DEFAULT 0,
            is_orphan       BOOLEAN DEFAULT FALSE,
            is_duplicate    BOOLEAN DEFAULT FALSE,
            duplicate_group TEXT,
            content_hash    TEXT,
            title           TEXT,
            h1              TEXT,
            lastmod         TIMESTAMPTZ,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_sitemap_crawl_details_gen ON sitemap_crawl_details(generation_id)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_sitemap_crawl_details_status ON sitemap_crawl_details(generation_id, status)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_sitemap_crawl_details_orphan ON sitemap_crawl_details(generation_id, is_orphan) WHERE is_orphan = TRUE`);
    await query(`CREATE INDEX IF NOT EXISTS idx_sitemap_crawl_details_duplicate ON sitemap_crawl_details(generation_id, duplicate_group) WHERE is_duplicate = TRUE`);

    // URL include/exclude filters per client
    await query(`
        CREATE TABLE IF NOT EXISTS sitemap_url_filters (
            id              SERIAL PRIMARY KEY,
            client_id       UUID NOT NULL REFERENCES seo_clients(id) ON DELETE CASCADE,
            agency_id       UUID REFERENCES agencies(id) ON DELETE SET NULL,
            include_pattern TEXT[] DEFAULT '{}',
            exclude_pattern TEXT[] DEFAULT '{}',
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(client_id)
        )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_sitemap_url_filters_client ON sitemap_url_filters(client_id)`);

    log.info('✅ database schema initialized');
}

module.exports = {
    query,
    getClient,
    initializeDatabase,
    repairKeywordConflictIndexes,
    pool,
};
