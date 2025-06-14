// Triggering nodemon restart
const express = require("express");
const core = require('./core');
const WebSocket = require("ws");
const http = require("http");
const logger = require("./utils/logger");
const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const SessionManager = require("./session/SessionManager");
const ChatLogWriter = require("./session/ChatLogWriter");
const { loadSettings } = require('./utils/settings');
const toolManager = require('./mcp');
const scheduler = core.scheduler;
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// Ensure .env variables are loaded
require('dotenv').config();

// --- AssemblyAI Temporary Token Endpoint ---
app.get('/api/assemblyai-token', (req, res) => {
  const apiKey = process.env.ASSEMBLY_AI_KEY;
  if (!apiKey) {
    logger.error('assemblyai-token', 'ASSEMBLY_AI_KEY not found in environment variables.');
    return res.status(500).json({ error: 'AssemblyAI API key not configured on server.' });
  }
  // For actual AssemblyAI V3, this should be exchanged for a temporary session token.
  // For now, returning the API key directly for testing.
  logger.debug('assemblyai-token', 'Returning AssemblyAI API key (for temporary testing).');
  const settings = loadSettings();
  res.json({
    token: apiKey,
    sampleRate: settings.sttSampleRate,
    formattedFinals: settings.sttFormattedFinals,
    autoSendDelayMs: settings.autoSendDelayMs
  });
});
// --- End AssemblyAI Endpoint ---

// --- Start Utterance Check Endpoint ---
app.post('/api/utterance-check', async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }
  try {
    const { getClient } = require('./utils/llmClient');
    const client = getClient('openai');
    const settings = loadSettings();
    const result = await client.chat([
      { role: 'system', content: 'Respond with JSON {"complete":true|false}. Determine if the user content is a complete question or sentence and does not appear cut off.' },
      { role: 'user', content: text }
    ], {
      model: settings.utteranceCheckModel || 'gpt-4.1-nano',
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(result.content);
    res.json({ complete: !!parsed.complete });
  } catch (err) {
    logger.error('utterance-check', 'LLM check failed', err);
    res.status(500).json({ error: 'LLM check failed' });
  }
});

// +++ Start ElevenLabs TTS Streaming Endpoint +++
app.post('/api/tts/elevenlabs-stream', async (req, res) => {
    const settings = loadSettings();
    const {
        text,
        voice_id = settings.ttsVoiceId,
        model_id = settings.ttsModelId
    } = req.body;

    if (!text) {
        logger.error('elevenlabs-tts', 'Text is required for TTS.');
        return res.status(400).json({ error: 'Text is required.' });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    logger.debug('elevenlabs-tts', 'Using ElevenLabs API key:', { 
        keyPresent: !!apiKey,
        keyLength: apiKey ? apiKey.length : 0,
        keyPrefix: apiKey ? apiKey.substring(0, 5) + '...' : 'N/A'
    });
    
    if (!apiKey) {
        logger.error('elevenlabs-tts', 'ELEVENLABS_API_KEY not found in environment variables.');
        return res.status(500).json({ error: 'ElevenLabs API key not configured on server.' });
    }

    try {
        logger.debug('elevenlabs-tts', 'Requesting TTS stream from ElevenLabs', { text, voice_id, model_id });
        const elevenlabs = new ElevenLabsClient({ apiKey });

        const audioStream = await elevenlabs.textToSpeech.stream(voice_id, {
            text,
            model_id,
            output_format: 'mp3_44100_128', // Explicitly set output format
            // optimize_streaming_latency: 0, // Optional: latency optimization
        });

        res.setHeader('Content-Type', 'audio/mpeg'); // Adjust if you use a different output format

        // Pipe the stream to the response
        res.setHeader('Content-Type', 'audio/mpeg');
        for await (const chunk of audioStream) {
            res.write(chunk);
        }
        res.end();
        logger.debug('elevenlabs-tts', 'Successfully streamed all audio to client and ended response.');
    } catch (error) {
        logger.error('elevenlabs-tts', 'Error processing ElevenLabs TTS request', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to process TTS request.' });
        }
    }
});
// +++ End ElevenLabs TTS Streaming Endpoint +++




// Get initial message from command line args
const initialMessage = process.argv[2];

// Initialize ego instance
const ego = new core.Ego(["llmquery", "file-system"]);

const { registerSettingsRoutes } = require('./routes/settingsPage');
registerSettingsRoutes(app, { ego, toolManager });



async function startServer() {
    const settings = loadSettings();
    await toolManager.initialize();
    await ego.initialize();

    const chatLogWriter = new ChatLogWriter({
        chatLogPath: settings.session?.chat_log_path,
        logRotateMb: settings.session?.log_rotate_mb
    });
    const sessionManager = new SessionManager(ego, {
        idleTimeoutSec: settings.session?.idle_timeout_sec,
        retainExchanges: settings.session?.retain_exchanges,
        chatLogWriter
    });
    await scheduler.initialize(sessionManager);

    if (initialMessage) {
        await sessionManager.handleMessage(initialMessage);
        await new Promise(r => setTimeout(r, 4000));
        return;
    }

    const server = http.createServer(app);
    const wss = new WebSocket.Server({ server });

    wss.on('connection', (ws) => {
        sessionManager.addClient(ws);
        ws.on('message', async (msg) => {
            try {
                const data = JSON.parse(msg);
                
                // Handle cancel request
                if (data.type === 'cancel') {
                    const result = await sessionManager.cancelProcessing();
                    ws.send(JSON.stringify({ 
                        type: 'cancelResult', 
                        success: !result.error,
                        message: result.message || (result.error ? 'Failed to cancel' : 'Processing cancelled')
                    }));
                    return;
                }
                
                // Handle session sleep/cleanup request (legacy: reset)
                if (data.type === 'sleep' || data.type === 'reset') {
                    const options = {
                        clearHistory: data.clearHistory === true,
                        consolidateMemory: data.consolidateMemory !== false,
                        reason: data.reason || 'user-requested'
                    };

                    const result = await sessionManager.sleep(options);
                    ws.send(JSON.stringify({
                        type: 'sleepResult',
                        success: !result.error,
                        message: result.message || (result.error ? 'Failed to enter sleep mode' : 'Sleep successful')
                    }));
                    return;
                }
                
                // Handle normal messages
                if (data.message) {
                    const res = await sessionManager.handleMessage(data.message);
                    if (res && res.error) ws.send(JSON.stringify({ type: 'busy' }));
                }
            } catch (err) {
                ws.send(JSON.stringify({ type: 'error', error: { message: err.message } }));
            }
        });
    });

    app.get('/chat/history', (req, res) => {
        res.json(sessionManager.history);
    });

    if (require.main === module) {
        const port = process.env.PORT || 3000;
        server.listen(port, () => {
            logger.debug('server', `Server running on port ${port}`);
        });
    }
}

if (require.main === module) {
    startServer();
}

module.exports = { app, startServer, ego, toolManager };
