const { CONFIG, GEMINI_API_URL, AI_SYSTEM_PROMPT } = require('../config');

/**
 * Send session changes to Gemini API for AI-powered summarization
 * @param {Array} changes - Array of captured file changes
 * @returns {Promise<string>} - AI-generated markdown summary
 */
async function callGemini(changes) {
    if (CONFIG.GEMINI_API_KEY === 'PASTE_KEY_HERE') {
        throw new Error('API key not configured. Update GEMINI_API_KEY in .env');
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

module.exports = {
    callGemini
};
