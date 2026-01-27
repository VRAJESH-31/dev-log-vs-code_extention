const { smartTruncate, wasTruncated } = require('../utils/truncate');
const { getBaseName, getExtension } = require('../utils/fileHelpers');
const { saveBackup } = require('./backup');

/**
 * Session state management
 */
class SessionTracker {
    constructor() {
        this.reset();
    }

    /**
     * Reset session to initial state
     */
    reset() {
        this.changes = [];
        this.stats = {
            saveCount: 0,
            filesModified: new Set(),
            sessionStart: new Date()
        };
        this.lastActivityTime = Date.now();
    }

    /**
     * Restore session from backup data
     * @param {Object} backupData - Data from backup restore
     */
    restore(backupData) {
        if (backupData) {
            this.changes = backupData.sessionChanges || [];
            this.stats = backupData.sessionStats || this.stats;
            this.stats.filesModified = new Set(this.stats.filesModified);
        }
    }

    /**
     * Capture a file change
     * @param {Object} document - VS Code text document
     * @returns {Object} - Captured change info
     */
    capture(document) {
        const filePath = document.fileName;
        const baseName = getBaseName(filePath);
        const ext = getExtension(filePath);

        this.stats.saveCount++;
        this.stats.filesModified.add(baseName);
        this.lastActivityTime = Date.now();

        // Get content with smart truncation
        const rawContent = document.getText();
        const content = smartTruncate(rawContent);
        const lines = rawContent.split('\n').length;
        const truncated = wasTruncated(rawContent, content);

        const change = {
            file: baseName,
            path: filePath,
            timestamp: new Date().toISOString(),
            type: ext,
            lines: lines,
            contentPreview: content.substring(0, 500),
            truncated: truncated
        };

        this.changes.push(change);

        // Save backup immediately (crash protection)
        saveBackup(this.changes, this.stats);

        return { change, baseName, ext, lines, truncated };
    }

    /**
     * Check if session has data
     * @returns {boolean}
     */
    hasData() {
        return this.changes.length > 0;
    }

    /**
     * Get time since last activity in ms
     * @returns {number}
     */
    getIdleTime() {
        return Date.now() - this.lastActivityTime;
    }

    /**
     * Get formatted session duration
     * @returns {string}
     */
    getDuration() {
        if (!this.stats.sessionStart) return '0m';
        
        const diff = Date.now() - this.stats.sessionStart.getTime();
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(minutes / 60);
        
        return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
    }
}

module.exports = {
    SessionTracker
};
