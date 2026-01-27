const path = require('path');

/**
 * Paths and patterns to exclude from tracking
 */
const IGNORE_PATTERNS = [
    'DEVLOG.md',
    '.git',
    '.env',
    'node_modules',
    '.vscode',
    'package-lock.json',
    '.DS_Store',
    'dist',
    'build',
    '.next',
    'devlog-temp.json'
];

/**
 * File extension to VS Code icon mapping
 */
const FILE_ICONS = {
    '.js': '$(symbol-method)',
    '.ts': '$(symbol-class)',
    '.jsx': '$(symbol-method)',
    '.tsx': '$(symbol-class)',
    '.json': '$(json)',
    '.html': '$(code)',
    '.css': '$(symbol-color)',
    '.scss': '$(symbol-color)',
    '.md': '$(markdown)',
    '.py': '$(symbol-method)',
    '.java': '$(symbol-class)',
    '.go': '$(symbol-method)',
    '.rs': '$(symbol-class)',
    '.vue': '$(symbol-method)',
    '.svelte': '$(symbol-method)'
};

/**
 * Check if a file path should be ignored based on patterns
 * @param {string} filePath - Full file path to check
 * @returns {boolean} - True if file should be ignored
 */
function shouldIgnoreFile(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    return IGNORE_PATTERNS.some(pattern => normalized.includes(pattern));
}

/**
 * Get VS Code icon identifier based on file extension
 * @param {string} ext - File extension (e.g., '.js')
 * @returns {string} - VS Code icon identifier
 */
function getFileIcon(ext) {
    return FILE_ICONS[ext.toLowerCase()] || '$(file)';
}

/**
 * Extract basename from file path
 * @param {string} filePath - Full file path
 * @returns {string} - File name only
 */
function getBaseName(filePath) {
    return path.basename(filePath);
}

/**
 * Get file extension from path
 * @param {string} filePath - Full file path
 * @returns {string} - File extension
 */
function getExtension(filePath) {
    return path.extname(filePath);
}

module.exports = {
    IGNORE_PATTERNS,
    FILE_ICONS,
    shouldIgnoreFile,
    getFileIcon,
    getBaseName,
    getExtension
};
