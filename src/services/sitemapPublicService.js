'use strict';

/**
 * Sitemap Public Serving Service
 *
 * DB lookup helpers used by the public /sitemap.xml, /sitemap-:id.xml,
 * /sitemap-:id.xml.gz, and /robots.txt routes. These run on every request,
 * so they use prepared/parameterised queries against the indexes defined in
 * `src/db/index.js`:
 *
 *   idx_sitemap_gen_public      — latest public generation per client
 *   idx_sitemap_saved_files_gen — files within a generation
 */

const { createLogger } = require('../utils/logger');
const log = createLogger('sitemapPublic');

/**
 * Return the latest saved sitemap generation for a client, joined with its
 * saved file rows. Returns null if no generation exists.
 *
 * @param {object} db     — pg pool wrapper (db.query)
 * @param {string} clientId
 */
async function getLatestForClient(db, clientId) {
    try {
        const genRes = await db.query(
            `SELECT g.id, g.site_url, g.site_origin, g.total_urls, g.is_index,
                    g.created_at, g.options_v2
               FROM sitemap_generations g
              WHERE g.client_id = $1
              ORDER BY g.created_at DESC
              LIMIT 1`,
            [clientId]
        );
        if (!genRes.rows.length) return null;
        const gen = genRes.rows[0];
        const filesRes = await db.query(
            `SELECT id, file_index, file_name, file_kind, xml_content, gzip_content,
                    url_count, byte_size
               FROM sitemap_saved_files
              WHERE generation_id = $1
              ORDER BY file_index ASC`,
            [gen.id]
        );
        return {
            generation: gen,
            files: filesRes.rows,
        };
    } catch (err) {
        log.error({ err: err.message, clientId }, 'getLatestForClient failed');
        return null;
    }
}

/**
 * Return one saved file by id, including the gzipped bytes when present.
 */
async function getFile(db, fileId) {
    try {
        const res = await db.query(
            `SELECT id, generation_id, client_id, agency_id, file_index, file_name,
                    file_kind, xml_content, gzip_content, url_count, byte_size
               FROM sitemap_saved_files
              WHERE id = $1
              LIMIT 1`,
            [fileId]
        );
        return res.rows[0] || null;
    } catch (err) {
        log.error({ err: err.message, fileId }, 'getFile failed');
        return null;
    }
}

/**
 * Return all saved files for a generation (used by the export endpoint).
 */
async function getSitemapFilesForGeneration(db, generationId) {
    try {
        const res = await db.query(
            `SELECT id, file_index, file_name, file_kind, xml_content, gzip_content,
                    url_count, byte_size
               FROM sitemap_saved_files
              WHERE generation_id = $1
              ORDER BY file_index ASC`,
            [generationId]
        );
        return res.rows;
    } catch (err) {
        log.error({ err: err.message, generationId }, 'getSitemapFilesForGeneration failed');
        return [];
    }
}

/**
 * Look up the original site's origin for a given client (used to build the
 * public Sitemap: directive in robots.txt).
 */
async function getClientSite(db, clientId) {
    try {
        // First try seo_clients (registered client)
        let res = await db.query(
            `SELECT website_url, name FROM seo_clients WHERE id = $1 LIMIT 1`,
            [clientId]
        );
        if (res.rows.length) return { ...res.rows[0], kind: 'registered' };
        // Fall back to anonymous (Quick-mode) clients
        res = await db.query(
            `SELECT site_url AS website_url, label AS name FROM sitemap_anon_clients WHERE id = $1 LIMIT 1`,
            [clientId]
        );
        if (res.rows.length) return { ...res.rows[0], kind: 'anonymous' };
        return null;
    } catch {
        return null;
    }
}

/**
 * Build a minimal one-URL fallback sitemap when a client has no saved
 * generation. Includes just the site root so search engines can still ping.
 */
function buildFallbackUrlsetXml(siteUrl) {
    const safeUrl = String(siteUrl || '').replace(/[\x00-\x1F]/g, '');
    const today = new Date().toISOString();
    return `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl" media="screen"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${safeUrl}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`;
}

function buildFallbackSitemapIndexXml(publicBaseUrl, siteUrl) {
    const safeBase = String(publicBaseUrl).replace(/[\x00-\x1F]/g, '');
    const today = new Date().toISOString();
    return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${safeBase}/sitemap.xml?clientId=fallback</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
</sitemapindex>`;
}

module.exports = {
    getLatestForClient,
    getFile,
    getSitemapFilesForGeneration,
    getClientSite,
    buildFallbackUrlsetXml,
    buildFallbackSitemapIndexXml,
};
