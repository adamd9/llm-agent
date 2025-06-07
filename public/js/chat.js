let ws;
let currentMessagePersistent = false;
let isProcessing = false; // Agent is no longer busy
let systemMessageDiv = null;
let currentResult = null;
let subsystemMessages = {
    planner: [],
    coordinator: [],
    ego: [],
    systemError: []
};
let connectionError = false; // Track connection error state

// STT Variables
let isRecording = false;
let sttWs; // WebSocket for AssemblyAI STT
let microphone;
let isAutoSendEnabled = true; // Default to auto-send
let hasSentFinalForCurrentUtterance = false;
let inputFieldJustClearedBySend = false; // Flag to prevent repopulation after send

// UI Elements for STT
let voiceInputToggleBtn = null;
let autoSendToggleCheckbox = null;
let voiceStatusIndicator = null;
let chatInputField = null; // Will be assigned in DOMContentLoaded
let sendButton = null; // Will be assigned in DOMContentLoaded

// ElevenLabs TTS Variables
let elevenLabsAudioContext = null;
let elevenLabsAudioQueue = [];
let elevenLabsIsPlaying = false;
let elevenLabsCurrentSource = null; // To keep track of the current audio source
let interruptTTSButton = null;
let elevenLabsStreamReader = null;
let elevenLabsFetchController = null;

// Function to update message counts on buttons
function updateMessageCounts() {
    Object.keys(subsystemMessages).forEach(module => {
        const count = subsystemMessages[module].length;
        let countElementSelector = `.${module}-count`;
        if (module === 'systemError') {
            countElementSelector = '.system-error-count'; // Adjust for hyphenated class convention
        }
        const countElement = document.querySelector(countElementSelector);
        if (countElement) {
            countElement.textContent = count;
            countElement.style.display = count > 0 ? 'inline-flex' : 'none';
        }
    });
}

function toggleDebug() {
    const modal = document.getElementById('debug-modal');
    const button = document.querySelector('.debug-toggle');
    const isHidden = modal.classList.contains('hidden');
    
    modal.classList.toggle('hidden');
    button.textContent = isHidden ? 'Debug ▲' : 'Debug ▼';
    
    // Prevent body scroll when modal is open
    document.body.style.overflow = isHidden ? 'hidden' : '';
}

function toggleSubsystem(module) {
    const modal = document.getElementById(`${module}-modal`);
    const button = document.querySelector(`.${module}-toggle`);
    const isHidden = modal.classList.contains('hidden');
    
    modal.classList.toggle('hidden');
    
    // Update button text while preserving the message count
    const countElement = button.querySelector(`.${module}-count`);
    const countHtml = countElement ? countElement.outerHTML : '';
    
    button.innerHTML = isHidden ? 
        `${capitalizeFirstLetter(module)} ${countHtml} ▲` : 
        `${capitalizeFirstLetter(module)} ${countHtml} ▼`;
    
    // Prevent body scroll when modal is open
    document.body.style.overflow = isHidden ? 'hidden' : '';
    
    // Update content if opening
    if (isHidden) {
        updateSubsystemOutput(module);
    }
}

function toggleSystemErrors() {
    const modal = document.getElementById('system-error-modal');
    const button = document.querySelector('.system-error-toggle');
    const isHidden = modal.classList.contains('hidden');
    
    modal.classList.toggle('hidden');
    
    // Update button text while preserving the message count
    const countElement = button.querySelector('.system-error-count');
    const countHtml = countElement ? countElement.outerHTML : '';
    
    button.innerHTML = isHidden ? 
        `System Errors ${countHtml} ▲` : 
        `System Errors ${countHtml} ▼`;
    
    // Prevent body scroll when modal is open
    document.body.style.overflow = isHidden ? 'hidden' : '';
    
    // Update content if opening
    if (isHidden) {
        updateSubsystemOutput('systemError');
    }
}

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function toggleResults() {
    const modal = document.getElementById('results-modal');
    const isHidden = modal.classList.contains('hidden');
    
    if (!isHidden && !currentResult) {
        return; // Don't open if there's no result
    }
    
    modal.classList.toggle('hidden');
    
    // Prevent body scroll when modal is open
    document.body.style.overflow = isHidden ? 'hidden' : '';
    
    // Update results content if opening
    if (isHidden && currentResult) {
        const output = document.getElementById('results-output');
        
        // Check if the content is JSON-like
        if (currentResult.trim().startsWith('{') || currentResult.trim().startsWith('[')) {
            try {
                // Try to parse and format as JSON
                const jsonObj = JSON.parse(currentResult);
                output.innerHTML = formatJsonWithLineBreaks(jsonObj);
            } catch (e) {
                // If not valid JSON, fall back to text with line breaks
                output.innerHTML = `<pre style="white-space: pre-wrap;">${currentResult.replace(/\n/g, '<br>')}</pre>`;
            }
        } else {
            // For plain text, use pre tag with line breaks
            output.innerHTML = `<pre style="white-space: pre-wrap;">${currentResult.replace(/\n/g, '<br>')}</pre>`;
        }
    }
}

