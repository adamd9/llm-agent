const fs = require('fs');
const os = require('os');
const path = require('path');

jest.setTimeout(30000);

describe('file system tool', () => {
  let tempDir;
  let tool;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-fs-'));
    process.env.LLM_AGENT_DATA_DIR = tempDir;
    jest.resetModules();
    tool = require('../src/tools/fileSystem');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.LLM_AGENT_DATA_DIR;
    jest.resetModules();
  });

  test('copy file into data directory', async () => {
    const src = path.join(__dirname, 'sample.txt');
    fs.writeFileSync(src, 'hello');

    const dest = path.join(tempDir, 'copied.txt');
    const res = await tool.copyFile(src, dest);
    expect(res.status).toBe('success');
    expect(fs.readFileSync(dest, 'utf8')).toBe('hello');

    fs.unlinkSync(src);
  });

  test('rename file within data directory', async () => {
    const original = path.join(tempDir, 'orig.txt');
    fs.writeFileSync(original, 'abc');
    const renamed = path.join(tempDir, 'renamed.txt');
    const res = await tool.renameFile(original, renamed);
    expect(res.status).toBe('success');
    expect(fs.existsSync(renamed)).toBe(true);
    expect(fs.existsSync(original)).toBe(false);
  });
});
