const { createLogger } = require('./logger');

const log = createLogger('key-quota');

/**
 * Per-key daily quota tracker for API keys.
 * Tracks usage count per key per day and resets at midnight UTC.
 */
class KeyQuotaTracker {
    constructor(dailyLimit) {
        this.dailyLimit = dailyLimit;
        this.counts = new Map(); // key -> { count, date }
    }

    _today() {
        return new Date().toISOString().slice(0, 10);
    }

    _getEntry(key) {
        const entry = this.counts.get(key);
        const today = this._today();
        if (!entry || entry.date !== today) {
            const fresh = { count: 0, date: today };
            this.counts.set(key, fresh);
            return fresh;
        }
        return entry;
    }

    /**
     * Check if a key has remaining quota.
     */
    hasQuota(key) {
        if (!this.dailyLimit || this.dailyLimit <= 0) return true;
        const entry = this._getEntry(key);
        return entry.count < this.dailyLimit;
    }

    /**
     * Record one usage of a key.
     */
    recordUsage(key) {
        const entry = this._getEntry(key);
        entry.count++;
    }

    /**
     * Get remaining quota for a key.
     */
    remaining(key) {
        if (!this.dailyLimit || this.dailyLimit <= 0) return Infinity;
        const entry = this._getEntry(key);
        return Math.max(0, this.dailyLimit - entry.count);
    }

    /**
     * Get the first key from a list that has remaining quota.
     * Returns { key, index } or null if all exhausted.
     */
    getAvailableKey(keys) {
        for (let i = 0; i < keys.length; i++) {
            if (this.hasQuota(keys[i])) {
                return { key: keys[i], index: i };
            }
        }
        return null;
    }

    /**
     * Get usage stats for all keys.
     */
    getStats(keys) {
        return keys.map((key) => ({
            key: key.slice(0, 8) + '...',
            used: this._getEntry(key).count,
            limit: this.dailyLimit,
            remaining: this.remaining(key),
        }));
    }
}

// Singleton instance for Serper keys
const serperQuota = new KeyQuotaTracker(0); // limit set from config on first use

module.exports = { KeyQuotaTracker, serperQuota };
