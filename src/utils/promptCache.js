const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR_PATH } = require('./dataDir');
const logger = require('./logger');

const CACHE_DIR = path.join(DATA_DIR_PATH, 'prompt-cache');
const CACHE_LOG_FILE = path.join(DATA_DIR_PATH, 'prompt-cache-usage.log');
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000; // 1 day in milliseconds

let stats = { hits: 0, misses: 0 };
let lastUserQuery = '';

let isInitialized = false;

function ensureCacheDir() {
  if (!fs.existsSync(DATA_DIR_PATH)) {
    fs.mkdirSync(DATA_DIR_PATH, { recursive: true });
  }
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  
  // Clean up old cache files on first initialization only
  if (!isInitialized) {
    isInitialized = true;
    // Use setImmediate to avoid blocking the main thread
    setImmediate(() => {
      cleanupOldCacheFiles().catch(err => {
        logger.error('promptCache', 'Error cleaning up old cache files', { error: err.message });
      });
    });
  }
}

function isEnabled() {
  if (process.env.DISABLE_PROMPT_CACHE === 'true') return false;
  if (process.env.ENABLE_PROMPT_CACHE === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

function getCacheKey(messages, options = {}) {
  const hash = crypto.createHash('sha1');
  
  // Create a stable copy of messages and options, removing any volatile fields
  const stableMessages = messages.map(({ role, content, name }) => ({
    role,
    content: typeof content === 'string' ? content.trim() : content,
    name
  }));
  
  // Only include relevant options in the cache key
  const stableOptions = {
    model: options.model,
    max_tokens: options.max_tokens,
    temperature: options.temperature,
    client: options.client
  };
  
  const keyData = JSON.stringify({
    messages: stableMessages,
    options: stableOptions
  });
  
  hash.update(keyData);
  const key = hash.digest('hex');
  
  logger.debug('promptCache', 'Generated cache key', { 
    key,
    messages: stableMessages,
    options: stableOptions 
  });
  
  return key;
}

function readCache(key) {
  ensureCacheDir();
  const file = path.join(CACHE_DIR, `${key}.json`);
  try {
    if (fs.existsSync(file)) {
      const data = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(data);
      
      // If this is the new format with _cacheMetadata, extract just the response data
      const responseData = parsed._cacheMetadata ? 
        Object.entries(parsed).reduce((acc, [k, v]) => {
          if (k !== '_cacheMetadata') acc[k] = v;
          return acc;
        }, {}) : parsed;
      
      stats.hits += 1;
      logger.debug('promptCache', 'Cache hit', { 
        key, 
        file: path.basename(file),
        hits: stats.hits,
        misses: stats.misses,
        hasMetadata: !!parsed._cacheMetadata
      });
      
      return responseData;
    } else {
      logger.debug('promptCache', 'Cache miss', { 
        key, 
        file: path.basename(file),
        hits: stats.hits,
        misses: stats.misses + 1 // +1 because this will be a miss
      });
    }
  } catch (err) {
    logger.error('promptCache', 'Failed to read cache file', { 
      error: err.message,
      stack: err.stack,
      key,
      file: path.basename(file)
    });
  }
  return null;
}

/**
 * Inspects a cache entry by key
 * @param {string} key - The cache key to inspect
 * @returns {Object|null} The cache metadata and data, or null if not found
 */
function inspectCache(key) {
  ensureCacheDir();
  const file = path.join(CACHE_DIR, `${key}.json`);
  try {
    if (fs.existsSync(file)) {
      const data = fs.readFileSync(file, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    logger.error('promptCache', 'Failed to inspect cache file', { 
      error: err.message,
      key,
      file: path.basename(file)
    });
  }
  return null;
}

function writeCache(key, data, messages, options) {
  ensureCacheDir();
  const file = path.join(CACHE_DIR, `${key}.json`);
  try {
    // Store both the original data and the inputs that generated the key
    const cacheData = {
      _cacheMetadata: {
        key,
        timestamp: new Date().toISOString(),
        messages,
        options
      },
      ...data
    };
    
    fs.writeFileSync(file, JSON.stringify(cacheData, null, 2), 'utf8');
    
    logger.debug('promptCache', 'Wrote to cache', { 
      key,
      file: path.basename(file),
      messagesLength: messages?.length,
      options
    });
    
    stats.misses += 1;
    return true;
  } catch (err) {
    logger.error('promptCache', 'Failed to write cache file', { 
      error: err.message,
      stack: err.stack,
      key,
      file: path.basename(file)
    });
    return false;
  }
}

/**
 * Set the last user query for logging purposes
 * @param {string} query - The user's query/message
 */
function setLastUserQuery(query) {
  lastUserQuery = query || '';
}

/**
 * Log cache usage to the log file
 * @param {Object} stats - Cache statistics
 * @param {string} userQuery - The user's query that triggered the cache check
 */
function logCacheUsage(stats, userQuery) {
  try {
    ensureCacheDir();
    const timestamp = new Date().toISOString();
    const hitRate = stats.hits + stats.misses > 0 
      ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2) 
      : 0;
    
    const logEntry = JSON.stringify({
      timestamp,
      query: userQuery,
      stats: {
        hits: stats.hits,
        misses: stats.misses,
        hitRate: `${hitRate}%`
      }
    }) + '\n';
    
    fs.appendFileSync(CACHE_LOG_FILE, logEntry, 'utf8');
    logger.debug('promptCache', 'Logged cache usage', { hits: stats.hits, misses: stats.misses, hitRate });
  } catch (error) {
    logger.error('promptCache', 'Failed to log cache usage', { error: error.message });
  }
}

function getStats() {
  return { 
    hits: stats.hits, 
    misses: stats.misses,
    hitRate: stats.hits + stats.misses > 0 
      ? (stats.hits / (stats.hits + stats.misses)) * 100 
      : 0
  };
}

function resetStats() {
  stats = { hits: 0, misses: 0 };
}

/**
 * Lists all cache entries with their metadata
 * @returns {Array} Array of cache entries with metadata
 */
/**
 * Cleans up cache files older than MAX_CACHE_AGE_MS
 * @returns {Promise<{deleted: number, errors: number}>} Count of deleted files and errors
 */
async function cleanupOldCacheFiles() {
  // Don't try to clean up if the cache directory doesn't exist
  if (!fs.existsSync(CACHE_DIR)) {
    return { deleted: 0, errors: 0 };
  }
  
  const now = Date.now();
  let deleted = 0;
  let errors = 0;
  
  try {
    const files = fs.readdirSync(CACHE_DIR);
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      const filePath = path.join(CACHE_DIR, file);
      
      try {
        const stats = fs.statSync(filePath);
        const fileAge = now - stats.mtimeMs;
        
        if (fileAge > MAX_CACHE_AGE_MS) {
          fs.unlinkSync(filePath);
          logger.debug('promptCache', 'Deleted old cache file', {
            file,
            ageHours: Math.round(fileAge / (60 * 60 * 1000) * 100) / 100
          });
          deleted++;
        }
      } catch (err) {
        // Don't log ENOENT errors as they're likely due to race conditions
        if (err.code !== 'ENOENT') {
          logger.error('promptCache', 'Error cleaning up cache file', {
            file,
            error: err.message
          });
          errors++;
        }
      }
    }
    
    if (deleted > 0) {
      logger.info('promptCache', `Cleaned up ${deleted} old cache files`);
    }
    
    return { deleted, errors };
  } catch (err) {
    // Don't log ENOENT errors as they're likely due to race conditions
    if (err.code !== 'ENOENT') {
      logger.error('promptCache', 'Failed to clean up cache files', {
        error: err.message
      });
      return { deleted, errors: errors + 1 };
    }
    return { deleted, errors };
  }
}

function listCacheEntries() {
  ensureCacheDir();
  try {
    const files = fs.readdirSync(CACHE_DIR);
    const entries = [];
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      try {
        const filePath = path.join(CACHE_DIR, file);
        const stats = fs.statSync(filePath);
        const data = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(data);
        
        entries.push({
          key: file.replace(/\.json$/, ''),
          timestamp: parsed._cacheMetadata?.timestamp || 'unknown',
          mtime: stats.mtime,
          ageMs: Date.now() - stats.mtimeMs,
          messages: parsed._cacheMetadata?.messages || [],
          options: parsed._cacheMetadata?.options || {},
          size: Buffer.byteLength(data, 'utf8'),
          hasMetadata: !!parsed._cacheMetadata
        });
      } catch (err) {
        logger.error('promptCache', 'Error reading cache file', { 
          file, 
          error: err.message 
        });
      }
    }
    
    // Sort by timestamp (newest first)
    entries.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    
    return entries;
  } catch (err) {
    logger.error('promptCache', 'Failed to list cache entries', { 
      error: err.message 
    });
    return [];
  }
}

module.exports = {
  isEnabled,
  getCacheKey,
  readCache,
  writeCache,
  getStats,
  resetStats,
  setLastUserQuery,
  logCacheUsage,
  inspectCache,
  listCacheEntries
};
