const core = require('../core');
const express = require('express');
const { loadSettings, saveSettings, loadRawSettings, defaultSettings } = require('../utils/settings');

function registerSettingsRoutes(app, { ego, toolManager }) {
  const router = express.Router();
  
  // Helper function to generate settings content
  function generateSettingsContent() {
    const raw = loadRawSettings();
    const effective = loadSettings();
    const defaults = defaultSettings;
    const baseModel = defaults.llmModel;

    const tools = toolManager.getAllTools().map(t => `${t.name} (${t.source})`);
    const failedTools = toolManager.getFailedTools();
    const personalityInfo = ego.personality ? `${ego.personality.name} (${ego.personality.source})` : 'None';
    const shortMem = core.memory.getShortTermMemory();
    const longMem = core.memory.getLongTermMemory();
    
    // Calculate token estimates (using the same method as in llmClient)
    const estimateTokens = (text) => Math.ceil((text || '').length / 4);
    const shortMemTokens = estimateTokens(shortMem);
    const longMemTokens = estimateTokens(longMem);
    
    return {
      raw,
      effective,
      defaults,
      baseModel,
      tools,
      failedTools,
      personalityInfo,
      shortMem,
      longMem,
      shortMemTokens,
      longMemTokens
    };
  }
  
  // API endpoint for the overlay
  router.get('/api', (req, res) => {
    const content = generateSettingsContent();
    const raw = content.raw;
    const effective = content.effective;
    const defaults = content.defaults;
    const baseModel = content.baseModel;
    const tools = content.tools;
    const failedTools = content.failedTools;
    const personalityInfo = content.personalityInfo;
    const shortMem = content.shortMem;
    const longMem = content.longMem;
    const shortMemTokens = content.shortMemTokens;
    const longMemTokens = content.longMemTokens;
    
    const generalContent = `
      <form id="settings-form" method="POST" action="/settings">
        <label>
          <span class="setting-name">LLM Model:</span>
          <span class="setting-input"><input type="text" name="llmModel" value="${raw.llmModel ?? ''}" placeholder="${defaults.llmModel}" /></span>
        </label>
        <label>
          <span class="setting-name">Planner Model:</span>
          <span class="setting-input"><input type="text" name="plannerModel" value="${raw.plannerModel ?? ''}" placeholder="${defaults.plannerModel || baseModel}" /></span>
        </label>
        <label>
          <span class="setting-name">Evaluator Model:</span>
          <span class="setting-input"><input type="text" name="evaluatorModel" value="${raw.evaluatorModel ?? ''}" placeholder="${defaults.evaluatorModel || baseModel}" /></span>
        </label>
        <label>
          <span class="setting-name">Query Model:</span>
          <span class="setting-input"><input type="text" name="queryModel" value="${raw.queryModel ?? ''}" placeholder="${defaults.queryModel || baseModel}" /></span>
        </label>
        <label>
          <span class="setting-name">Bubble Model:</span>
          <span class="setting-input"><input type="text" name="bubbleModel" value="${raw.bubbleModel ?? ''}" placeholder="${defaults.bubbleModel || baseModel}" /></span>
        </label>
        <label>
          <span class="setting-name">Reflection Model:</span>
          <span class="setting-input"><input type="text" name="reflectionModel" value="${raw.reflectionModel ?? ''}" placeholder="${defaults.reflectionModel || baseModel}" /></span>
        </label>
        <label>
          <span class="setting-name">Memory Model:</span>
          <span class="setting-input"><input type="text" name="memoryModel" value="${raw.memoryModel ?? ''}" placeholder="${defaults.memoryModel || baseModel}" /></span>
        </label>
        <label>
          <span class="setting-name">Utterance Check Model:</span>
          <span class="setting-input"><input type="text" name="utteranceCheckModel" value="${raw.utteranceCheckModel ?? ''}" placeholder="${defaults.utteranceCheckModel}" /></span>
        </label>
        <label>
          <span class="setting-name">LLM Max Tokens:</span>
          <span class="setting-input"><input type="number" name="maxTokens" value="${raw.maxTokens ?? ''}" placeholder="${defaults.maxTokens}" /></span>
        </label>
        <label>
          <span class="setting-name">Token Limit:</span>
          <span class="setting-input"><input type="number" name="tokenLimit" value="${raw.tokenLimit ?? ''}" placeholder="${defaults.tokenLimit}" /></span>
        </label>
        <label>
          <span class="setting-name">TTS Voice ID:</span>
          <span class="setting-input"><input type="text" name="ttsVoiceId" value="${raw.ttsVoiceId ?? ''}" placeholder="${defaults.ttsVoiceId}" /></span>
        </label>
        <label>
          <span class="setting-name">TTS Model ID:</span>
          <span class="setting-input"><input type="text" name="ttsModelId" value="${raw.ttsModelId ?? ''}" placeholder="${defaults.ttsModelId}" /></span>
        </label>
        <label>
          <span class="setting-name">STT Sample Rate:</span>
          <span class="setting-input"><input type="number" name="sttSampleRate" value="${raw.sttSampleRate ?? ''}" placeholder="${defaults.sttSampleRate}" /></span>
        </label>
        <label>
          <span class="setting-name">STT Formatted Finals:</span>
          <span class="setting-input"><input type="checkbox" name="sttFormattedFinals" ${effective.sttFormattedFinals ? 'checked' : ''} /></span>
        </label>
        <label>
          <span class="setting-name">Auto-send Delay (ms):</span>
          <span class="setting-input"><input type="number" name="autoSendDelayMs" value="${raw.autoSendDelayMs ?? ''}" placeholder="${defaults.autoSendDelayMs}" /></span>
        </label>
        <label>
          <span class="setting-name">Use Prompt Overrides:</span>
          <span class="setting-input"><input type="checkbox" name="usePromptOverrides" ${effective.usePromptOverrides ? 'checked' : ''} /></span>
        </label>
        <div class="settings-actions">
          <button type="button" class="cancel-btn" onclick="toggleSettings()">Cancel</button>
          <button type="submit" class="save-settings-btn">Save</button>
        </div>
      </form>
    `;
    
    const promptsContent = `
      <p>Place prompt override files in <code>data/prompts/&lt;module&gt;/&lt;PROMPTNAME&gt;.txt</code>.</p>
    `;
    
    const statsContent = `
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
      <details>
        <summary><h3 style="display:inline">Short Term Memory</h3> <span class="token-count">(~${shortMemTokens} tokens)</span></summary>
        <pre>${shortMem.replace(/</g,'&lt;')}</pre>
      </details>
      <details>
        <summary><h3 style="display:inline">Long Term Memory</h3> <span class="token-count">(~${longMemTokens} tokens)</span></summary>
        <pre>${longMem.replace(/</g,'&lt;')}</pre>
      </details>
    `;

    const filesContent = `
      <div id="file-editor">
        <label>Select File:
          <select id="datafile-select" onchange="loadDataFile()">
            <option value="short-term">short_term.txt</option>
            <option value="long-term">long_term.txt</option>
          </select>
        </label>
        <textarea id="datafile-content" rows="10" style="width:100%;"></textarea>
        <div class="settings-actions">
          <button type="button" onclick="saveDataFile()">Save</button>
        </div>
      </div>
    `;

    res.json({
      general: generalContent,
      prompts: promptsContent,
      stats: statsContent,
      files: filesContent
    });
  });

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
function loadDataFile(){const s=document.getElementById('datafile-select');const t=document.getElementById('datafile-content');if(!s||!t)return;fetch('/datafiles?name='+encodeURIComponent(s.value)).then(r=>r.json()).then(d=>{t.value=d.content||'';});}
function saveDataFile(){const s=document.getElementById('datafile-select');const t=document.getElementById('datafile-content');if(!s||!t)return;fetch('/datafiles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:s.value,content:t.value})}).then(r=>r.json()).then(d=>{alert(d.success?'File saved':'Failed to save file');});}
</script>
</head><body>
<div class="modal-content" style="margin:40px auto;">
  <div class="modal-header">
    <h3>App Settings</h3>
    <div class="settings-tabs">
      <button data-tab="general" class="active" onclick="showTab('general')">General</button>
      <button data-tab="prompts" onclick="showTab('prompts')">Prompts</button>
      <button data-tab="stats" onclick="showTab('stats')">Stats</button>
      <button data-tab="files" onclick="showTab('files')">Files</button>
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
        <label>Memory Model:<input type="text" name="memoryModel" value="${raw.memoryModel ?? ''}" placeholder="${defaults.memoryModel || baseModel}" /></label><br/>
        <label>Utterance Check Model:<input type="text" name="utteranceCheckModel" value="${raw.utteranceCheckModel ?? ''}" placeholder="${defaults.utteranceCheckModel}" /></label><br/>
        <label>LLM Max Tokens:<input type="number" name="maxTokens" value="${raw.maxTokens ?? ''}" placeholder="${defaults.maxTokens}" /></label><br/>
        <label>Token Limit:<input type="number" name="tokenLimit" value="${raw.tokenLimit ?? ''}" placeholder="${defaults.tokenLimit}" /></label><br/>
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
    <div id="files" class="settings-tab">
      <div id="file-editor">
        <label>Select File:
          <select id="datafile-select" onchange="loadDataFile()">
            <option value="short-term">short_term.txt</option>
            <option value="long-term">long_term.txt</option>
          </select>
        </label><br/>
        <textarea id="datafile-content" rows="10" style="width:100%;"></textarea><br/>
        <button type="button" onclick="saveDataFile()">Save</button>
      </div>
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
      if (val === undefined) {
        return;
      }
      if (val === '') {
        newSettings[field] = '';
        return;
      }
      newSettings[field] = transform ? transform(val) : val;
    };

    assign('llmModel');
    assign('plannerModel');
    assign('evaluatorModel');
    assign('queryModel');
    assign('bubbleModel');
    assign('reflectionModel');
    assign('memoryModel');
    assign('utteranceCheckModel');
    assign('maxTokens', v => parseInt(v, 10));
    assign('tokenLimit', v => parseInt(v, 10));
    assign('ttsVoiceId');
    assign('ttsModelId');
    assign('sttSampleRate', v => parseInt(v, 10));
    newSettings.sttFormattedFinals = req.body.sttFormattedFinals ? true : false;
    assign('autoSendDelayMs', v => parseInt(v, 10));
    newSettings.usePromptOverrides = req.body.usePromptOverrides ? true : false;
    
    // Save settings
    const saveResult = saveSettings(newSettings);
    
    // For AJAX requests, return JSON
    if (req.xhr || req.headers.accept && req.headers.accept.includes('application/json')) {
      res.json({ success: true, savedSettings: newSettings });
    } else {
      res.redirect('/settings');
    }
  });

  app.use('/settings', router);
}

module.exports = { registerSettingsRoutes };
