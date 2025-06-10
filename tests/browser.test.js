const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

jest.setTimeout(120000);

function waitForServer(url, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      fetch(url)
        .then(res => res.ok && resolve())
        .catch(() => {
          if (Date.now() - start > timeout) reject(new Error('Server did not start'));
          else setTimeout(check, 1000);
        });
    };
    check();
  });
}

describe('frontend', () => {
  let server;
  let browser;

  beforeAll(async () => {
    server = spawn('node', ['src/index.js'], { env: { ...process.env, PORT: '3010' } });
    await waitForServer('http://localhost:3010');
    browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  });

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) server.kill();
  });

  test('send message and receive response with canvas', async () => {
    const page = await browser.newPage();
    await page.goto('http://localhost:3010');
    await page.waitForSelector('#chatInput:not([disabled])');
    await page.type('#chatInput', 'What is 2 + 2?');
    await page.click('#send-button');
    await page.waitForSelector('#messages .message.assistant .message-content');
    const chatText = await page.$eval('#messages .message.assistant .message-content', el => el.textContent.trim());
    expect(chatText.length).toBeGreaterThan(0);
    const canvasHtml = await page.$eval('#canvas-content', el => el.innerHTML.trim());
    expect(canvasHtml.length).toBeGreaterThan(0);
    await page.close();
  });
});
