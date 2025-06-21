const express = require('express');
const fs = require('fs');
const path = require('path');
const { DATA_DIR_PATH } = require('../utils/dataDir');

const router = express.Router();

// Map of editable files
const FILES = {
  'short-term': path.join(DATA_DIR_PATH, 'memory', 'short', 'short_term.txt'),
  'long-term': path.join(DATA_DIR_PATH, 'memory', 'long', 'long_term.txt')
};

router.get('/', (req, res) => {
  const name = req.query.name;
  const filePath = FILES[name];
  if (!filePath) {
    return res.status(400).json({ error: 'Invalid file name' });
  }
  try {
    const content = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, 'utf8')
      : '';
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read file' });
  }
});

router.post('/', (req, res) => {
  const { name, content } = req.body;
  const filePath = FILES[name];
  if (!filePath) {
    return res.status(400).json({ error: 'Invalid file name' });
  }
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content || '', 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save file' });
  }
});

function registerDataFileRoutes(app) {
  app.use('/datafiles', router);
}

module.exports = { registerDataFileRoutes };
