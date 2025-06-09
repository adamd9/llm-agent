const request = require('supertest');
const { app } = require('../src/index');

describe('/api/utterance-check', () => {
  test('returns boolean result', async () => {
    const res = await request(app)
      .post('/api/utterance-check')
      .send({ text: 'Is this a full sentence?' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('complete');
  });
});
