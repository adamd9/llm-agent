require('dotenv').config(); // Ensure .env variables are loaded first
const path = require('path');
const fs = require('fs'); // Import fs module

// Use console for logging within this critical utility to avoid dependency cycles with the main logger
// which might itself depend on the data directory.

let resolvedDataDir;
const defaultDataDir = path.resolve(__dirname, '../../data'); // __dirname is /Users/adam/Projects/llm-agent/src/utils

try {
    const envDataDir = process.env.LLM_AGENT_DATA_DIR;

    if (envDataDir) {
        if (path.isAbsolute(envDataDir)) {
            resolvedDataDir = envDataDir;
            console.log(`[DataDir] Using data directory from environment variable LLM_AGENT_DATA_DIR: ${resolvedDataDir}`);
        } else {
            resolvedDataDir = defaultDataDir;
            console.warn(`[DataDir] LLM_AGENT_DATA_DIR ('${envDataDir}') is set but is not an absolute path. Defaulting to ${resolvedDataDir}.`);
        }
    } else {
        resolvedDataDir = defaultDataDir;
        console.log(`[DataDir] LLM_AGENT_DATA_DIR not set. Defaulting data directory to ${resolvedDataDir}`);
    }
} catch (error) {
    console.error('[DataDir] Critical error resolving data directory. Falling back to default.', error);
    resolvedDataDir = defaultDataDir; // Default fallback
}

// Ensure the resolved data directory exists
try {
    if (!fs.existsSync(resolvedDataDir)) {
        fs.mkdirSync(resolvedDataDir, { recursive: true });
        console.log(`[DataDir] Created data directory: ${resolvedDataDir}`);
    }
} catch (error) {
    console.error(`[DataDir] Critical error creating data directory '${resolvedDataDir}'. Please check permissions and path.`, error);
    // If directory creation fails, it's a critical issue. The application might not function correctly.
    // We'll still set DATA_DIR_PATH, but dependent operations will likely fail.
}

const DATA_DIR_PATH = resolvedDataDir;

/**
 * Returns the resolved absolute path to the data directory.
 * This path is determined by the LLM_AGENT_DATA_DIR environment variable
 * or defaults to the 'data' folder in the project root.
 * @returns {string} The absolute path to the data directory.
 */
function getDataDir() {
    return DATA_DIR_PATH;
}

module.exports = {
    DATA_DIR_PATH,
    getDataDir,
};
