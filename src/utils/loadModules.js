/**
 * Auto-discover and require all module files in a directory.
 *
 * Convention:
 *   - Files named `_*.js` or starting with `.` are skipped
 *   - Subdirectories are recursed into (returns a nested object)
 *   - Each module is expected to export either:
 *       (a) `module.exports = async function (fastify, options) { ... }`
 *       (b) `module.exports = { register: async function (fastify, options) { ... } }`
 *       (c) Any other shape — returned as-is so callers can decide
 *
 * This is used by src/index.js to auto-register all routes, and by the
 * scheduler to auto-discover all worker jobs.
 */
const fs = require('fs');
const path = require('path');

/**
 * Recursively load every .js file under `dir` and return a structured object.
 *
 *   { auth: fn, agency: fn, social: { posts: fn, platforms: fn } }
 *
 * @param {string} dir Absolute path to the directory to scan
 * @param {object} [opts]
 * @param {RegExp} [opts.skip] Filenames to skip (default: starts with `_` or `.`)
 * @param {number} [opts.maxDepth] Recursion limit (default: 5)
 * @returns {object}
 */
function loadModules(dir, opts = {}) {
    const { skip = /^[_.]/, maxDepth = 5 } = opts;

    if (!fs.existsSync(dir)) return {};

    const out = {};
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.test(entry.name)) continue;

        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (maxDepth <= 0) continue;
            const sub = loadModules(full, { ...opts, maxDepth: maxDepth - 1 });
            if (Object.keys(sub).length) {
                out[entry.name] = sub;
            }
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            const name = entry.name.replace(/\.js$/, '');
            // Skip a directory's own index.js (would clash with the namespace)
            if (name === 'index') continue;

            // Bust the require cache for hot-reload friendliness in dev
            delete require.cache[require.resolve(full)];
            try {
                out[name] = require(full);
            } catch (err) {
                // Surface the error clearly — silent failures here cause
                // 404s at runtime that are hard to trace back. We re-throw
                // after logging so the boot fails loudly.
                console.error(`[loadModules] failed to load ${full}:`, err.message);
                throw err;
            }
        }
    }
    return out;
}

/**
 * Walk an object produced by `loadModules` and call `fn(mod, keyPath)`
 * for every leaf that looks like a Fastify plugin (function or has .register).
 */
function forEachPlugin(modules, fn, prefix = '') {
    for (const [key, value] of Object.entries(modules)) {
        const keyPath = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            forEachPlugin(value, fn, keyPath);
        } else {
            fn(value, keyPath);
        }
    }
}

/**
 * Register every module under `dir` as a Fastify plugin.
 * Modules are registered in alphabetical order for predictable startup logs.
 */
async function registerAll(fastify, dir, options = {}, _baseOpts = {}) {
    const modules = loadModules(dir);
    const plugins = [];

    forEachPlugin(modules, (mod, keyPath) => {
        plugins.push({ keyPath, mod });
    });

    // Stable order: alphabetical by keyPath
    plugins.sort((a, b) => a.keyPath.localeCompare(b.keyPath));

    const registered = [];
    const failed = [];

    for (const { keyPath, mod } of plugins) {
        try {
            await fastify.register(mod, options);
            registered.push(keyPath);
        } catch (err) {
            failed.push({ keyPath, error: err.message });
        }
    }

    return { registered, failed };
}

module.exports = { loadModules, forEachPlugin, registerAll };
