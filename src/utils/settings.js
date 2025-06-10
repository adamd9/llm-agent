const fs = require('fs');
const path = require('path');
const { DATA_DIR_PATH } = require('./dataDir');

const SETTINGS_PATH = path.join(DATA_DIR_PATH, 'settings.json');

const defaultSettings = {
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
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

module.exports = {
  SETTINGS_PATH,
  defaultSettings,
  loadRawSettings,
  loadSettings,
  saveSettings
};
