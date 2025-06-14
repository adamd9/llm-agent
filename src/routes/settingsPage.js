const core = require('../core');
const express = require('express');
const { loadSettings, saveSettings, loadRawSettings, defaultSettings } = require('../utils/settings');

function registerSettingsRoutes(app, { ego, toolManager }) {
  const router = express.Router();

  router.get('/', (req, res) => {
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
<link rel="stylesheet" href="/styles/main.css">
<style>
.settings-tab{display:none;}
.settings-tab.active{display:block;}
.settings-tabs button{background:#f5f5f5;border:1px solid #e0e0e0;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:12px;color:#666;margin-left:8px;transition:all 0.2s;}
.settings-tabs button.active{background:#007bff;color:#fff;border-color:#0056b3;}
</style>
<script>
function showTab(id){document.querySelectorAll('.settings-tab').forEach(t=>t.classList.remove('active'));document.getElementById(id).classList.add('active');
var buttons=document.querySelectorAll('.settings-tabs button');buttons.forEach(b=>{if(b.dataset.tab===id){b.classList.add('active');}else{b.classList.remove('active');}});
}
</script>
</head><body>
<div class="modal-content" style="margin:40px auto;">
  <div class="modal-header">
    <h3>App Settings</h3>
    <div class="settings-tabs">
      <button data-tab="general" class="active" onclick="showTab('general')">General</button>
      <button data-tab="prompts" onclick="showTab('prompts')">Prompts</button>
      <button data-tab="stats" onclick="showTab('stats')">Stats</button>
    </div>
  </div>
  <div class="modal-body">
    <div id="general" class="settings-tab active">
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
    <div id="prompts" class="settings-tab">
      <p>Place prompt override files in <code>data/prompts/&lt;module&gt;/&lt;PROMPTNAME&gt;.txt</code>.</p>
    </div>
    <div id="stats" class="settings-tab">
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
  </div>
</div>
</body></html>`;
    res.send(html);
  });

  router.post('/', (req, res) => {
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

  app.use('/settings', router);
}

module.exports = { registerSettingsRoutes };
