const fs = require('fs');
const path = require('path');
const { DATA_DIR_PATH } = require('./dataDir');

const SETTINGS_PATH = path.join(DATA_DIR_PATH, 'settings.json');
const DEFAULTS_PATH = path.resolve(__dirname, '../../config/defaultSettings.json');

const fallbackDefaults = {
  // Base OpenAI model used if a specific one is not provided
  llmModel: 'gpt-4.1',
  // Optional specialised models for different subsystems
  plannerModel: '',
  evaluatorModel: '',
  queryModel: '',
  bubbleModel: '',
  reflectionModel: '',
  utteranceCheckModel: 'gpt-4.1-nano',
  // Default maximum tokens for LLM responses
  maxTokens: 1000,
  // Maximum tokens allowed for LLM requests
  tokenLimit: 10000,
  // Default ElevenLabs voice and model for TTS
  ttsVoiceId: 'D38z5RcWu1voky8WS1ja', // "Rachel"
  ttsModelId: 'eleven_flash_v2_5',
  // Streaming STT defaults
  sttSampleRate: 16000,
  sttFormattedFinals: true,
  // Delay before auto-sending speech input (ms)
  autoSendDelayMs: 2000,
  // Whether to load prompt overrides from the data directory
  usePromptOverrides: true
};

let fileDefaults = {};
try {
  const data = fs.readFileSync(DEFAULTS_PATH, 'utf8');
  fileDefaults = JSON.parse(data);
} catch (err) {
  // If the file is missing or invalid, fall back to built-in defaults
}

const defaultSettings = { ...fallbackDefaults, ...fileDefaults };

function loadRawSettings() {
  try {
    const data = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return {};
  }
}

function loadSettings() {
  const raw = loadRawSettings();
  const settings = { ...defaultSettings };
  for (const key of Object.keys(defaultSettings)) {
    if (raw[key] !== undefined && raw[key] !== '') {
      settings[key] = raw[key];
    }
  }
  return settings;
}


function saveSettings(settings) {
  try {
    // Ensure the data directory exists
    const dataDir = path.dirname(SETTINGS_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Merge with existing settings if they exist
    let existingSettings = {};
    try {
      if (fs.existsSync(SETTINGS_PATH)) {
        existingSettings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      }
    } catch (err) {
      console.warn('Failed to read existing settings, creating new settings file');
    }
    
    // Merge and save
    const mergedSettings = { ...existingSettings, ...settings };
    
    // Write settings to file
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(mergedSettings, null, 2));
    console.log('Settings saved successfully');
    
    return true;
  } catch (err) {
    console.error('Failed to save settings:', err);
    return false;
  }
}

module.exports = {
  SETTINGS_PATH,
  defaultSettings,
  loadRawSettings,
  loadSettings,
  saveSettings
};
