const request = require('supertest');
const { app } = require('../src/index');
const { SETTINGS_PATH, loadSettings, saveSettings } = require('../src/utils/settings');
const fs = require('fs');

describe('/api/assemblyai-token', () => {
  afterEach(() => {
    if (fs.existsSync(SETTINGS_PATH)) fs.unlinkSync(SETTINGS_PATH);
  });

  test('returns token and stt settings', async () => {
    saveSettings({ sttSampleRate: 1234, sttFormattedFinals: false });
    process.env.ASSEMBLY_AI_KEY = 'abc';
    const res = await request(app).get('/api/assemblyai-token');
    expect(res.status).toBe(200);
    expect(res.body.sampleRate).toBe(1234);
    expect(res.body.formattedFinals).toBe(false);
    expect(res.body.token).toBe('abc');
  });
});