function updateSubsystemOutput(module) {
    let elementIdToFind = `${module}-output`;
    if (module === 'systemError') {
        elementIdToFind = 'system-error-output'; // Adjust for hyphenated ID convention
    }
    const output = document.getElementById(elementIdToFind);
    if (!output) {
        console.error(`Element with id '${module}-output' not found`);
        return;
    }
    
    if (subsystemMessages[module] && subsystemMessages[module].length > 0) {
        // Add "Expand All" and "Collapse All" buttons at the top
        output.innerHTML = `<div class="expand-all-container">
            <button class="expand-all-button" onclick="expandAllMessages('${module}')">Expand All</button>
            <button class="collapse-all-button" onclick="collapseAllMessages('${module}')">Collapse All</button>
        </div>`;
        
        // Append all messages in collapsed state
        output.innerHTML += subsystemMessages[module].map((msg, index) => {
            const messageId = `${module}-message-${index}`;
            const timestamp = new Date(msg.timestamp).toLocaleTimeString();
            const messageTitle = typeof msg.content === 'object' ? (msg.content.type || 'Message') : 'Message';
            
            return `<div class="subsystem-message collapsed" id="${messageId}">
                <div class="subsystem-header" onclick="toggleMessage('${messageId}')">
                    <span class="subsystem-timestamp">${timestamp}</span>
                    <span class="subsystem-title">${messageTitle}</span>
                    <span class="expand-icon">▼</span>
                </div>
                <div class="subsystem-content hidden">
                    ${formatSubsystemContent(msg)}
                </div>
            </div>`;
        }).join('');
    } else {
        output.innerHTML = `<div class="no-messages">No ${module} messages yet</div>`;
    }
}

// Function to toggle a single message
function toggleMessage(messageId) {
    const messageDiv = document.getElementById(messageId);
    if (messageDiv) {
        messageDiv.classList.toggle('collapsed');
        messageDiv.classList.toggle('expanded');
        
        const contentDiv = messageDiv.querySelector('.subsystem-content');
        contentDiv.classList.toggle('hidden');
        
        const expandIcon = messageDiv.querySelector('.expand-icon');
        if (expandIcon) {
            expandIcon.textContent = contentDiv.classList.contains('hidden') ? '▼' : '▲';
        }
    }
}

// Function to expand all messages in a module
function expandAllMessages(module) {
    const output = document.getElementById(`${module}-output`);
    if (!output) return;
    
    const messages = output.querySelectorAll('.subsystem-message');
    messages.forEach(msg => {
        msg.classList.remove('collapsed');
        msg.classList.add('expanded');
        
        const contentDiv = msg.querySelector('.subsystem-content');
        contentDiv.classList.remove('hidden');
        
        const expandIcon = msg.querySelector('.expand-icon');
        if (expandIcon) {
            expandIcon.textContent = '▲';
        }
    });
}

// Function to collapse all messages in a module
function collapseAllMessages(module) {
    const output = document.getElementById(`${module}-output`);
    if (!output) return;
    
    const messages = output.querySelectorAll('.subsystem-message');
    messages.forEach(msg => {
        msg.classList.add('collapsed');
        msg.classList.remove('expanded');
        
        const contentDiv = msg.querySelector('.subsystem-content');
        contentDiv.classList.add('hidden');
        
        const expandIcon = msg.querySelector('.expand-icon');
        if (expandIcon) {
            expandIcon.textContent = '▼';
        }
    });
}

function formatSubsystemContent(msg) {
    if (typeof msg.content === 'object') {
        if (msg.content.type === 'system_error') {
            return `<strong>${msg.content.module || 'Unknown'}: ${msg.content.type}</strong><br>
                    <div class="error-message">${(msg.content.error || 'Unknown error').replace(/\n/g, '<br>')}</div>
                    <div class="error-location">${(msg.content.location || '').replace(/\n/g, '<br>')}</div>
                    <pre class="error-stack">${(msg.content.stack || '').replace(/\n/g, '<br>')}</pre>`;
        }
        
        // For JSON content, use a different approach to preserve formatting
        const formattedContent = `<strong>${msg.content.type || 'Message'}</strong><br>
                <pre style="white-space: pre-wrap;">${formatJsonWithLineBreaks(msg.content)}</pre>`;
        return formattedContent;
    } else {
        // For plain text content
        return `<pre style="white-space: pre-wrap;">${(msg.content || '').replace(/\n/g, '<br>')}</pre>`;
    }
}

// Helper function to format JSON with proper HTML line breaks
function formatJsonWithLineBreaks(obj) {
    // Create a deep copy of the object to avoid modifying the original
    const objCopy = JSON.parse(JSON.stringify(obj));
    
    // Pre-process any nested strings with newlines
    function processNestedStrings(obj) {
        if (obj === null || obj === undefined) return obj;
        
        if (typeof obj === 'string') {
            // Replace newlines in strings with <br> tags
            return obj.replace(/\n/g, '<br>');
        }
        
        if (typeof obj === 'object') {
            if (Array.isArray(obj)) {
                // Process each item in the array
                return obj.map(item => processNestedStrings(item));
            } else {
                // Process each property in the object
                const result = {};
                for (const key in obj) {
                    if (Object.prototype.hasOwnProperty.call(obj, key)) {
                        result[key] = processNestedStrings(obj[key]);
                    }
                }
                return result;
            }
        }
        
        return obj;
    }
    
    // Process any nested strings in the object
    const processedObj = processNestedStrings(objCopy);
    
    // Convert the processed object to a formatted JSON string with indentation
    const jsonString = JSON.stringify(processedObj, null, 2);
    
    // Replace all newlines with <br> tags and preserve spaces
    return jsonString
        .replace(/\n/g, '<br>')
        .replace(/ /g, '&nbsp;')
        .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
}

function toggleStatus(messageDiv) {
    const status = messageDiv.querySelector('.status');
    const toggle = messageDiv.querySelector('.status-toggle');
    
    if (status) {
        const isVisible = status.classList.contains('visible');
        status.classList.toggle('visible');
        toggle.textContent = isVisible ? 'Show result ▼' : 'Hide result ▲';
    }
}

