const fs = require('fs');
const path = require('path');
const { DATA_DIR_PATH } = require('./dataDir');
const { loadSettings } = require('./settings');
const logger = require('./logger');

function loadPrompt(moduleName, promptName, defaultValue) {
    const settings = loadSettings();
    if (settings.usePromptOverrides === false) {
        return defaultValue;
    }

    const overridePath = path.join(DATA_DIR_PATH, 'prompts', moduleName, `${promptName}.txt`);
    try {
        if (fs.existsSync(overridePath)) {
            const content = fs.readFileSync(overridePath, 'utf8');
            logger.debug('PromptManager', `Loaded override for ${moduleName}/${promptName}`);
            return content.trim();
        }
    } catch (err) {
        logger.error('PromptManager', `Failed loading override for ${moduleName}/${promptName}:`, err);
    }
    return defaultValue;
}

module.exports = { loadPrompt };
