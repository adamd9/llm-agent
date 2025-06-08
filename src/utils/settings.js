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
  // Default ElevenLabs voice and model for TTS
  ttsVoiceId: 'D38z5RcWu1voky8WS1ja', // "Rachel"
  ttsModelId: 'eleven_flash_v2_5',
  // Streaming STT defaults
  sttSampleRate: 16000,
  sttFormattedFinals: true
};

function loadSettings() {
  try {
    const data = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return { ...defaultSettings, ...JSON.parse(data) };
  } catch (err) {
    return { ...defaultSettings };
  }
}

function saveSettings(settings) {
  const data = { ...defaultSettings, ...settings };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2));
}

module.exports = {
  SETTINGS_PATH,
  defaultSettings,
  loadSettings,
  saveSettings
};