function showStatus(message, options = {}) {
    console.log('[showStatus] isProcessing before:', isProcessing);
    if (!options.noSpinner && !options.persistent) {
        isProcessing = true; // Agent is busy
        console.log('[showStatus] isProcessing set to true. Message:', message);
    }
    // Process message
    let messageText, isPersistent;
    if (typeof message === 'string') {
        messageText = message;
        isPersistent = false;
    } else {
        messageText = message.message;
        isPersistent = message.persistent;
    }
    
    console.log('Status update:', { messageText, isPersistent });
    
    messageText = humanizeStatusMessage(messageText);
    
    if (!systemMessageDiv) {
        console.log('Creating system message div');
        systemMessageDiv = document.createElement('div');
        systemMessageDiv.className = 'message system';
        const messagesDiv = document.getElementById('messages');
        if (messagesDiv.firstChild) {
            messagesDiv.insertBefore(systemMessageDiv, messagesDiv.firstChild);
        } else {
            messagesDiv.appendChild(systemMessageDiv);
        }
    }
    
    if (isPersistent) {
        // Store the result and show a button to view it
        currentResult = messageText;
        const viewButton = '<button onclick="toggleResults()" class="view-results-button">View Results ▼</button>';
        const spinner = '<span class="spinner"></span>';
        systemMessageDiv.innerHTML = `${spinner}Results ready ${viewButton}`;
    } else {
        // Show non-persistent messages in the system message area
        const spinner = options.noSpinner ? '' : '<span class="spinner"></span>';
        systemMessageDiv.innerHTML = `${spinner}${messageText.replace(/\n/g, '<br>')}`;
    }
    
    currentMessagePersistent = isPersistent;
}

function clearStatus() {
    console.log('[clearStatus] isProcessing before:', isProcessing);
    isProcessing = false; // Agent is no longer busy
    console.log('[clearStatus] isProcessing set to false.');
    if (!currentMessagePersistent && systemMessageDiv) {
        systemMessageDiv.innerHTML = '';
    }
    if (!currentMessagePersistent) {
        currentResult = null;
    }
}

function humanizeStatusMessage(message) {
    const messageMap = {
        'Starting to work on your request...': '💭 Thinking...',
        'Starting execution of the plan...': '🔧 Working on it...',
        'Executing the plan...': '🚀 Almost there...',
        'query': '📨 Querying model...',
        'evalForUpdate': 'Evaluating results...'           
    };

    if (messageMap[message]) {
        return messageMap[message];
    }

    if (message.includes('scored') && message.includes('Making adjustments')) {
        return '🔄 Improving the response...';
    }

    return message;
}

function addMessage(type, content, format = 'basic') {
    console.log('Adding message:', { type, content });
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    
    if (format === 'markdown') {
        // Add markdown formatting if needed
        messageDiv.innerHTML = content.replace(/\n/g, '<br>');
    } else {
        messageDiv.innerHTML = content.replace(/\n/g, '<br>');
    }
    
    // For system messages, insert after the system status if it exists
    if (type === 'system' && systemMessageDiv) {
        systemMessageDiv.after(messageDiv);
    } else {
        messagesDiv.appendChild(messageDiv);
    }
    
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('Connected to server');
        connectionError = false; // Reset connection error state on successful connection

        if (chatInputField) {
            chatInputField.disabled = false;
            // Auto-focus the chat input after connection is established
            chatInputField.focus();
        } else {
            console.error('Chat input field not found in ws.onopen');
        }

        if (sendButton) {
            sendButton.disabled = false;
        } else {
            console.error('Send button not found in ws.onopen');
        }

        showStatus('Connected to server', { noSpinner: true });
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('WebSocket message received:', data);
        
        switch(data.type) {
            case 'response':
                const responseText = data.data.response; // Renamed to avoid conflict with other 'response' variables
                addMessage('assistant', responseText);
                playElevenLabsTTS(responseText); // Play TTS for the assistant's response
                clearStatus();
                break;
                
            case 'working':
                console.log('Working status update:', data.data.status);
                showStatus(data.data.status);
                break;
                
            case 'subsystem':
                console.log('Subsystem message:', data.data);
                const module = data.data.module;
                const content = data.data.content;
                
                // Store the message with timestamp
                if (subsystemMessages[module]) {
                    subsystemMessages[module].push({
                        content: content,
                        timestamp: new Date().toISOString()
                    });
                    
                    // Update the message count
                    updateMessageCounts();
                    
                    // Update the output if the modal is open
                    const modal = document.getElementById(`${module}-modal`);
                    if (modal && !modal.classList.contains('hidden')) {
                        updateSubsystemOutput(module);
                    }
                    
                    // Highlight the button to indicate new message
                    const button = document.querySelector(`.${module}-toggle`);
                    if (button) {
                        button.classList.add('has-new');
                        setTimeout(() => {
                            button.classList.remove('has-new');
                        }, 3000);
                    }
                }
                break;
                
            case 'systemError':
                console.log('System Error:', data.data);
                const errorModule = data.data.module || 'unknown';
                const errorContent = data.data.content;
                
                // Store the error with timestamp
                if (subsystemMessages.systemError) {
                    subsystemMessages.systemError.push({
                        content: errorContent,
                        timestamp: new Date().toISOString()
                    });
                    
                    // Update the message count
                    updateMessageCounts();
                    
                    // Update the output if the modal is open
                    const errorModal = document.getElementById('system-error-modal');
                    if (!errorModal.classList.contains('hidden')) {
                        updateSubsystemOutput('systemError');
                    }
                    
                    // Highlight the button to indicate new error
                    const errorButton = document.querySelector('.system-error-toggle');
                    errorButton.classList.add('has-new');
                    setTimeout(() => {
                        errorButton.classList.remove('has-new');
                    }, 3000);
                }
                break;
                
            case 'debug':
                const debugOutput = document.getElementById('debug-output');
                const debugMessage = typeof data.data === 'object' ? 
                    JSON.stringify(data.data, null, 2) : 
                    data.data;
                debugOutput.textContent += debugMessage + '\n';
                debugOutput.scrollTop = debugOutput.scrollHeight;
                break;
                
            case 'error':
                console.error('Server error:', data.error);
                
                // Also add the error to the system errors
                if (subsystemMessages.systemError) {
                    subsystemMessages.systemError.push({
                        content: {
                            type: 'system_error',
                            error: data.data?.message || (typeof data.error === 'string' ? data.error : data.error?.message) || 'Unknown server error',
                            specific_error: data.data?.error?.message || '',
                            stack: data.data?.error?.stack || data.error?.stack || '',
                            context: data.data?.context || '',
                            location: 'server',
                            status: 'error'
                        },
                        timestamp: data.timestamp || new Date().toISOString() // Use server timestamp if available
                    });
                    
                    // Update the message count
                    updateMessageCounts();
                    
                    // Highlight the button to indicate new error
                    const errorButton = document.querySelector('.system-error-toggle');
                    if (errorButton) {
                        errorButton.classList.add('has-new');
                        setTimeout(() => {
                            errorButton.classList.remove('has-new');
                        }, 3000);
                    }
                }
                
                // addMessage('error', `Error: ${typeof data.error === 'string' ? data.error : JSON.stringify(data.error)}`); // Removed: Server errors should only go to the System Errors toggle
                clearStatus();
                break;

            case 'session':
                console.log('Session ID:', data.sessionId);
                break;
        }
    };
    
    ws.onclose = () => {
        console.log('Disconnected from server');
        setTimeout(connect, 1000); // Reconnect after 1 second
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        if (!connectionError) {
            // Only show the error message once
            connectionError = true;
            // Clear any existing system message
            if (systemMessageDiv) {
                systemMessageDiv.innerHTML = '';
            }
            // Show a system message with a spinner
            showStatus('Connection error. Please try again.', { persistent: true });
        }
    };
}

