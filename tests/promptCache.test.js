const fs = require('fs');
const os = require('os');
const path = require('path');

jest.setTimeout(30000);

const mockCreate = jest.fn();
jest.mock('openai', () => {
  return {
    OpenAI: jest.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } }
    })),
    mockCreate
  };
});

const { OpenAI } = require('openai'); // ensures mock applied

const promptMessage = [{ role: 'user', content: 'hello' }];

function createClient(tempDir) {
  process.env.LLM_AGENT_DATA_DIR = tempDir;
  process.env.OPENAI_API_KEY = 'test-key';
  const { getClient } = require('../src/utils/llmClient');
  return getClient('openai');
}

describe('prompt cache', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-cache-'));
    mockCreate.mockReset();
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.LLM_AGENT_DATA_DIR;
    delete process.env.OPENAI_API_KEY;
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.resetModules();
  });

  test('uses cached response on second call', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'hi' } }] });
    const client = createClient(tempDir);
    const promptCache = require('../src/utils/promptCache');

    const res1 = await client.chat(promptMessage);
    expect(res1.content).toBe('hi');
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const res2 = await client.chat(promptMessage);
    expect(res2.content).toBe('hi');
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const stats = promptCache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });
});
