const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

class DashboardManager {
    constructor(extensionUri, tracker) {
        this.extensionUri = extensionUri;
        this.tracker = tracker;
        this.panel = undefined;
        this._disposables = [];
    }

    /**
     * Show or create the dashboard webview
     */
    show() {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
            this.update();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'autoDevLogDashboard',
            'DevLog Dashboard',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'src', 'ui', 'templates')]
            }
        );

        this.panel.webview.html = this._getHtmlForWebview();

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'stopSession':
                        vscode.commands.executeCommand('auto-devlog.stopSession');
                        this.panel.dispose();
                        break;
                }
            },
            null,
            this._disposables
        );

        this.panel.onDidDispose(
            () => this.dispose(),
            null,
            this._disposables
        );

        // Initial update
        this.update();
    }

    /**
     * Send updated stats to the webview
     */
    update() {
        if (!this.panel) {
            return;
        }

        const data = this._getStats();
        this.panel.webview.postMessage({ command: 'updateStats', data });
    }

    /**
     * Get current stats from tracker
     */
    _getStats() {
        const stats = this.tracker.stats;
        const changes = this.tracker.changes;

        // Simplify files list for UI
        const files = changes.map(c => ({
            name: path.basename(c.file),
            lines: c.lines
        }));

        const totalLines = files.reduce((acc, curr) => acc + curr.lines, 0);

        return {
            duration: this.tracker.getDuration(),
            fileCount: stats.filesModified.size,
            lineCount: totalLines, // Or derive from tracker stats if available
            files: files
        };
    }

    _getHtmlForWebview() {
        const templatePath = path.join(this.extensionUri.fsPath, 'src', 'ui', 'templates', 'dashboard.html');
        let htmlContent = fs.readFileSync(templatePath, 'utf8');
        
        // If we needed to replace specific resource paths, we would do it here using .asWebviewUri()
        // For now, the HTML is self-contained except for the script which is inline.
        
        return htmlContent;
    }

    dispose() {
        this.panel = undefined;
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}

module.exports = { DashboardManager };