function sendMessage() {
    showStatus('Sending message...', { spinner: true });
    // Use the global chatInputField which is already assigned in DOMContentLoaded
    if (!chatInputField) {
        console.error("sendMessage: chatInputField is not available! Element with ID 'chatInput' might be missing or not yet initialized.");
        addMessage('system', 'Error: Chat input field not found. Cannot send message.');
        return;
    }
    const message = chatInputField.value.trim();
    
    if (message && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            message: message
        }));
        
        addMessage('user', message);
        if (chatInputField) chatInputField.value = ''; // Clear the global chatInputField
        inputFieldJustClearedBySend = true; // Indicate input was just cleared by a send operation
    }
}

// --- New STT Functions Start ---

function createMicrophone() {
  let stream;
  let audioContext;
  let audioWorkletNode;
  let source;
  let audioBufferQueue = new Int16Array(0);

  return {
    async requestPermission() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    },
    async startRecording(onAudioCallback) {
      if (!stream) stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      audioContext = new AudioContext({
        sampleRate: 16000,
        latencyHint: 'balanced'
      });

      source = audioContext.createMediaStreamSource(stream);
      // Ensure the path to audio-processor.js is correct if it's not in the same dir as index.html
      // Assuming chat.js and audio-processor.js are both in /js/, this relative path should work from chat.js context if served correctly.
      // However, AudioWorklet path is relative to the HTML file or a base URL.
      // For simplicity, let's assume it's served such that 'js/audio-processor.js' is accessible from the root.
      try {
        await audioContext.audioWorklet.addModule('js/audio-processor.js');
      } catch (e) {
        console.error('Failed to load audio-processor.js for AudioWorklet. Make sure the path is correct.', e);
        if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Audio Processor Error!';
        addMessage('system', 'Critical error: Audio processor module could not be loaded. Voice input disabled.');
        return; // Stop further execution if audio processor fails
      }

      audioWorkletNode = new AudioWorkletNode(audioContext, 'audio-processor');
      source.connect(audioWorkletNode);
      audioWorkletNode.connect(audioContext.destination); // Optional: connect to destination if you want to hear the mic input

      audioWorkletNode.port.onmessage = (event) => {
        const currentBuffer = new Int16Array(event.data.audio_data);
        audioBufferQueue = mergeBuffers(audioBufferQueue, currentBuffer);

        const bufferDuration = (audioBufferQueue.length / audioContext.sampleRate) * 1000;

        if (bufferDuration >= 100) { // Send audio in 100ms chunks
          const totalSamples = Math.floor(audioContext.sampleRate * 0.1);
          const finalBuffer = new Uint8Array(audioBufferQueue.subarray(0, totalSamples).buffer);
          audioBufferQueue = audioBufferQueue.subarray(totalSamples);

          if (onAudioCallback) onAudioCallback(finalBuffer);
        }
      };
    },
    stopRecording() {
      stream?.getTracks().forEach((track) => track.stop());
      audioContext?.close();
      audioBufferQueue = new Int16Array(0);
      stream = null; // Clear the stream
      audioContext = null; // Clear the context
    }
  };
}

function mergeBuffers(lhs, rhs) {
  const merged = new Int16Array(lhs.length + rhs.length);
  merged.set(lhs, 0);
  merged.set(rhs, lhs.length);
  return merged;
}

