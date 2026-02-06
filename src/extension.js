const vscode = require('vscode');

// Import configuration
const { CONFIG } = require('./config');

// Import services
const { SessionTracker } = require('./services/tracker');
const { callGemini } = require('./services/gemini');
const { writeLog } = require('./services/logger');
const { restoreBackup, deleteBackup } = require('./services/backup');

// Import UI
const { StatusBarManager } = require('./ui/statusBar');
const { DashboardManager } = require('./ui/dashboard');

// Import utils
const { shouldIgnoreFile, getExtension } = require('./utils/fileHelpers');

// Extension state
let statusBar;
let tracker;
let typingTimer = null;
let inactivityInterval = null;
let isProcessing = false;
let isShuttingDown = false;

/**
 * Extension activation
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    // Initialize tracker and UI
    tracker = new SessionTracker();
    statusBar = new StatusBarManager();
    const dashboard = new DashboardManager(context.extensionUri, tracker);
    
    // Restore any backed up session
    const backup = restoreBackup();
    if (backup) {
        tracker.restore(backup);
        vscode.window.showInformationMessage(
            `📦 DevLog: Restored ${tracker.changes.length} unsaved changes from previous session`
        );
    }

    // Initialize status bar
    const statusBarItem = statusBar.init('auto-devlog.showStats');

    // Command: Show session statistics (now opens Dashboard)
    const showStatsCommand = vscode.commands.registerCommand('auto-devlog.showStats', () => {
        dashboard.show();
    });

    // Command: Manual stop session
    const stopSessionCommand = vscode.commands.registerCommand('auto-devlog.stopSession', async () => {
        await processLogSession('manual');
        dashboard.update(); // Update after stop (or close?)
    });

    // Real-time change listener with debouncing
    const changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
        const filePath = event.document.fileName;
        
        if (shouldIgnoreFile(filePath)) return;
        if (event.contentChanges.length === 0) return;

        tracker.lastActivityTime = Date.now();

        if (typingTimer) clearTimeout(typingTimer);

        statusBar.setTyping();

        typingTimer = setTimeout(() => {
            const { baseName, ext, lines, truncated } = tracker.capture(event.document);
            
            const truncateNote = truncated ? ' [truncated]' : '';
            console.log(`[DevLog] Captured: ${baseName} (${lines} lines)${truncateNote}`);

            statusBar.setCaptured(
                baseName, 
                ext, 
                tracker.changes.length, 
                tracker.stats.filesModified.size
            );

            // Update dashboard if open
            dashboard.update();
        }, CONFIG.DEBOUNCE_DELAY);
    });

    // Inactivity watchdog
    inactivityInterval = setInterval(async () => {
        const idleTime = tracker.getIdleTime();
        
        if (idleTime >= CONFIG.INACTIVITY_THRESHOLD && tracker.hasData() && !isProcessing) {
            console.log('[DevLog] Inactivity detected, auto-committing...');
            await processLogSession('auto');
            dashboard.update();
        }
    }, CONFIG.INACTIVITY_CHECK_INTERVAL);

    // Register disposables
    context.subscriptions.push(statusBarItem, changeListener, showStatsCommand, stopSessionCommand);
    context.subscriptions.push({ dispose: () => clearInterval(inactivityInterval) });
    context.subscriptions.push(dashboard); // Dispose dashboard on deactivation
    
    console.log('[DevLog] Extension activated - modular architecture with Dashboard');
}

/**
 * Process the session: call AI and write log
 * @param {'manual'|'auto'|'shutdown'} trigger
 */
async function processLogSession(trigger) {
    if (!tracker.hasData()) {
        if (trigger === 'manual' && !isShuttingDown) {
            vscode.window.showWarningMessage('No changes captured yet!');
        }
        return;
    }

    if (isProcessing) {
        console.log('[DevLog] Already processing, skipping...');
        return;
    }

    isProcessing = true;

    try {
        if (isShuttingDown) {
            // Shutdown mode - skip UI
            console.log('[DevLog] Shutdown save - calling AI...');
            const summary = await callGemini(tracker.changes);
            writeLog(summary, tracker.stats);
            deleteBackup();
            tracker.reset();
            console.log('[DevLog] Shutdown save complete');
            return;
        }

        const message = trigger === 'auto' 
            ? 'DevLog: Inactivity detected. Generating log...'
            : 'DevLog: Generating AI summary...';

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: message,
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 30 });
            const summary = await callGemini(tracker.changes);
            
            progress.report({ increment: 40 });
            writeLog(summary, tracker.stats);
            deleteBackup();
            
            progress.report({ increment: 30 });
            tracker.reset();
            statusBar.setNewSession();
        });

        const successMsg = trigger === 'auto'
            ? '✅ Auto-DevLog: Inactivity detected. Session logged!'
            : '✅ DevLog entry created successfully!';
        
        vscode.window.showInformationMessage(successMsg);
    } catch (error) {
        if (!isShuttingDown) {
            vscode.window.showErrorMessage(`DevLog Error: ${error.message}`);
        }
        console.error('[DevLog Error]', error);
    } finally {
        isProcessing = false;
    }
}

/**
 * Extension deactivation - graceful shutdown
 */
async function deactivate() {
    isShuttingDown = true;
    
    if (typingTimer) clearTimeout(typingTimer);
    if (inactivityInterval) clearInterval(inactivityInterval);
    
    console.log(`[DevLog] Shutting down. Pending changes: ${tracker?.changes?.length || 0}`);
    
    if (tracker?.hasData()) {
        try {
            await processLogSession('shutdown');
        } catch (error) {
            console.error('[DevLog] Shutdown save failed, backup preserved:', error.message);
        }
    }
    
    statusBar?.dispose();
    console.log('[DevLog] Deactivated');
}

module.exports = { activate, deactivate };
