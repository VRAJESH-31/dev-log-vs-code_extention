const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

// Configuration
const GEMINI_API_KEY = "AIzaSyAh7n-HLaHQ8KKWZaSuBTMcLkMp23Eb0Ng";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const BACKUP_FILENAME = '.devlog_temp.json';

// Timing Configuration
const DEBOUNCE_DELAY = 3000;
const INACTIVITY_CHECK_INTERVAL = 60000;
const INACTIVITY_THRESHOLD = 15 * 60 * 1000;

// Extension State
let statusBarItem;
let sessionStats = {
    saveCount: 0,
    filesModified: new Set(),
    sessionStart: null
};
let sessionChanges = [];

// Debounce & Watchdog State
let typingTimer = null;
let lastActivityTime = Date.now();
let inactivityInterval = null;
let isProcessing = false;
let isShuttingDown = false;

// Paths to exclude from tracking
const IGNORE_PATTERNS = [
    'DEVLOG.md', '.git', '.env', 'node_modules', '.vscode',
    'package-lock.json', '.DS_Store', 'dist', 'build', '.next',
    BACKUP_FILENAME
];

/**
 * Activates the extension and registers all event listeners.
 */
function activate(context) {
    sessionStats.sessionStart = new Date();
    lastActivityTime = Date.now();

    // Restore any backed up session from previous crash/shutdown
    restoreBackup();

    // Status bar setup
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(eye) DevLog Watching";
    statusBarItem.tooltip = "Auto-DevLog: Passive tracking active\nClick for stats";
    statusBarItem.command = 'auto-devlog.showStats';
    statusBarItem.show();

    // Command: Show session statistics
    const showStatsCommand = vscode.commands.registerCommand('auto-devlog.showStats', () => {
        const duration = getSessionDuration();
        vscode.window.showInformationMessage(
            `📊 DevLog | ⏱️ ${duration} | 📝 ${sessionChanges.length} captures | 📁 ${sessionStats.filesModified.size} files`
        );
    });

    // Command: Manual stop session
    const stopSessionCommand = vscode.commands.registerCommand('auto-devlog.stopSession', async () => {
        await processLogSession('manual');
    });

    // Real-time change listener with debouncing
    const changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
        const filePath = event.document.fileName;
        
        if (shouldIgnoreFile(filePath)) return;
        if (event.contentChanges.length === 0) return;

        lastActivityTime = Date.now();

        if (typingTimer) clearTimeout(typingTimer);

        statusBarItem.text = "$(pencil) Typing...";
        statusBarItem.backgroundColor = undefined;

        typingTimer = setTimeout(() => {
            captureChange(event.document);
        }, DEBOUNCE_DELAY);
    });

    // Inactivity watchdog
    inactivityInterval = setInterval(async () => {
        const timeSinceActivity = Date.now() - lastActivityTime;
        
        if (timeSinceActivity >= INACTIVITY_THRESHOLD && sessionChanges.length > 0 && !isProcessing) {
            console.log('[DevLog] Inactivity detected, auto-committing...');
            await processLogSession('auto');
        }
    }, INACTIVITY_CHECK_INTERVAL);

    // Register disposables
    context.subscriptions.push(statusBarItem, changeListener, showStatsCommand, stopSessionCommand);
    context.subscriptions.push({ dispose: () => clearInterval(inactivityInterval) });
    
    console.log('[DevLog] Passive mode activated');
}

/**
 * Captures a file change after debounce period.
 */
function captureChange(document) {
    const filePath = document.fileName;
    const baseName = path.basename(filePath);
    const ext = path.extname(filePath);
    const icon = getFileIcon(ext);

    sessionStats.saveCount++;
    sessionStats.filesModified.add(baseName);
    
    const lines = document.getText().split('\n').length;
    
    sessionChanges.push({
        file: baseName,
        path: filePath,
        timestamp: new Date().toISOString(),
        type: ext,
        lines: lines
    });

    // Save backup after each capture (protection against crashes)
    saveBackup();

    console.log(`[DevLog] Captured: ${baseName} (${lines} lines)`);

    statusBarItem.text = `$(check) ${icon} ${baseName}`;
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    statusBarItem.tooltip = `Auto-captured: ${baseName}\nTotal captures: ${sessionChanges.length}`;

    setTimeout(() => {
        statusBarItem.text = `$(eye) DevLog (${sessionChanges.length})`;
        statusBarItem.backgroundColor = undefined;
        statusBarItem.tooltip = `Auto-DevLog: ${sessionStats.filesModified.size} files tracked\nAuto-commits after 15min inactivity`;
    }, 2000);
}

/**
 * Saves current session to a backup file for crash recovery.
 */
function saveBackup() {
    try {
        const backupPath = getBackupPath();
        if (!backupPath) return;

        const backupData = {
            sessionChanges,
            sessionStats: {
                saveCount: sessionStats.saveCount,
                filesModified: Array.from(sessionStats.filesModified),
                sessionStart: sessionStats.sessionStart?.toISOString()
            },
            savedAt: new Date().toISOString()
        };

        fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf8');
        console.log('[DevLog] Backup saved');
    } catch (error) {
        console.error('[DevLog] Backup failed:', error.message);
    }
}

/**
 * Restores session from backup file if it exists.
 */
