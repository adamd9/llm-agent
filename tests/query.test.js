const { execSync } = require('child_process');

// Extend Jest timeout if not already
jest.setTimeout(120000);

describe('cli query', () => {
  test('returns capital of France', () => {
    const output = execSync('npm run query "What is the capital of France?"', {
      env: process.env,
      encoding: 'utf8'
    });
    expect(output).toMatch(/Paris/);
  });
});
