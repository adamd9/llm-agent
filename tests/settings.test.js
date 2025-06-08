const request = require('supertest');
const fs = require('fs');
const { app } = require('../src/index');
const { SETTINGS_PATH, loadSettings } = require('../src/utils/settings');

describe('/settings page', () => {
  afterEach(() => {
    if (fs.existsSync(SETTINGS_PATH)) {
      fs.unlinkSync(SETTINGS_PATH);
    }
  });

  test('GET /settings returns page', async () => {
    const res = await request(app).get('/settings');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/App Settings/);
  });

  test('POST /settings saves file', async () => {
    const res = await request(app)
      .post('/settings')
      .type('form')
      .send({
        llmModel: 'testLLM',
        plannerModel: 'planModel',
        evaluatorModel: 'evalModel',
        queryModel: 'queryModel',
        bubbleModel: 'bubbleModel',
        ttsVoiceId: 'voiceX',
        ttsModelId: 'modelY',
        sttSampleRate: 8000,
        sttFormattedFinals: 'on'
      });
    expect(res.status).toBe(302);
    const saved = loadSettings();
    expect(saved.llmModel).toBe('testLLM');
    expect(saved.plannerModel).toBe('planModel');
    expect(saved.evaluatorModel).toBe('evalModel');
    expect(saved.queryModel).toBe('queryModel');
    expect(saved.bubbleModel).toBe('bubbleModel');
    expect(saved.ttsVoiceId).toBe('voiceX');
    expect(saved.ttsModelId).toBe('modelY');
    expect(saved.sttSampleRate).toBe(8000);
    expect(saved.sttFormattedFinals).toBe(true);
  });

  test('POST /settings clears to default when blank', async () => {
    // Set a custom model first
    await request(app)
      .post('/settings')
      .type('form')
      .send({ llmModel: 'custom-model' });

    // Clear the model
    await request(app)
      .post('/settings')
      .type('form')
      .send({ llmModel: '' });

    const saved = loadSettings();
    expect(saved.llmModel).toBe('gpt-4.1');
  });
});