async function toggleVoiceSTT() {
  if (isRecording) {
    // Stop recording
    if (sttWs) {
      if (sttWs.readyState === WebSocket.OPEN || sttWs.readyState === WebSocket.CONNECTING) {
        sttWs.send(JSON.stringify({ type: "Terminate" })); 
        sttWs.close(); 
      }
      sttWs = null; // Ensure it's nulled for the next session
    }
    // General cleanup for stopping, regardless    // Reset STT state for the next recording session
    isRecording = false;
    if(microphone) {
        microphone.stopRecording();
        microphone = null;
    }
    // turns is re-initialized within toggleVoiceSTT when starting
    hasSentFinalForCurrentUtterance = false;
    inputFieldJustClearedBySend = false;
    // sttWs is nulled in the calling context (toggleVoiceSTT's stop branch)

    if(voiceInputToggleBtn) voiceInputToggleBtn.textContent = '🎤 Start Voice';
    if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Idle.';
  } else {
    // Start recording
    if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Initializing...';
    microphone = createMicrophone();
    try {
      await microphone.requestPermission();
    } catch (error) {
      console.error('Microphone permission denied:', error);
      if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Mic Permission Denied!';
      addMessage('system', 'Microphone permission denied. Please allow microphone access.');
      if (microphone) microphone.stopRecording(); // Stop if it was started
      microphone = null; // Reset microphone
      isRecording = false; // Ensure recording state is false
      if(voiceInputToggleBtn) voiceInputToggleBtn.textContent = '🎤 Start Voice'; // Reset button
      return;
    }

    if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Fetching Auth Token...';
    let token;
    try {
      const response = await fetch('/api/assemblyai-token');
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to parse error from token endpoint.' }));
        throw new Error(`Failed to fetch AssemblyAI token: ${response.status} ${response.statusText}. Server said: ${errorData.error || 'Unknown error'}`);
      }
      const data = await response.json();
      token = data.token;
      if (!token) {
        throw new Error('Token not found in response from /api/assemblyai-token');
      }
      if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Token received. Connecting...';
      console.log('Successfully fetched AssemblyAI token.');
    } catch (error) {
      console.error('Error fetching AssemblyAI token:', error);
      if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Token Fetch Error!';
      addMessage('system', `Error fetching AssemblyAI token: ${error.message}. Please check server logs.`);
      isRecording = false; // Ensure isRecording is reset
      if(voiceInputToggleBtn) voiceInputToggleBtn.textContent = '🎤 Start Voice';
      if (microphone) microphone.stopRecording(); // Stop microphone if active
      microphone = null; // Clean up microphone instance
      return;
    }

    const endpoint = `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&formatted_finals=true&token=${token}`;
    sttWs = new WebSocket(endpoint);
    inputFieldJustClearedBySend = false; // Reset for a new WebSocket session

    let turns = {}; // keyed by turn_order
    // let fullTranscript = ''; // This variable seems unused now, can be removed if confirmed.

    sttWs.onopen = async () => {
      console.log('AssemblyAI WebSocket connected!');
      if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Connected. Recording...';
      isRecording = true;
      if(voiceInputToggleBtn) voiceInputToggleBtn.textContent = '🎤 Stop Voice';
      if(chatInputField) chatInputField.value = ''; // Clear input field
    // ... (rest of the code remains the same)
      hasSentFinalForCurrentUtterance = false; // Reset flag for new recording session
      // turns object is already freshly initialized in the outer toggleVoiceSTT scope for a new recording
      
      await microphone.startRecording((audioChunk) => {
        if (sttWs && sttWs.readyState === WebSocket.OPEN) {
          sttWs.send(audioChunk);
        }
      });
    };

    sttWs.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'Turn') {

        // Logic for handling new speech or continued speech after a final has been sent.
        if (hasSentFinalForCurrentUtterance && !msg.end_of_turn && msg.transcript.trim() !== '') {
            // A final for a previous utterance was sent, and this is a new partial.
            console.log("Partial received after a final. InputJustCleared:", inputFieldJustClearedBySend, "Transcript:", msg.transcript);
            // This partial indicates either continued speech or the start of formatting for the previous utterance.
            // In either case, we are starting a 'new' logical segment from the user's perspective for the input field.
            turns = {}; // Reset turns for this new segment.
            hasSentFinalForCurrentUtterance = false; // This new segment can be sent.
            inputFieldJustClearedBySend = false; // Allow the input field to be updated with this new segment.
            // chatInputField.value will be cleared by the subsequent `turns[msg.turn_order] = msg.transcript;` if turns is empty
            // or will start fresh with this transcript.
            console.log("State reset for new/continued speech segment. Turns cleared, hasSentFinal=false, inputFieldJustClearedBySend=false.");
        }

        turns[msg.turn_order] = msg.transcript;
        const orderedTurnsText = Object.keys(turns).sort((a, b) => Number(a) - Number(b)).map(k => turns[k]).join('');
        
        if (!inputFieldJustClearedBySend) {
            if (chatInputField) chatInputField.value = orderedTurnsText;
        }

        if (msg.end_of_turn) {
            console.log('Received end_of_turn. Current transcript:', orderedTurnsText, 'Has already sent:', hasSentFinalForCurrentUtterance, 'InputJustCleared:', inputFieldJustClearedBySend);

            if (isAutoSendEnabled && orderedTurnsText.trim().length > 0 && !hasSentFinalForCurrentUtterance) {
                // This is the first final of an utterance, and auto-send is on.
                console.log('[toggleVoiceSTT - end_of_turn] Checking isProcessing. Value:', isProcessing, 'Transcript:', orderedTurnsText);
                if (isProcessing) {
                    if (window.confirm("The agent is still processing the previous request. Send new query anyway?")) {
                        sendMessage(); // Sets inputFieldJustClearedBySend = true
                        hasSentFinalForCurrentUtterance = true;
                        if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Sent. Listening...';
                    } else {
                        // User cancelled. Keep text in input, allow manual send.
                        if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Final. Review & Send.';
                        // Do not set hasSentFinalForCurrentUtterance to true, so it can be sent again if needed.
                        // Do not set inputFieldJustClearedBySend, so input remains populated.
                    }
                } else {
                    sendMessage(); // Sets inputFieldJustClearedBySend = true
                    hasSentFinalForCurrentUtterance = true;
                    if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Sent. Listening...';
                }
                // inputFieldJustClearedBySend remains true to guard against its own formatted final if message was sent.
            } else {
                // This 'else' covers:
                // 1. Formatted final of an auto-sent utterance (hasSentFinalForCurrentUtterance=true).
                // 2. Manual send mode (isAutoSendEnabled=false).
                // 3. End of a new utterance that wasn't the *first* final to be auto-sent.
                // 4. Empty transcript end_of_turn.

                if (isAutoSendEnabled && hasSentFinalForCurrentUtterance && inputFieldJustClearedBySend) {
                    // Case 1: This is the formatted final of the utterance that was JUST auto-sent.
                    // inputFieldJustClearedBySend was true from sendMessage(). Keep it true to prevent repopulation.
                    // Status should remain 'Sent. Listening...' from the initial send.
                    console.log("Formatted final arrived while inputFieldJustClearedBySend is true. Status remains 'Sent. Listening...'.");
                } else {
                    // All other end_of_turn scenarios: allow input field to update if needed.
                    inputFieldJustClearedBySend = false;

                    if (!isAutoSendEnabled && orderedTurnsText.trim().length > 0) { // Manual send mode with text
                        if (chatInputField) chatInputField.value = orderedTurnsText;
                        if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Final. Review & Send.';
                    } else if (orderedTurnsText.trim().length > 0) { // Some text, not manual, not the first auto-send (e.g. final of new utterance, or formatted final when input wasn't just cleared)
                        if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Transcript refined. Listening...';
                    } else { // Empty transcript
                        if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Listening...';
                    }
                }
            }
        } else { // Partial transcript
            // If input was just cleared by send, AND this new partial has text,
            // AND a final has NOT yet been sent for the current logical utterance (meaning this is continued speech for the current utterance, not refinement of a sent one)
            if (inputFieldJustClearedBySend && orderedTurnsText.trim().length > 0 && !hasSentFinalForCurrentUtterance) {
                inputFieldJustClearedBySend = false; // Allow this new partial (continued speech) to update the input.
                // The input field will then be updated by the general `if (!inputFieldJustClearedBySend)` block.
            }
            
            // Update status indicator based on whether a final has been sent for the current logical utterance
            if (hasSentFinalForCurrentUtterance) {
                 // This partial is part of a formatted final or refinement after sending.
                 // The input field should remain cleared if inputFieldJustClearedBySend is true (set by sendMessage).
                if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Refining...';
            } else {
                // This is a partial for an ongoing, unsent utterance.
                if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Listening...';
            }
        }
      } else if (msg.type === 'Error') {
        console.error('AssemblyAI STT Error:', msg.error);
        if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'STT Error!';
        addMessage('system', `STT Error from AssemblyAI: ${msg.error}`);
        // Consider if we should stop recording here or let user decide
      } else if (msg.type === 'SessionTerminated') {
        console.log('AssemblyAI STT Session Terminated:', msg);
        if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Session Ended.';
        // If session is terminated by server, ensure we are in a stopped state
        if (isRecording) {
            // This will clean up microphone and UI
            if (microphone) microphone.stopRecording();
            microphone = null;
            if(voiceInputToggleBtn) voiceInputToggleBtn.textContent = '🎤 Start Voice';
            isRecording = false;
            sttWs = null; // Ensure WebSocket is nulled as it's terminated
        }
      }
    };

    sttWs.onerror = (err) => {
      console.error('AssemblyAI WebSocket error:', err);
      if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'WS Connection Error!';
      addMessage('system', 'WebSocket connection error with STT service.');
      if (isRecording) {
        toggleVoiceSTT(); // Attempt to stop and reset state
      }
    };

    sttWs.onclose = (event) => {
      console.log('AssemblyAI WebSocket closed. Code:', event.code, 'Reason:', event.reason);
      // Only update UI if it was an unexpected close during recording
      if (isRecording) {
        if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Disconnected.';
        // Attempt to clean up and reset state if closed unexpectedly
        if (microphone) microphone.stopRecording();
        microphone = null;
        if(voiceInputToggleBtn) voiceInputToggleBtn.textContent = '🎤 Start Voice';
        isRecording = false; 
      }
      inputFieldJustClearedBySend = false; // Reset flag on WebSocket close
      sttWs = null; // Ensure it's nulled on close
    };
  }
}

