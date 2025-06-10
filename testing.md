# Testing Guide

This project uses **Jest** for unit and integration tests. A small suite of
browser tests powered by **Puppeteer** exercises the front‑end.

## Running Tests

Install dependencies and run:

```bash
npm test
```

All server and browser tests will execute. Browser tests launch a headless
Chromium instance via Puppeteer. The test suite automatically starts the Node.js
server on port `3010` and terminates it when the test finishes.

If running inside a container or CI environment, ensure the necessary Chromium
dependencies are installed. The Puppeteer launch configuration uses the `--no-sandbox`
flag for compatibility.

## Prompt Caching

During testing and development, LLM responses are cached under
`data/prompt-cache`. The cache is enabled automatically when
`NODE_ENV` is not `production`. Set `DISABLE_PROMPT_CACHE=true` to
force live requests or `ENABLE_PROMPT_CACHE=true` to override in other
environments.


## Test Files

- `tests/query.test.js` &ndash; CLI interaction
- `tests/settings.test.js` &ndash; configuration logic
- `tests/reflection.test.js` &ndash; reflection subsystem
- `tests/assemblyToken.test.js` &ndash; assembly token retrieval
- `tests/browser.test.js` &ndash; end‑to‑end UI test using Puppeteer