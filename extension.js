const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

// Load environment variables from .env file
function loadEnv() {
    try {
        const envPath = path.join(__dirname, '.env');
        if (fs.existsSync(envPath)) {
            require('dotenv').config({ path: envPath });
        }
    } catch (error) {
        console.log('[DevLog] No .env file found, using defaults');
    }
}
loadEnv();

// Configuration (from .env with fallbacks)
const CONFIG = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'PASTE_KEY_HERE',
    GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    DEBOUNCE_DELAY: parseInt(process.env.DEBOUNCE_DELAY) || 3000,
    INACTIVITY_CHECK_INTERVAL: parseInt(process.env.INACTIVITY_CHECK_INTERVAL) || 60000,
    INACTIVITY_THRESHOLD: parseInt(process.env.INACTIVITY_THRESHOLD) || 900000,
    MAX_CONTENT_LENGTH: parseInt(process.env.MAX_CONTENT_LENGTH) || 30000,
    TRUNCATE_HEAD: parseInt(process.env.TRUNCATE_HEAD) || 10000,
    TRUNCATE_TAIL: parseInt(process.env.TRUNCATE_TAIL) || 5000,
    API_TIMEOUT: parseInt(process.env.API_TIMEOUT) || 15000
};

const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent`;
const BACKUP_PATH = '.vscode/devlog-temp.json';

// AI System Prompt (Anti-Spam)
const AI_SYSTEM_PROMPT = `You are a technical documentation assistant creating developer log entries.

RULES:
1. If you detect massive UI blocks (React JSX, HTML, Tailwind classes), DO NOT list them line-by-line.
2. Summarize UI changes broadly (e.g., "Implemented Responsive Dashboard Layout").
3. Focus on LOGIC, ALGORITHMS, and FUNCTIONALITY - not markup or styling details.
4. Keep entries concise with bullet points.
5. Highlight architectural decisions and problem-solving approaches.
6. Mention file names and key functions modified.

OUTPUT FORMAT: Markdown bullet points, 3-8 items maximum.`;

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
    'devlog-temp.json'
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
        }, CONFIG.DEBOUNCE_DELAY);
    });

    // Inactivity watchdog
    inactivityInterval = setInterval(async () => {
        const timeSinceActivity = Date.now() - lastActivityTime;
        
        if (timeSinceActivity >= CONFIG.INACTIVITY_THRESHOLD && sessionChanges.length > 0 && !isProcessing) {
            console.log('[DevLog] Inactivity detected, auto-committing...');
            await processLogSession('auto');
        }
    }, CONFIG.INACTIVITY_CHECK_INTERVAL);

    // Register disposables
    context.subscriptions.push(statusBarItem, changeListener, showStatsCommand, stopSessionCommand);
    context.subscriptions.push({ dispose: () => clearInterval(inactivityInterval) });
    
    console.log('[DevLog] Passive mode activated with crash protection');
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
    
    // Get content with smart truncation for large files
    const rawContent = document.getText();
    const content = smartTruncate(rawContent);
    const lines = rawContent.split('\n').length;
    const wasTruncated = content.length < rawContent.length;
    
    sessionChanges.push({
        file: baseName,
        path: filePath,
        timestamp: new Date().toISOString(),
        type: ext,
        lines: lines,
        contentPreview: content.substring(0, 500), // Small preview for context
        truncated: wasTruncated
    });

    // Save backup immediately after capture (crash protection)
    saveBackup();

    const truncateNote = wasTruncated ? ' [truncated]' : '';
    console.log(`[DevLog] Captured: ${baseName} (${lines} lines)${truncateNote}`);

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
 * Smart truncation for large files to save tokens and bandwidth.
 * Keeps first 10k chars + last 5k chars for large files.
 */
function smartTruncate(content) {
    if (content.length <= CONFIG.MAX_CONTENT_LENGTH) {
        return content;
    }

    const head = content.substring(0, CONFIG.TRUNCATE_HEAD);
    const tail = content.substring(content.length - CONFIG.TRUNCATE_TAIL);
    const truncatedLength = content.length - CONFIG.TRUNCATE_HEAD - CONFIG.TRUNCATE_TAIL;
    
    return `${head}\n\n... [TRUNCATED: ${truncatedLength.toLocaleString()} characters removed] ...\n\n${tail}`;
}

/**
 * Gets the full path to the backup file in .vscode folder.
 */
function getBackupPath() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) return null;
    
    const vscodeDir = path.join(workspaceFolders[0].uri.fsPath, '.vscode');
    
    // Ensure .vscode directory exists
    if (!fs.existsSync(vscodeDir)) {
        fs.mkdirSync(vscodeDir, { recursive: true });
    }
    
    return path.join(workspaceFolders[0].uri.fsPath, BACKUP_PATH);
}

/**
 * Saves current session to backup file for crash recovery.
 */
function saveBackup() {
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

        // Delete backup after successful restoration
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
    } finally {
        isProcessing = false;
    }
}

/**
 * Sends session changes to Gemini 2.5 Flash API with anti-spam prompt.
 */
async function callGemini(changes) {
    if (CONFIG.GEMINI_API_KEY === "PASTE_KEY_HERE") {
        throw new Error("API key not configured");
    }

    // Prepare changes summary (without full content to save tokens)
    const changesSummary = changes.map(c => ({
        file: c.file,
        type: c.type,
        lines: c.lines,
        timestamp: c.timestamp,
        truncated: c.truncated,
        preview: c.contentPreview
    }));

    const userPrompt = `Analyze these code changes and create a developer log entry:\n\n${JSON.stringify(changesSummary, null, 2)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.API_TIMEOUT);

    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${CONFIG.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: `${AI_SYSTEM_PROMPT}\n\n${userPrompt}` }]
                }],
                generationConfig: { 
                    temperature: 0.7, 
                    maxOutputTokens: 1024 
                }
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error ${response.status}: ${errorText}`);
        }

        /** @type {{ candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }} */
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

    const filesChanged = sessionStats.filesModified.size;
    const captures = sessionChanges.length;
    
    const entry = `\n---\n\n## 📝 Log: ${dateStr} at ${timeStr}\n\n**Session Stats:** ${captures} captures across ${filesChanged} files\n\n${content}\n\n*Generated by Auto-DevLog*\n`;

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
            await processLogSession('shutdown');
        } catch (error) {
            console.error('[DevLog] Shutdown AI save failed, keeping backup:', error.message);
            // Backup already exists, so data is safe for next session
        }
    }
    
    statusBarItem?.dispose();
    console.log('[DevLog] Deactivated');
}

module.exports = { activate, deactivate };
