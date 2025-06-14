// Triggering nodemon restart
const express = require("express");
const core = require('./core');
const WebSocket = require("ws");
const http = require("http");
const logger = require("./utils/logger");
const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const SessionManager = require("./session/SessionManager");
const ChatLogWriter = require("./session/ChatLogWriter");
const { loadSettings, saveSettings, loadRawSettings, defaultSettings } = require('./utils/settings');
const toolManager = require('./mcp');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// Simple settings page
app.get('/settings', (req, res) => {
    const raw = loadRawSettings();
    const effective = loadSettings();
    const defaults = defaultSettings;
    const baseModel = defaults.llmModel;

    const tools = toolManager.getAllTools().map(t => `${t.name} (${t.source})`);
    const failedTools = toolManager.getFailedTools();
    const personalityInfo = ego.personality ? `${ego.personality.name} (${ego.personality.source})` : 'None';
    const shortMem = core.memory.getShortTermMemory();
    const longMem = core.memory.getLongTermMemory();

    const html = `<!DOCTYPE html>
<html><head><title>Settings</title>
<style>.tab{display:none;} .tab.active{display:block;}</style>
<script>function showTab(id){document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));document.getElementById(id).classList.add('active');}</script>
</head><body>
<h1>App Settings</h1>
<div><button onclick="showTab('general')">General</button><button onclick="showTab('prompts')">Prompts</button><button onclick="showTab('stats')">Stats</button></div>
<div id="general" class="tab active">
<form method="POST" action="/settings">
  <label>LLM Model:<input type="text" name="llmModel" value="${raw.llmModel ?? ''}" placeholder="${defaults.llmModel}" /></label><br/>
  <label>Planner Model:<input type="text" name="plannerModel" value="${raw.plannerModel ?? ''}" placeholder="${defaults.plannerModel || baseModel}" /></label><br/>
  <label>Evaluator Model:<input type="text" name="evaluatorModel" value="${raw.evaluatorModel ?? ''}" placeholder="${defaults.evaluatorModel || baseModel}" /></label><br/>
  <label>Query Model:<input type="text" name="queryModel" value="${raw.queryModel ?? ''}" placeholder="${defaults.queryModel || baseModel}" /></label><br/>
  <label>Bubble Model:<input type="text" name="bubbleModel" value="${raw.bubbleModel ?? ''}" placeholder="${defaults.bubbleModel || baseModel}" /></label><br/>
  <label>Reflection Model:<input type="text" name="reflectionModel" value="${raw.reflectionModel ?? ''}" placeholder="${defaults.reflectionModel || baseModel}" /></label><br/>
  <label>Utterance Check Model:<input type="text" name="utteranceCheckModel" value="${raw.utteranceCheckModel ?? ''}" placeholder="${defaults.utteranceCheckModel}" /></label><br/>
  <label>LLM Max Tokens:<input type="number" name="maxTokens" value="${raw.maxTokens ?? ''}" placeholder="${defaults.maxTokens}" /></label><br/>
  <label>TTS Voice ID:<input type="text" name="ttsVoiceId" value="${raw.ttsVoiceId ?? ''}" placeholder="${defaults.ttsVoiceId}" /></label><br/>
  <label>TTS Model ID:<input type="text" name="ttsModelId" value="${raw.ttsModelId ?? ''}" placeholder="${defaults.ttsModelId}" /></label><br/>
  <label>STT Sample Rate:<input type="number" name="sttSampleRate" value="${raw.sttSampleRate ?? ''}" placeholder="${defaults.sttSampleRate}" /></label><br/>
  <label>STT Formatted Finals:<input type="checkbox" name="sttFormattedFinals" ${effective.sttFormattedFinals ? 'checked' : ''} /></label><br/>
  <label>Auto-send Delay (ms):<input type="number" name="autoSendDelayMs" value="${raw.autoSendDelayMs ?? ''}" placeholder="${defaults.autoSendDelayMs}" /></label><br/>
  <label>Use Prompt Overrides:<input type="checkbox" name="usePromptOverrides" ${effective.usePromptOverrides ? 'checked' : ''} /></label><br/>
  <button type="submit">Save</button>
</form>
</div>
<div id="prompts" class="tab">
  <p>Place prompt override files in <code>data/prompts/&lt;module&gt;/&lt;PROMPTNAME&gt;.txt</code>.</p>
</div>
<div id="stats" class="tab">
  <h3>Loaded Tools</h3>
  <ul>
    ${tools.map(t => `<li>${t}</li>`).join('') || '<li>None</li>'}
  </ul>
  <h3>Failed Tools</h3>
  <ul>
    ${failedTools.map(t => `<li>${t.name}: ${t.error}</li>`).join('') || '<li>None</li>'}
  </ul>
  <h3>Personality</h3>
  <p>${personalityInfo}</p>
  <h3>Short Term Memory</h3>
  <pre>${shortMem.replace(/</g,'&lt;')}</pre>
  <h3>Long Term Memory</h3>
  <pre>${longMem.replace(/</g,'&lt;')}</pre>
</div>
</body></html>`;
    res.send(html);
});

app.post('/settings', (req, res) => {
    const newSettings = {};
    const assign = (field, transform) => {
        const val = req.body[field];
        if (val === undefined) return;
        if (val !== '') newSettings[field] = transform ? transform(val) : val;
    };

    assign('llmModel');
    assign('plannerModel');
    assign('evaluatorModel');
    assign('queryModel');
    assign('bubbleModel');
    assign('reflectionModel');
    assign('utteranceCheckModel');
    assign('maxTokens', v => parseInt(v, 10));
    assign('ttsVoiceId');
    assign('ttsModelId');
    assign('sttSampleRate', v => parseInt(v, 10));
    newSettings.sttFormattedFinals = req.body.sttFormattedFinals ? true : false;
    assign('autoSendDelayMs', v => parseInt(v, 10));
    newSettings.usePromptOverrides = req.body.usePromptOverrides ? true : false;

    saveSettings(newSettings);
    res.redirect('/settings');
});

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
                
                // Handle session reset request
                if (data.type === 'reset') {
                    const options = {
                        clearHistory: data.clearHistory === true,
                        consolidateMemory: data.consolidateMemory !== false,
                        reason: data.reason || 'user-requested'
                    };
                    
                    const result = await sessionManager.resetSession(options);
                    ws.send(JSON.stringify({
                        type: 'resetResult',
                        success: !result.error,
                        message: result.message || (result.error ? 'Failed to reset session' : 'Session reset successful')
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