// --- New STT Functions End ---

// --- ElevenLabs TTS Functions Start ---

function initializeElevenLabsAudio() {
    if (!elevenLabsAudioContext) {
        try {
            elevenLabsAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log('ElevenLabs AudioContext initialized.');
        } catch (e) {
            console.error('Error initializing AudioContext for ElevenLabs:', e);
            addMessage('system', 'Error: Could not initialize audio for TTS. Your browser might not support Web Audio API.');
        }
    }
}

async function enqueueElevenLabsAudioChunk(arrayBuffer) {
    if (!elevenLabsAudioContext) {
        console.error('ElevenLabs AudioContext not initialized. Cannot process audio chunk.');
        // Attempt to initialize it if called before DOMContentLoaded or initial play
        initializeElevenLabsAudio();
        if (!elevenLabsAudioContext) return; // Still not initialized, bail.
    }
    try {
        const audioBuffer = await elevenLabsAudioContext.decodeAudioData(arrayBuffer);
        elevenLabsAudioQueue.push(audioBuffer);
        if (!elevenLabsIsPlaying) {
            playNextElevenLabsChunk();
        }
    } catch (e) {
        console.error('Error decoding audio data for ElevenLabs:', e);
        // NOTE: We are not adding a system message here as per user request,
        // because speech often still works despite these decoding errors.
        // addMessage('system', 'Error: Could not decode TTS audio chunk.');
    }
}

