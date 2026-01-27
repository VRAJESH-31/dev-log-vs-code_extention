const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { CONFIG } = require('../config');

/**
 * Get the workspace root path
 * @returns {string|null}
 */
function getWorkspaceRoot() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) return null;
    return workspaceFolders[0].uri.fsPath;
}

/**
 * Get the full path to the backup file in .vscode folder
 * @returns {string|null}
 */
function getBackupPath() {
    const root = getWorkspaceRoot();
    if (!root) return null;
    
    const vscodeDir = path.join(root, '.vscode');
    
    // Ensure .vscode directory exists
    if (!fs.existsSync(vscodeDir)) {
        fs.mkdirSync(vscodeDir, { recursive: true });
    }
    
    return path.join(root, CONFIG.BACKUP_PATH);
}

/**
 * Save current session to backup file for crash recovery
 * @param {Array} sessionChanges - Array of captured changes
 * @param {Object} sessionStats - Session statistics
 */
function saveBackup(sessionChanges, sessionStats) {
    try {
        const backupPath = getBackupPath();
        if (!backupPath) return;

        const backupData = {
            version: '1.0',
            sessionChanges,
            sessionStats: {
                saveCount: sessionStats.saveCount,
                filesModified: Array.from(sessionStats.filesModified),
                sessionStart: sessionStats.sessionStart?.toISOString()
            },
            savedAt: new Date().toISOString()
        };

        fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf8');
        console.log('[DevLog] Backup saved to .vscode/devlog-temp.json');
    } catch (error) {
        console.error('[DevLog] Backup failed:', error.message);
    }
}

/**
 * Restore session from backup file if it exists
 * @returns {{ sessionChanges: Array, sessionStats: Object }|null}
 */
function restoreBackup() {
    try {
        const backupPath = getBackupPath();
        if (!backupPath || !fs.existsSync(backupPath)) return null;

        const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
        
        if (data.sessionChanges?.length > 0) {
            console.log(`[DevLog] Restored ${data.sessionChanges.length} changes from backup`);
            
            // Delete backup after successful read
            fs.unlinkSync(backupPath);
            console.log('[DevLog] Backup file deleted after restore');
            
            return {
                sessionChanges: data.sessionChanges,
                sessionStats: {
                    saveCount: data.sessionStats?.saveCount || 0,
                    filesModified: new Set(data.sessionStats?.filesModified || []),
                    sessionStart: data.sessionStats?.sessionStart 
                        ? new Date(data.sessionStats.sessionStart) 
                        : new Date()
                }
            };
        }
        
        return null;
    } catch (error) {
        console.error('[DevLog] Restore failed:', error.message);
        return null;
    }
}

/**
 * Delete the backup file
 */
function deleteBackup() {
    try {
        const backupPath = getBackupPath();
        if (backupPath && fs.existsSync(backupPath)) {
            fs.unlinkSync(backupPath);
            console.log('[DevLog] Backup deleted');
        }
    } catch (error) {
        console.error('[DevLog] Delete backup failed:', error.message);
    }
}

module.exports = {
    getWorkspaceRoot,
    getBackupPath,
    saveBackup,
    restoreBackup,
    deleteBackup
};
