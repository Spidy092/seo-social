/**
 * Check: index.js (barrel) — registers every check file in this directory.
 * Adding a new check = drop a file in checks/ and it auto-joins audits.
 */
const fs = require('fs');
const path = require('path');

const REGISTRY = {};

for (const file of fs.readdirSync(__dirname)) {
    if (!file.endsWith('.js') || file === 'index.js') continue;
    const mod = require(path.join(__dirname, file));
    if (mod && mod.name && typeof mod.run === 'function') {
        REGISTRY[mod.name] = mod.run;
    }
}

function listCheckNames() {
    return Object.keys(REGISTRY).sort();
}

function getCheck(name) {
    return REGISTRY[name];
}

module.exports = { listCheckNames, getCheck, all: REGISTRY };
