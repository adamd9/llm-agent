const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR_PATH } = require('./dataDir');
const logger = require('./logger');

const CACHE_DIR = path.join(DATA_DIR_PATH, 'prompt-cache');

let stats = { hits: 0, misses: 0 };

function ensureCacheDir() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
  } catch (err) {
    logger.error('promptCache', 'Failed to create cache dir', err);
  }
}

function isEnabled() {
  if (process.env.DISABLE_PROMPT_CACHE === 'true') return false;
  if (process.env.ENABLE_PROMPT_CACHE === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

function getCacheKey(messages, options = {}) {
  const hash = crypto.createHash('sha1');
  hash.update(JSON.stringify({ messages, options }));
  return hash.digest('hex');
}

function readCache(key) {
  ensureCacheDir();
  const file = path.join(CACHE_DIR, `${key}.json`);
  try {
    if (fs.existsSync(file)) {
      const data = fs.readFileSync(file, 'utf8');
      stats.hits += 1;
      return JSON.parse(data);
    }
  } catch (err) {
    logger.error('promptCache', 'Failed to read cache file', err);
  }
  return null;
}

function writeCache(key, data) {
  ensureCacheDir();
  const file = path.join(CACHE_DIR, `${key}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    stats.misses += 1;
  } catch (err) {
    logger.error('promptCache', 'Failed to write cache file', err);
  }
}

function getStats() {
  return { hits: stats.hits, misses: stats.misses };
}

function resetStats() {
  stats = { hits: 0, misses: 0 };
}

module.exports = {
  isEnabled,
  getCacheKey,
  readCache,
  writeCache,
  getStats,
  resetStats
};
