const { execSync } = require('child_process');

jest.setTimeout(120000);

describe('reflection', () => {
  test('completes reflection', () => {
    const output = execSync('node src/index.js "Reflect on this"', {
      env: process.env,
      encoding: 'utf8'
    });
    expect(output).toMatch(/reflection: Starting reflection process/);
  });
});
