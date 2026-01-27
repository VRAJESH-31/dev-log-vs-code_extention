const path = require('path');
const fs = require('fs');

// Load environment variables from .env file
function loadEnv() {
    try {
        const envPath = path.join(__dirname, '..', '..', '.env');
        if (fs.existsSync(envPath)) {
            require('dotenv').config({ path: envPath });
        }
    } catch (error) {
        console.log('[DevLog] No .env file found, using defaults');
    }
}
loadEnv();

/**
 * Extension configuration loaded from .env with fallback defaults
 */
const CONFIG = {
    // API Settings
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'PASTE_KEY_HERE',
    GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    API_TIMEOUT: parseInt(process.env.API_TIMEOUT) || 15000,

    // Timing Settings
    DEBOUNCE_DELAY: parseInt(process.env.DEBOUNCE_DELAY) || 3000,
    INACTIVITY_CHECK_INTERVAL: parseInt(process.env.INACTIVITY_CHECK_INTERVAL) || 60000,
    INACTIVITY_THRESHOLD: parseInt(process.env.INACTIVITY_THRESHOLD) || 900000,

    // Truncation Settings
    MAX_CONTENT_LENGTH: parseInt(process.env.MAX_CONTENT_LENGTH) || 30000,
    TRUNCATE_HEAD: parseInt(process.env.TRUNCATE_HEAD) || 10000,
    TRUNCATE_TAIL: parseInt(process.env.TRUNCATE_TAIL) || 5000,

    // Paths
    BACKUP_PATH: '.vscode/devlog-temp.json',
    LOG_FILENAME: 'DEVLOG.md'
};

/**
 * Gemini API URL constructed from model config
 */
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent`;

/**
 * AI System Prompt with anti-spam rules for UI code
 */
const AI_SYSTEM_PROMPT = `You are a technical documentation assistant creating developer log entries.

RULES:
1. If you detect massive UI blocks (React JSX, HTML, Tailwind classes), DO NOT list them line-by-line.
2. Summarize UI changes broadly (e.g., "Implemented Responsive Dashboard Layout").
3. Focus on LOGIC, ALGORITHMS, and FUNCTIONALITY - not markup or styling details.
4. Keep entries concise with bullet points.
5. Highlight architectural decisions and problem-solving approaches.
6. Mention file names and key functions modified.

OUTPUT FORMAT: Markdown bullet points, 3-8 items maximum.`;

module.exports = {
    CONFIG,
    GEMINI_API_URL,
    AI_SYSTEM_PROMPT
};