function restoreBackup() {
    try {
        const backupPath = getBackupPath();
        if (!backupPath || !fs.existsSync(backupPath)) return;

        const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
        
        if (data.sessionChanges?.length > 0) {
            sessionChanges = data.sessionChanges;
            sessionStats.saveCount = data.sessionStats?.saveCount || 0;
            sessionStats.filesModified = new Set(data.sessionStats?.filesModified || []);
            
            console.log(`[DevLog] Restored ${sessionChanges.length} changes from backup`);
            vscode.window.showInformationMessage(
                `📦 DevLog: Restored ${sessionChanges.length} unsaved changes from previous session`
            );
        }

        // Delete backup after restoration
        fs.unlinkSync(backupPath);
        console.log('[DevLog] Backup file deleted after restore');
    } catch (error) {
        console.error('[DevLog] Restore failed:', error.message);
    }
}

/**
 * Deletes the backup file.
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

/**
 * Gets the path to the backup file.
 */
function getBackupPath() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) return null;
    return path.join(workspaceFolders[0].uri.fsPath, BACKUP_FILENAME);
}

/**
 * Processes the session: calls AI and writes log.
 */
async function processLogSession(trigger) {
    if (sessionChanges.length === 0) {
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
        // During shutdown, skip UI notifications
        if (isShuttingDown) {
            console.log('[DevLog] Shutdown save - calling AI...');
            const summary = await callGemini(sessionChanges);
            writeLog(summary);
            deleteBackup();
            resetSession();
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
            const summary = await callGemini(sessionChanges);
            
            progress.report({ increment: 40 });
            writeLog(summary);
            deleteBackup();
            
            progress.report({ increment: 30 });
            resetSession();
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
        // Keep backup on error so data isn't lost
    } finally {
        isProcessing = false;
    }
}

/**
 * Sends session changes to Gemini API.
 */
async function callGemini(changes) {
    if (GEMINI_API_KEY === "PASTE_KEY_HERE") {
        throw new Error("API key not configured");
    }

    const prompt = `You are a technical documentation assistant. Analyze these code changes and write a concise, bullet-point developer log entry in Markdown. Focus on what was achieved and technical details.\n\nSession Changes:\n${JSON.stringify(changes, null, 2)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout for shutdown

    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        
        if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
            throw new Error('Invalid API response format');
        }

        return data.candidates[0].content.parts[0].text;
    } catch (error) {
        clearTimeout(timeout);
        throw error;
    }
}

/**
 * Appends AI-generated content to DEVLOG.md.
 */
function writeLog(content) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (!workspaceFolders?.length) {
        throw new Error('No workspace folder open');
    }

    const logPath = path.join(workspaceFolders[0].uri.fsPath, 'DEVLOG.md');
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const entry = `\n---\n\n## 📝 Log: ${dateStr} at ${timeStr}\n\n${content}\n\n*Generated by Auto-DevLog*\n`;

    if (!fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, `# Developer Log\n\nAutomated development journal powered by Auto-DevLog.\n${entry}`, 'utf8');
    } else {
        fs.appendFileSync(logPath, entry, 'utf8');
    }

    console.log(`[DevLog] Written to: ${logPath}`);
}

/**
 * Resets session state.
 */
function resetSession() {
    sessionChanges = [];
    sessionStats.saveCount = 0;
    sessionStats.filesModified.clear();
    sessionStats.sessionStart = new Date();
    lastActivityTime = Date.now();
    
    if (!isShuttingDown) {
        statusBarItem.text = "$(eye) DevLog Watching";
        statusBarItem.tooltip = "Auto-DevLog: New session started";
    }
}

/**
 * Checks if a file path matches any ignore patterns.
 */
function shouldIgnoreFile(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    return IGNORE_PATTERNS.some(pattern => normalized.includes(pattern));
}

/**
 * Returns an icon identifier based on file extension.
 */
function getFileIcon(ext) {
    const icons = {
        '.js': '$(symbol-method)', '.ts': '$(symbol-class)',
        '.jsx': '$(symbol-method)', '.tsx': '$(symbol-class)',
        '.json': '$(json)', '.html': '$(code)',
        '.css': '$(symbol-color)', '.scss': '$(symbol-color)',
        '.md': '$(markdown)', '.py': '$(symbol-method)',
        '.java': '$(symbol-class)', '.go': '$(symbol-method)',
        '.rs': '$(symbol-class)', '.vue': '$(symbol-method)',
        '.svelte': '$(symbol-method)'
    };
    return icons[ext.toLowerCase()] || '$(file)';
}

/**
 * Calculates session duration.
 */
function getSessionDuration() {
    if (!sessionStats.sessionStart) return '0m';
    
    const diff = Date.now() - sessionStats.sessionStart.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    
    return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/**
 * Graceful shutdown - saves data before VS Code closes.
 */
async function deactivate() {
    isShuttingDown = true;
    
    if (typingTimer) clearTimeout(typingTimer);
    if (inactivityInterval) clearInterval(inactivityInterval);
    
    console.log(`[DevLog] Shutting down. Pending changes: ${sessionChanges.length}`);
    
    if (sessionChanges.length > 0) {
        try {
            // Try to process with AI
            await processLogSession('shutdown');
        } catch (error) {
            console.error('[DevLog] Shutdown AI save failed, keeping backup:', error.message);
            // Backup already exists from captureChange(), so data is safe
        }
    }
    
    statusBarItem?.dispose();
    console.log('[DevLog] Deactivated');
}

module.exports = { activate, deactivate };