function actuallyPlayNextChunk() {
    if (elevenLabsAudioQueue.length === 0 || !elevenLabsAudioContext) {
        elevenLabsIsPlaying = false;
        return;
    }
    
    elevenLabsIsPlaying = true;
    const audioBuffer = elevenLabsAudioQueue.shift();
    
    elevenLabsCurrentSource = elevenLabsAudioContext.createBufferSource();
    elevenLabsCurrentSource.buffer = audioBuffer;
    elevenLabsCurrentSource.connect(elevenLabsAudioContext.destination);
    elevenLabsCurrentSource.onended = () => {
        console.log('ElevenLabs audio chunk finished playing.');
        if (elevenLabsAudioQueue.length > 0) {
            playNextElevenLabsChunk(); // Intentionally call the wrapper to handle resume logic if needed again
        } else {
            elevenLabsIsPlaying = false;
            console.log('ElevenLabs TTS queue finished.');
        }
    };
    try {
      elevenLabsCurrentSource.start();
      console.log('Playing next ElevenLabs audio chunk.');
    } catch (e) {
      console.error('Error starting audio source for ElevenLabs:', e);
      elevenLabsIsPlaying = false;
      // Attempt to play the next one if there was an error with this one
      if (elevenLabsAudioQueue.length > 0) playNextElevenLabsChunk();
    }
}

function playNextElevenLabsChunk() {
    if (elevenLabsAudioQueue.length === 0) {
        elevenLabsIsPlaying = false;
        console.log('ElevenLabs TTS queue finished.');
        return;
    }

    if (!elevenLabsAudioContext) {
        console.error('ElevenLabs AudioContext not initialized. Cannot play audio.');
        initializeElevenLabsAudio(); // Try to initialize it
        if (!elevenLabsAudioContext) {
            elevenLabsIsPlaying = false;
            return;
        }
    }
    
    if (elevenLabsAudioContext.state === 'suspended') {
        elevenLabsAudioContext.resume().then(() => {
            console.log('AudioContext resumed by playNextElevenLabsChunk.');
            actuallyPlayNextChunk();
        }).catch(e => {
            console.error('Error resuming AudioContext:', e);
            addMessage('system', 'Error: Could not resume audio playback. Please interact with the page and try again.');
            elevenLabsIsPlaying = false;
        });
    } else {
        actuallyPlayNextChunk();
    }
}

async function stopElevenLabsPlaybackAndStream() {
    console.log('Interrupting ElevenLabs TTS playback and stream.');

    // Stop local audio playback
    if (elevenLabsCurrentSource) {
        try {
            elevenLabsCurrentSource.stop();
        } catch (e) {
            console.warn("Error stopping current ElevenLabs source during interrupt:", e);
        }
        elevenLabsCurrentSource = null;
    }
    elevenLabsAudioQueue = [];
    elevenLabsIsPlaying = false;

    // Abort the fetch request
    if (elevenLabsFetchController) {
        elevenLabsFetchController.abort();
        // Controller reset is handled in playElevenLabsTTS finally or at new request
    }
    // The reader will be cancelled by the fetch abort.
    elevenLabsStreamReader = null; // Clear the reference

    if (interruptTTSButton) {
        interruptTTSButton.style.display = 'none';
    }
}

