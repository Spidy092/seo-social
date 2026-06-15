/**
 * Audit context — the bag of things every check function gets.
 *
 * @typedef {Object} AuditContext
 * @property {object} db         Postgres pool
 * @property {object} project    The seo_projects row being audited
 * @property {object} client     The seo_clients row (parent of project)
 * @property {string} domain     Convenience: client.website_url
 * @property {string} location   Project target_location or 'India' fallback
 * @property {AbortSignal} signal  Cancellation — checks bail early if aborted
 * @property {function} onProgress (delta) => void  Increment overall progress
 *
 * A check returns:
 *   { status: 'success'|'skipped'|'failed', data?: any, error?: string }
 */

module.exports = {};
