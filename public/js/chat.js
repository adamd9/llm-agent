let ws;
let currentMessagePersistent = false;
let isProcessing = false;
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

// Function to update message counts on buttons
function updateMessageCounts() {
    Object.keys(subsystemMessages).forEach(module => {
        const count = subsystemMessages[module].length;
        const countElement = document.querySelector(`.${module}-count`);
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
    const output = document.getElementById(`${module}-output`);
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
    if (!currentMessagePersistent && systemMessageDiv) {
        systemMessageDiv.innerHTML = '';
    }
    if (!currentMessagePersistent) {
        currentResult = null;
    }
    isProcessing = false;
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
                const response = data.data.response;
                addMessage('assistant', response);
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
                            error: typeof data.error === 'string' ? data.error : data.error?.message || 'Unknown error',
                            stack: data.error?.stack || '',
                            location: 'server',
                            status: 'error'
                        },
                        timestamp: new Date().toISOString()
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
                
                addMessage('error', `Error: ${typeof data.error === 'string' ? data.error : JSON.stringify(data.error)}`);
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
                sendMessage(); // Sets inputFieldJustClearedBySend = true
                hasSentFinalForCurrentUtterance = true;
                if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Sent. Listening...';
                // inputFieldJustClearedBySend remains true to guard against its own formatted final.
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

// Initialize WebSocket connection
document.addEventListener('DOMContentLoaded', () => {
    // Assign critical UI elements first
    chatInputField = document.getElementById('chatInput');
    sendButton = document.getElementById('send-button'); // Assign sendButton globally
    voiceInputToggleBtn = document.getElementById('voiceInputToggle');
    autoSendToggleCheckbox = document.getElementById('autoSendToggle');
    voiceStatusIndicator = document.getElementById('voiceStatusIndicator');

    connect(); // Establishes WebSocket and might enable/disable inputs in ws.onopen
    
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
