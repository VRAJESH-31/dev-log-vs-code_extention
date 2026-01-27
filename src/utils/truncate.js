const { CONFIG } = require('../config');

/**
 * Smart truncation for large files to save tokens and bandwidth.
 * Keeps first N chars + last M chars for files exceeding the limit.
 * 
 * @param {string} content - File content to potentially truncate
 * @returns {string} - Original or truncated content
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
 * Check if content was truncated
 * @param {string} original - Original content
 * @param {string} processed - Processed content
 * @returns {boolean}
 */
function wasTruncated(original, processed) {
    return processed.length < original.length;
}

module.exports = {
    smartTruncate,
    wasTruncated
};