async function playElevenLabsTTS(text) {
    if (!text || text.trim() === '') {
        console.log('No text provided for ElevenLabs TTS.');
        return;
    }

    // If already playing or streaming, interrupt the previous one
    if (elevenLabsIsPlaying || elevenLabsStreamReader || elevenLabsFetchController) {
        console.log('Previous TTS active, interrupting it before starting new TTS.');
        await stopElevenLabsPlaybackAndStream(); 
    }

    initializeElevenLabsAudio();

    if (!elevenLabsAudioContext) {
        console.warn('AudioContext for ElevenLabs not available. TTS playback aborted.');
        return;
    }

    if (elevenLabsAudioContext.state === 'suspended') {
        try {
            await elevenLabsAudioContext.resume();
            console.log('AudioContext resumed by playElevenLabsTTS.');
        } catch (e) {
            console.error('Could not resume AudioContext on demand:', e);
            addMessage('system', 'Audio is paused. Click the page to enable sound for TTS, then try again.');
            return;
        }
    }
    
    // Reset audio queue and playing state for the new stream
    elevenLabsAudioQueue = [];
    elevenLabsIsPlaying = false; // Will be set to true by playNextElevenLabsChunk when first chunk plays
    if (elevenLabsCurrentSource) { // Should have been cleared by stopElevenLabsPlaybackAndStream if active
        try { elevenLabsCurrentSource.stop(); } catch(e) { /* ignore */ }
        elevenLabsCurrentSource = null;
    }

    console.log(`Requesting ElevenLabs TTS for: "${text.substring(0, 50)}..."`);

    elevenLabsFetchController = new AbortController(); // Create a new controller for this request

    try {
        const response = await fetch('/api/tts/elevenlabs-stream', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text }), // voice_id and model_id will use server defaults
            signal: elevenLabsFetchController.signal, // Pass the abort signal
        });

        if (!response.ok) {
            if (elevenLabsFetchController && elevenLabsFetchController.signal.aborted) {
                console.log('ElevenLabs TTS fetch aborted by user (response.ok check).');
            } else {
                const errorData = await response.json().catch(() => ({ error: 'Failed to parse error from TTS endpoint.' }));
                console.error('ElevenLabs TTS API request failed:', response.status, errorData);
                addMessage('system', `Error from TTS service: ${errorData.error || response.statusText}`);
            }
        } else {
            if (interruptTTSButton) {
                interruptTTSButton.style.display = 'inline-block';
            }
            elevenLabsStreamReader = response.body.getReader();
            
            // eslint-disable-next-line no-constant-condition
            while (true) {
                if (!elevenLabsStreamReader) { 
                    console.log('Stream reader became null (e.g. interrupted), exiting read loop.');
                    break;
                }
                const { done, value } = await elevenLabsStreamReader.read();
                if (done) {
                    console.log('ElevenLabs TTS stream finished naturally.');
                    break;
                }
                if (elevenLabsFetchController && elevenLabsFetchController.signal.aborted) {
                    console.log('Stream processing aborted during read loop.');
                    break;
                }
                await enqueueElevenLabsAudioChunk(value.buffer);
            }
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('ElevenLabs TTS fetch explicitly aborted (catch block).');
        } else {
            console.error('Error fetching or processing ElevenLabs TTS stream:', error);
            addMessage('system', `Error with TTS playback: ${error.message}`);
        }
    } finally {
        console.log('TTS finally block executing.');
        const wasAbortedByController = elevenLabsFetchController && elevenLabsFetchController.signal.aborted;

        if (elevenLabsStreamReader) {
            try {
                if (typeof elevenLabsStreamReader.cancel === 'function') {
                    await elevenLabsStreamReader.cancel('Stream finished, errored, or aborted.');
                }
            } catch (e) {
                console.warn('Warning: Error cancelling stream reader in finally block:', e);
            }
            elevenLabsStreamReader = null;
        }
        
        if (!wasAbortedByController) { // If not aborted by our explicit interrupt call
            if (interruptTTSButton) {
                interruptTTSButton.style.display = 'none';
            }
        }
        // Always nullify the controller for the completed/aborted request
        elevenLabsFetchController = null;

        // If playback was ongoing and not part of an explicit abort action that already reset this
        if (elevenLabsIsPlaying && !wasAbortedByController) {
            elevenLabsIsPlaying = false;
        }
        // Clear queue if stream ended naturally/errored and not part of an explicit abort
        if (elevenLabsAudioQueue.length > 0 && !wasAbortedByController) {
             console.log("Clearing audio queue as TTS stream ended naturally or with non-abort error.");
             elevenLabsAudioQueue = [];
        }
    }
}

// --- ElevenLabs TTS Functions End ---

document.addEventListener('DOMContentLoaded', () => {
    // Assign critical UI elements first
    chatInputField = document.getElementById('chatInput');
    sendButton = document.getElementById('send-button'); // Assign sendButton globally
    voiceInputToggleBtn = document.getElementById('voiceInputToggle');
    autoSendToggleCheckbox = document.getElementById('autoSendToggle');
    voiceStatusIndicator = document.getElementById('voiceStatusIndicator');
    interruptTTSButton = document.getElementById('interrupt-tts-button'); // Assign interrupt button

    connect(); // Establishes WebSocket and might enable/disable inputs in ws.onopen

    if (interruptTTSButton) {
        interruptTTSButton.addEventListener('click', stopElevenLabsPlaybackAndStream);
    } else {
        console.warn('Interrupt TTS button (interrupt-tts-button) not found in the DOM.');
    }
    
    // Initialize message counts
    updateMessageCounts();

    if (chatInputField) {
        chatInputField.addEventListener('keypress', function(event) {
            if (event.key === 'Enter') {
                sendMessage();
            }
        });
    }

    if (sendButton) {
        sendButton.addEventListener('click', sendMessage);
    }

    // Check for chatInputField existence before proceeding with STT specific UI checks
    if (!chatInputField && voiceInputToggleBtn) { // Ensure voiceInputToggleBtn exists before trying to disable
        console.warn("Chat input field (id='chatInput') not found. STT will be disabled.");
        if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Chat Input Missing.';
        voiceInputToggleBtn.disabled = true;
    } else if (voiceInputToggleBtn) { // Only proceed if voice toggle exists
        // Setup event listeners for the voice input toggle button
        if (voiceInputToggleBtn) {
            voiceInputToggleBtn.addEventListener('click', toggleVoiceSTT);
        }
        if (autoSendToggleCheckbox) {
            isAutoSendEnabled = autoSendToggleCheckbox.checked;
            autoSendToggleCheckbox.addEventListener('change', (event) => {
                isAutoSendEnabled = event.target.checked;
            });
        } else {
          console.warn('Auto-send toggle checkbox not found.');
        }
    } else {
        console.warn("Voice input toggle button not found. STT UI cannot be initialized.");
    }

    // Modal background click listeners - ensure these are only attached once and correctly
    const modals = ['debug-modal', 'results-modal', 'planner-modal', 'coordinator-modal', 'ego-modal', 'system-error-modal'];
    modals.forEach(modalId => {
        const modalElement = document.getElementById(modalId);
        if (modalElement) {
            modalElement.addEventListener('click', (e) => {
                if (e.target.id === modalId) {
                    // Determine the correct toggle function based on modalId
                    if (modalId === 'debug-modal') toggleDebug();
                    else if (modalId === 'results-modal') toggleResults();
                    else if (modalId === 'system-error-modal') toggleSystemErrors();
                    else { // For planner, coordinator, ego
                        const moduleName = modalId.replace('-modal', '');
                        toggleSubsystem(moduleName);
                    }
                }
            });
        }
    });
});
