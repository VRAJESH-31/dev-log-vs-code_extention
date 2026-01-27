const vscode = require('vscode');
const { getFileIcon } = require('../utils/fileHelpers');

/**
 * Status Bar UI Manager
 * Handles all status bar display states and interactions
 */
class StatusBarManager {
    constructor() {
        this.item = null;
        this.revertTimer = null;
    }

    /**
     * Initialize the status bar item
     * @param {string} command - Command to execute on click
     */
    init(command) {
        this.item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right, 
            100
        );
        this.item.command = command;
        this.setWatching();
        this.item.show();
        return this.item;
    }

    /**
     * Set status bar to "Watching" state (default)
     * @param {number} captureCount - Optional capture count to display
     */
    setWatching(captureCount = 0) {
        if (!this.item) return;
        
        if (captureCount > 0) {
            this.item.text = `$(eye) DevLog (${captureCount})`;
        } else {
            this.item.text = '$(eye) DevLog Watching';
        }
        this.item.backgroundColor = undefined;
        this.item.tooltip = 'Auto-DevLog: Passive tracking active\nClick for stats';
    }

    /**
     * Set status bar to "Typing" state
     */
    setTyping() {
        if (!this.item) return;
        
        this.item.text = '$(pencil) Typing...';
        this.item.backgroundColor = undefined;
    }

    /**
     * Set status bar to "Captured" state with file info
     * @param {string} baseName - File name that was captured
     * @param {string} ext - File extension
     * @param {number} captureCount - Total capture count
     * @param {number} fileCount - Unique files tracked
     */
    setCaptured(baseName, ext, captureCount, fileCount) {
        if (!this.item) return;
        
        // Clear any existing revert timer
        if (this.revertTimer) {
            clearTimeout(this.revertTimer);
        }

        const icon = getFileIcon(ext);
        this.item.text = `$(check) ${icon} ${baseName}`;
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.item.tooltip = `Auto-captured: ${baseName}\nTotal captures: ${captureCount}`;

        // Revert to watching state after 2 seconds
        this.revertTimer = setTimeout(() => {
            this.item.text = `$(eye) DevLog (${captureCount})`;
            this.item.backgroundColor = undefined;
            this.item.tooltip = `Auto-DevLog: ${fileCount} files tracked\nAuto-commits after 15min inactivity`;
        }, 2000);
    }

    /**
     * Set status bar to "Processing" state
     */
    setProcessing() {
        if (!this.item) return;
        
        this.item.text = '$(sync~spin) DevLog Processing...';
        this.item.backgroundColor = undefined;
    }

    /**
     * Set status bar to "New Session" state
     */
    setNewSession() {
        if (!this.item) return;
        
        this.item.text = '$(eye) DevLog Watching';
        this.item.tooltip = 'Auto-DevLog: New session started';
        this.item.backgroundColor = undefined;
    }

    /**
     * Update tooltip with custom message
     * @param {string} message - Tooltip message
     */
    setTooltip(message) {
        if (!this.item) return;
        this.item.tooltip = message;
    }

    /**
     * Dispose the status bar item
     */
    dispose() {
        if (this.revertTimer) {
            clearTimeout(this.revertTimer);
        }
        if (this.item) {
            this.item.dispose();
        }
    }
}

module.exports = {
    StatusBarManager
};
