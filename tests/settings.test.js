const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { app } = require('../src/index');
const { SETTINGS_PATH, loadSettings, defaultSettings } = require('../src/utils/settings');

// Skip tests in development mode to preserve user settings
const isDevelopment = process.env.NODE_ENV === 'development';
const runTest = isDevelopment ? test.skip : test;

describe('/settings page', () => {
  // Only clean up settings in test mode
  afterEach(() => {
    if (!isDevelopment && fs.existsSync(SETTINGS_PATH)) {
      fs.unlinkSync(SETTINGS_PATH);
    }
  });

  runTest('default settings provide maxTokens', () => {
    const settings = loadSettings();
    expect(settings.maxTokens).toBe(defaultSettings.maxTokens);
    expect(settings.autoSendDelayMs).toBe(defaultSettings.autoSendDelayMs);
    expect(settings.usePromptOverrides).toBe(true);
  });

  runTest('GET /settings returns page', async () => {
    const res = await request(app).get('/settings');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/App Settings/);
    expect(res.text).toMatch(/Stats/);
  });

  runTest('POST /settings saves file', async () => {
    const res = await request(app)
      .post('/settings')
      .type('form')
      .send({
        llmModel: 'testLLM',
        plannerModel: 'planModel',
        evaluatorModel: 'evalModel',
        queryModel: 'queryModel',
        bubbleModel: 'bubbleModel',
        memoryModel: 'memoryModel',
        utteranceCheckModel: 'nano-model',
        maxTokens: 1500,
        ttsVoiceId: 'voiceX',
        ttsModelId: 'modelY',
        sttSampleRate: 8000,
        sttFormattedFinals: 'on',
        autoSendDelayMs: 3000,
        usePromptOverrides: 'on'
      });
    expect(res.status).toBe(302);
    const saved = loadSettings();
    expect(saved.llmModel).toBe('testLLM');
    expect(saved.plannerModel).toBe('planModel');
    expect(saved.evaluatorModel).toBe('evalModel');
    expect(saved.queryModel).toBe('queryModel');
    expect(saved.bubbleModel).toBe('bubbleModel');
    expect(saved.memoryModel).toBe('memoryModel');
    expect(saved.utteranceCheckModel).toBe('nano-model');
    expect(saved.maxTokens).toBe(1500);
    expect(saved.ttsVoiceId).toBe('voiceX');
    expect(saved.ttsModelId).toBe('modelY');
    expect(saved.sttSampleRate).toBe(8000);
    expect(saved.sttFormattedFinals).toBe(true);
    expect(saved.autoSendDelayMs).toBe(3000);
    expect(saved.usePromptOverrides).toBe(true);
  });

  runTest('POST /settings clears to default when blank', async () => {
    // Set a custom model first
    await request(app)
      .post('/settings')
      .type('form')
      .send({ llmModel: 'custom-model', memoryModel: 'memCustom' });

    // Clear the model
    await request(app)
      .post('/settings')
      .type('form')
      .send({ llmModel: '', memoryModel: '' });

    const saved = loadSettings();
    expect(saved.llmModel).toBe(defaultSettings.llmModel);
    expect(saved.memoryModel).toBe(defaultSettings.memoryModel);
    expect(saved.maxTokens).toBe(defaultSettings.maxTokens);
    expect(saved.usePromptOverrides).toBe(false);
  });
});
