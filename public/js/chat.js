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
let interruptButton = null; // Reference to the interrupt button
let pendingUserAction = false; // Track if we're waiting for user action on interrupt

// STT Variables
let isRecording = false;
let sttWs; // WebSocket for AssemblyAI STT
let microphone;
// Load auto-send preference from localStorage or default to true
let isAutoSendEnabled = localStorage.getItem('autoSendEnabled') !== 'false'; // Default to true if not set
let hasSentFinalForCurrentUtterance = false;
let inputFieldJustClearedBySend = false; // Flag to prevent repopulation after send

// UI Elements for STT
let voiceInputToggleBtn = null;
let autoSendToggle = null;
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
let userInteracted = false; // Track if user has interacted with the page
const MAX_RETRY_ATTEMPTS = 3; // Max retry attempts for audio chunk processing
let retryCount = 0; // Track retry attempts
const MIN_AUDIO_CHUNK_SIZE = 1000; // Minimum size to attempt decoding
let audioDataBuffer = new Uint8Array(0); // Buffer for accumulating small audio chunks
let isTTSEnabled = true; // Toggle state for TTS functionality

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
    console.log('Showing status:', message, options);

    // Process message and track data type if needed
    let messageText, isPersistent, dataType;
    if (typeof message === 'string') {
        messageText = message;
        isPersistent = false;
    } else {
        messageText = message.message || '';
        isPersistent = message.persistent || false;
    }

    if (messageText === 'finalizing') {
        dataType = 'finalizing';
    }
    
    // Humanize the message
    messageText = humanizeStatusMessage(messageText);
    
    // Use the system messages container for all status messages
    const systemMessagesContainer = document.getElementById('system-messages-container');
    if (!systemMessagesContainer) return;
    
    // Clear any existing status messages if they're not persistent
    if (!isPersistent) {
        const existingStatus = systemMessagesContainer.querySelector('.status-message:not(.persistent)');
        if (existingStatus) {
            existingStatus.remove();
        }
    }
    
    // Create status div
    const statusDiv = document.createElement('div');
    statusDiv.className = 'system-message status-message';
    if (dataType) {
        statusDiv.setAttribute('data-type', dataType);
    }
    
    // Add spinner if needed
    const spinner = options.noSpinner ? '' : '<span class="spinner"></span>';
    
    if (isPersistent && message.includes('Results ready')) {
        // For persistent results, show a button to view them
        statusDiv.classList.add('persistent');
        currentResult = messageText;
        const viewButton = '<button onclick="toggleResults()" class="view-results-button">View Results ▼</button>';
        statusDiv.innerHTML = `${spinner}${messageText} ${viewButton}`;
    } else {
        // Regular status message
        statusDiv.innerHTML = `${spinner}${messageText.replace(/\n/g, '<br>')}`;
    }
    
    // Add close button for persistent messages
    if (isPersistent) {
        const closeButton = document.createElement('button');
        closeButton.className = 'close-button';
        closeButton.textContent = '×';
        closeButton.onclick = () => {
            statusDiv.remove();
            currentMessagePersistent = false;
            currentResult = null;
        };
        statusDiv.appendChild(closeButton);
    }
    
    // Add to container and scroll into view
    systemMessagesContainer.appendChild(statusDiv);
    statusDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    
    // Update processing state
    if (!options.noSpinner && !isPersistent) {
        isProcessing = true;
        updateProcessingUI();
    }
    
    // Store reference to the current status div if needed
    if (isPersistent) {
        currentMessagePersistent = true;
        systemMessageDiv = statusDiv;
    }
}

function clearStatus() {
    console.log('[clearStatus] isProcessing before:', isProcessing);
    isProcessing = false; // Agent is no longer busy
    pendingUserAction = false; // Reset pending user action flag
    console.log('[clearStatus] isProcessing set to false.');
    
    // Update UI based on processing state
    updateProcessingUI();
    
    // Clear any system messages after a delay
    if (systemMessageDiv) {
        setTimeout(() => {
            if (systemMessageDiv) {
                systemMessageDiv.remove();
                systemMessageDiv = null;
            }
        }, 3000);
        systemMessageDiv = null;
    }
}

// Update UI based on processing state and TTS playback
function updateProcessingUI() {
    // Show interrupt button when either processing or TTS is playing
    const shouldShowInterrupt = isProcessing || elevenLabsIsPlaying;
    console.log(`[updateProcessingUI] isProcessing: ${isProcessing}, elevenLabsIsPlaying: ${elevenLabsIsPlaying}, shouldShowInterrupt: ${shouldShowInterrupt}`);
    
    if (interruptButton) {
        // Update the button text based on context
        const interruptText = interruptButton.querySelector('.interrupt-text');
        if (interruptText) {
            interruptText.textContent = elevenLabsIsPlaying ? 'Stop TTS' : 'Interrupt';
        }
        
        // Update button state and visibility with smooth transitions
        interruptButton.disabled = !shouldShowInterrupt;
        
        if (shouldShowInterrupt) {
            interruptButton.classList.add('visible');
            interruptButton.style.display = 'flex';
            // Force reflow to ensure the transition works
            void interruptButton.offsetHeight;
        } else {
            interruptButton.classList.remove('visible');
            // Wait for the transition to complete before hiding completely
            setTimeout(() => {
                if (interruptButton && !interruptButton.classList.contains('visible')) {
                    interruptButton.style.display = 'none';
                }
            }, 300); // Match this with the CSS transition duration
        }
    }
    
    // Update send button state
    if (sendButton) {
        sendButton.disabled = isProcessing;
        sendButton.innerHTML = isProcessing ? '<span class="spinner"></span> Sending...' : 'Send';
        if (!isProcessing) {
            removeFinalizingMessage();
        }
    }
    
    // Update input field state
    if (chatInputField) {
        chatInputField.disabled = isProcessing;
    }
}

// Handle interrupt button click
function handleInterrupt() {
    // Handle TTS interruption
    if (elevenLabsIsPlaying) {
        console.log('Interrupting TTS playback');
        stopElevenLabsPlaybackAndStream();
        // Don't return here, allow processing interruption if needed
    }
    
    // Handle processing interruption
    if (isProcessing) {
        console.log('Interrupting processing');
        if (pendingUserAction) {
            pendingUserAction = false;
            clearStatus();
            
            if (chatInputField && chatInputField.value.trim().length > 0) {
                sendMessage();
            }
        } else {
            isProcessing = false;
            updateProcessingUI();
        }
    }
    
    // Only show interruption message if we actually interrupted something
    if (elevenLabsIsPlaying || isProcessing) {
        addMessage('system', 'Operation interrupted by user.');
    }
}

function formatMessage(message, format = 'basic') {
    if (format === 'markdown') {
        // Simple markdown formatting - just convert newlines to <br> for now
        return message.replace(/\n/g, '<br>');
    }
    // Default formatting - escape HTML and preserve newlines
    return message
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
}

function humanizeStatusMessage(message) {
    const messageMap = {
        'Starting to work on your request...': '💭 Thinking...',
        'Starting execution of the plan...': '🔧 Working on it...',
        'Executing the plan...': '🚀 Almost there...',
        'query': '📨 Querying model...',
        'evalForUpdate': 'Evaluating results...',
        'finalizing': '✨ Finalizing response...'
    };

    if (messageMap[message]) {
        return messageMap[message];
    }

    if (message.includes('scored') && message.includes('Making adjustments')) {
        return '🔄 Improving the response...';
    }

    return message;
}

// Add a working message for the final response state
function showFinalizingMessage() {
    // Check if we already have a finalizing message
    const existingFinalizing = document.querySelector('.system-message[data-type="finalizing"]');
    if (existingFinalizing) {
        return existingFinalizing;
    }
    
    const workingMessage = {
        type: 'system',
        content: 'finalizing',
        format: 'working',
        timestamp: new Date().toISOString(),
        dataType: 'finalizing'  // Add data attribute to identify this message
    };
    
    // Add the message and get the message element
    const messageId = 'msg-' + Date.now();
    const messageElement = addMessage(
        workingMessage.type,
        workingMessage.content,
        workingMessage.format,
        messageId,
        { noAutoRemove: true, dataType: 'finalizing' }
    );

    return messageElement || workingMessage;
}

function removeFinalizingMessage() {
    const finalizingMessage = document.querySelector('.system-message[data-type="finalizing"]');
    if (finalizingMessage) {
        finalizingMessage.style.opacity = '0.5';
        setTimeout(() => {
            if (finalizingMessage && finalizingMessage.parentNode) {
                finalizingMessage.remove();
            }
        }, 300);
    }
    if (window.finalizingTimeout) {
        clearTimeout(window.finalizingTimeout);
        window.finalizingTimeout = null;
    }
}

function addMessage(type, content, format = 'basic', messageId = null, options = {}) {
    console.log('Adding message:', { type, content });
    
    // Handle object content (e.g., from WebSocket)
    let messageContent = content;
    let canvasContent = null;
    
    if (typeof content === 'object' && content !== null) {
        // If the content has a chat property, use that as the message content
        if (content.chat !== undefined) {
            messageContent = content.chat;
            canvasContent = content.canvas || null;
        } else {
            // If it's just an object, stringify it for display
            messageContent = JSON.stringify(content, null, 2);
        }
    }
    
    // Ensure messageContent is a string
    messageContent = String(messageContent);
    
    // For system messages, add them to the system messages container
    if (type === 'system') {
        // Check if this is a TTS error and should go to system errors instead
        if (messageContent.includes('Error from TTS service')) {
            if (subsystemMessages.systemError) {
                subsystemMessages.systemError.push({
                    content: messageContent,
                    timestamp: new Date().toISOString()
                });
                updateMessageCounts();
                
                // Update the output if the modal is open
                const errorModal = document.getElementById('system-error-modal');
                if (errorModal && !errorModal.classList.contains('hidden')) {
                    updateSubsystemOutput('systemError');
                }
            }
            return; // Don't show TTS errors in the main chat
        }
        
        // Add system message to the system messages container
        const systemMessagesContainer = document.getElementById('system-messages-container');
        if (systemMessagesContainer) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'system-message';
            if (options.dataType) {
                messageDiv.setAttribute('data-type', options.dataType);
            }
            messageDiv.innerHTML = messageContent.replace(/\n/g, '<br>');
            systemMessagesContainer.appendChild(messageDiv);

            // Auto-remove after 5 seconds for non-critical messages unless disabled
            if (!options.noAutoRemove && !messageContent.toLowerCase().includes('error')) {
                setTimeout(() => {
                    messageDiv.style.opacity = '0';
                    setTimeout(() => messageDiv.remove(), 300);
                }, 5000);
            }

            return messageDiv;
        }
        return null;
    }
    
    // For non-system messages, add them to the messages container
    const messagesDiv = document.getElementById('messages');
    if (!messagesDiv) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type} ${format}`;
    
    // Add message ID if provided
    if (messageId) {
        messageDiv.id = messageId;
    }
    
    // Format the message based on the format type
    if (format === 'working') {
        messageDiv.innerHTML = `
            <div class="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
            </div>
            <div class="message-content">${humanizeStatusMessage(messageContent)}</div>
        `;
    } else {
        messageDiv.innerHTML = `
            <div class="message-content">${formatMessage(messageContent, format)}</div>
        `;
    }
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    // If there's canvas content, update the canvas
    if (canvasContent) {
        updateCanvas(canvasContent);
    }

    return messageDiv;
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
    
    ws.onmessage = async (event) => {
        // Check if the message is binary (audio data)
        if (event.data instanceof Blob) {
            console.log(`Received binary blob of size: ${event.data.size} bytes`);
            try {
                const arrayBuffer = await event.data.arrayBuffer();
                console.log(`Converted blob to ArrayBuffer: ${arrayBuffer.byteLength} bytes`);
                
                if (arrayBuffer && arrayBuffer.byteLength > 0) {
                    console.log('Enqueuing audio chunk...');
                    await enqueueElevenLabsAudioChunk(arrayBuffer);
                } else {
                    console.warn('Received empty audio chunk');
                }
            } catch (e) {
                console.error('Error processing binary audio chunk:', e);
                // Try to continue with other chunks even if one fails
            }
            return; // Skip the rest of the handler for binary messages
        }

        // Handle text messages
        let data;
        try {
            data = JSON.parse(event.data);
            console.log('WebSocket message received:', data);
        } catch (e) {
            console.error('Error parsing WebSocket message:', e, 'Raw data:', event.data);
            return;
        }
        
        switch(data.type) {
            case 'response':
                // Clear any pending finalizing message or timeout
                removeFinalizingMessage();
                
                // Handle the response which may be nested in a response property
                let responseData = data.data;
                let responseText = '';
                
                // Check if the response is nested in a response property
                if (responseData && responseData.response) {
                    responseData = responseData.response;
                }
                
                // Handle both old and new response formats
                if (typeof responseData === 'string') {
                    // Old format: just a string response
                    responseText = responseData;
                } else if (responseData.chat !== undefined) {
                    // New format with chat and canvas
                    responseText = responseData.chat;
                    
                    // Update canvas if canvas content is provided
                    if (responseData.canvas) {
                        updateCanvas(responseData.canvas);
                    }
                } else {
                    // Fallback for any other format
                    responseText = JSON.stringify(responseData);
                }
                
                // Add the message to the chat - use the chat text or response text
                const displayText = responseData.chat || responseText;
                
                // Log the final response for debugging
                console.log('=== FINAL RESPONSE ===');
                console.log('Chat:', displayText);
                console.log('Canvas Content:', responseData.canvas ? 'Available' : 'None');
                console.log('Full Response:', JSON.stringify(responseData, null, 2));
                console.log('======================');
                
                addMessage('assistant', displayText);
                
                // Handle TTS - use the chat text if available, otherwise fall back to responseText
                let ttsText = responseData.chat || responseText;
                
                if (ttsText) {
                    if (typeof ttsText !== 'string') {
                        console.warn('Invalid text for TTS, converting to string');
                        ttsText = String(ttsText);
                    }
                    console.log('Playing TTS:', ttsText.substring(0, 100) + (ttsText.length > 100 ? '...' : ''));
                    
                    // Clear any existing audio queue before starting new TTS
                    if (elevenLabsCurrentSource) {
                        try {
                            elevenLabsCurrentSource.stop();
                        } catch (e) {
                            console.warn('Error stopping current audio source:', e);
                        }
                        elevenLabsCurrentSource = null;
                    }
                    
                    // Clear the queue and reset state
                    elevenLabsAudioQueue = [];
                    elevenLabsIsPlaying = false;
                    
                    // Start the new TTS
                    playElevenLabsTTS(ttsText);
                } else {
                    console.warn('No valid text found for TTS in response:', responseData);
                }
                
                clearStatus();
                break;
                
            case 'working':
                console.log('Working status update:', data.data.status);
                showStatus(data.data.status);
                
                // If this is the last working message before the final response,
                // show a finalizing message
                if (data.data.status === 'evalForUpdate') {
                    // Set a timeout to show the finalizing message if the response doesn't come soon
                    if (window.finalizingTimeout) {
                        clearTimeout(window.finalizingTimeout);
                    }
                    window.finalizingTimeout = setTimeout(() => {
                        // Only show if we haven't received a response yet
                        if (!document.querySelector('.message.assistant:last-child') || 
                            document.querySelector('.message.assistant:last-child').textContent.trim() === '') {
                            showFinalizingMessage();
                        }
                    }, 2000); // Show after 2 seconds if no response
                }
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
        // Reset utterance tracking state before sending
        hasSentFinalForCurrentUtterance = true; // Mark current utterance as sent
        inputFieldJustClearedBySend = true; // Indicate input was just cleared by a send operation
        
        // Send the message
        ws.send(JSON.stringify({
            message: message
        }));
        
        // Update UI and clear input
        addMessage('user', message);
        if (chatInputField) chatInputField.value = ''; // Clear the global chatInputField
        
        console.log('Message sent, reset utterance tracking state');
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
                    // Show the interrupt button and update UI
                    pendingUserAction = true;
                    updateProcessingUI();
                    
                    // Update status to inform user they can interrupt
                    if (voiceStatusIndicator) {
                        voiceStatusIndicator.textContent = 'Agent busy. Click Interrupt to send new query.';
                    }
                    // We don't send automatically anymore, user must click interrupt
                    // The interrupt handler will call sendMessage() if needed
                } else {
                    // Not processing, safe to send
                    sendMessage();
                    hasSentFinalForCurrentUtterance = true;
                    if (voiceStatusIndicator) voiceStatusIndicator.textContent = 'Sent. Listening...';
                }
            } else if (!hasSentFinalForCurrentUtterance) {
                // Handle the case when auto-send is off or it's a subsequent final
                if (isAutoSendEnabled) {
                    // Auto-send is on, send the message
                    sendMessage();
                    hasSentFinalForCurrentUtterance = true;
                    if (voiceStatusIndicator) voiceStatusIndicator.textContent = 'Sent. Listening...';
                } else if (orderedTurnsText.trim().length > 0) {
                    // Auto-send is off, just update the UI to show the message is ready to send
                    if (voiceStatusIndicator) voiceStatusIndicator.textContent = 'Ready to send. Click Send or press Enter.';
                    // Don't set hasSentFinalForCurrentUtterance to true so the user can send it manually
                }
            }
            // inputFieldJustClearedBySend remains true to guard against its own formatted final if message was sent.
        } else {
            // This 'else' covers all non-end_of_turn messages (partial transcripts, etc.)
            
            // Check if this is the start of a new utterance (no turns recorded yet or previous turn was finalized)
            const isNewUtterance = Object.keys(turns).length === 0 || hasSentFinalForCurrentUtterance;
            
            // If this is a new utterance, reset the flag
            if (isNewUtterance) {
                hasSentFinalForCurrentUtterance = false;
                console.log('Detected start of new utterance, resetting hasSentFinalForCurrentUtterance');
            }
            
            // If input was just cleared by send, AND this new partial has text,
            // AND a final has NOT yet been sent for the current logical utterance
            if (inputFieldJustClearedBySend && orderedTurnsText.trim().length > 0 && !hasSentFinalForCurrentUtterance) {
                inputFieldJustClearedBySend = false; // Allow this new partial to update the input
            }
            
            // Update status indicator based on whether a final has been sent for the current logical utterance
            if (hasSentFinalForCurrentUtterance) {
                // This partial is part of a formatted final or refinement after sending.
                if (voiceStatusIndicator) voiceStatusIndicator.textContent = 'Refining...';
            } else {
                // This is a partial for an ongoing, unsent utterance.
                if (voiceStatusIndicator) voiceStatusIndicator.textContent = 'Listening...';
            }
            
            // Update input field with current transcript if not just cleared by send
            if (!inputFieldJustClearedBySend && chatInputField) {
                chatInputField.value = orderedTurnsText;
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

async function stopElevenLabsPlaybackAndStream() {
    console.log('Stopping ElevenLabs playback and stream');
    
    // If already stopped, just ensure UI is updated and return
    if (!elevenLabsIsPlaying && !elevenLabsCurrentSource && !elevenLabsStreamReader) {
        console.log('TTS already stopped, updating UI state');
        updateProcessingUI(); // Ensure UI is in sync with state
        return;
    }
    
    // Stop any currently playing audio
    if (elevenLabsCurrentSource) {
        try {
            elevenLabsCurrentSource.stop();
            elevenLabsCurrentSource.disconnect();
            console.log('Stopped and disconnected audio source');
        } catch (e) {
            console.warn('Error stopping audio source:', e);
            // Ignore errors when stopping
        } finally {
            elevenLabsCurrentSource = null;
        }
    }

    // Clear the audio queue
    elevenLabsAudioQueue = [];
    audioDataBuffer = new Uint8Array(0);
    
    // Abort any in-progress fetch request
    if (elevenLabsFetchController) {
        console.log('Aborting in-progress fetch request');
        try {
            elevenLabsFetchController.abort();
        } catch (e) {
            console.warn('Error aborting fetch request:', e);
        } finally {
            elevenLabsFetchController = null;
        }
    }
    
    // Clean up the stream reader if it exists
    if (elevenLabsStreamReader) {
        console.log('Cancelling stream reader');
        try {
            await elevenLabsStreamReader.cancel();
        } catch (e) {
            console.warn('Error cancelling stream reader:', e);
            // Ignore cancellation errors
        } finally {
            elevenLabsStreamReader = null;
        }
    }
    
    // Update state and UI
    elevenLabsIsPlaying = false;
    console.log('elevenLabsIsPlaying set to false');
    
    // Force update the UI to reflect the stopped state
    updateProcessingUI();
    
    // Ensure the TTS-specific interrupt button is hidden
    if (interruptTTSButton) {
        interruptTTSButton.style.display = 'none';
    }
    
    // Double-check UI state after a short delay
    setTimeout(updateProcessingUI, 100);
}

function initializeElevenLabsAudio() {
    if (elevenLabsAudioContext) {
        console.log('AudioContext already initialized');
        return true;
    }
    
    try {
        console.log('Initializing new AudioContext...');
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        
        if (!AudioContext) {
            throw new Error('Web Audio API is not supported in this browser');
        }
        
        elevenLabsAudioContext = new AudioContext();
        
        // Log the sample rate for debugging
        console.log(`AudioContext created with sample rate: ${elevenLabsAudioContext.sampleRate}Hz`);
        
        // Set up error handling for the audio context
        if (elevenLabsAudioContext.state === 'suspended') {
            console.log('AudioContext started in suspended state, will resume on user interaction');
        }
        
        // Add event listeners for state changes
        elevenLabsAudioContext.addEventListener('statechange', () => {
            console.log(`AudioContext state changed to: ${elevenLabsAudioContext.state}`);
            
            if (elevenLabsAudioContext.state === 'suspended' && userInteracted) {
                console.log('Attempting to resume AudioContext after state change...');
                elevenLabsAudioContext.resume().catch(e => {
                    console.error('Error resuming AudioContext after state change:', e);
                });
            }
        });
        
        console.log('AudioContext initialized successfully');
        return true;
        
    } catch (e) {
        console.error('Failed to initialize AudioContext:', e);
        
        // Try to recover by creating a new context on error
        if (elevenLabsAudioContext) {
            try {
                elevenLabsAudioContext.close();
            } catch (closeError) {
                console.warn('Error closing failed AudioContext:', closeError);
            }
            elevenLabsAudioContext = null;
        }
        
        addMessage('system', 'Error: Could not initialize audio. Please refresh the page and try again.');
        return false;
    }
}

function isAudioDataValid(arrayBuffer) {
    // Basic validation of the audio data
    if (!arrayBuffer || arrayBuffer.byteLength < 44) { // WAV header is typically 44 bytes
        console.warn('Audio chunk is too small or invalid');
        return false;
    }
    
    // You can add more specific validation here if needed
    // For example, check for WAV/MP3 headers if you know the expected format
    
    return true;
}

async function enqueueElevenLabsAudioChunk(chunk, retryAttempt = 0) {
    console.log(`Processing audio chunk: ${chunk?.byteLength || 0} bytes, retry: ${retryAttempt}`);
    
    // Validate the input
    if (!chunk || !(chunk instanceof ArrayBuffer)) {
        console.error('Invalid audio chunk: not an ArrayBuffer');
        return;
    }
    
    if (!elevenLabsAudioContext) {
        console.log('Initializing AudioContext...');
        initializeElevenLabsAudio();
        if (!elevenLabsAudioContext) {
            if (retryAttempt < MAX_RETRY_ATTEMPTS) {
                const delay = 100 * (retryAttempt + 1);
                console.log(`Retrying AudioContext initialization in ${delay}ms (attempt ${retryAttempt + 1}/${MAX_RETRY_ATTEMPTS})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return enqueueElevenLabsAudioChunk(chunk, retryAttempt + 1);
            }
            console.error('Max retry attempts reached for AudioContext initialization');
            return;
        }
    }
    
    // Convert chunk to Uint8Array if it's an ArrayBuffer
    const chunkData = new Uint8Array(chunk);
    
    // Combine with any buffered data
    const combined = new Uint8Array(audioDataBuffer.length + chunkData.length);
    combined.set(audioDataBuffer);
    combined.set(chunkData, audioDataBuffer.length);
    
    try {
        // Only try to decode if we have enough data
        if (combined.length >= MIN_AUDIO_CHUNK_SIZE) {
            console.log(`Decoding combined audio chunk (${combined.length} bytes total)`);
            
            const audioBuffer = await elevenLabsAudioContext.decodeAudioData(
                combined.buffer.slice(0),
                (buffer) => {
                    console.log(`Successfully decoded audio buffer: ${buffer.duration.toFixed(2)}s, ${buffer.numberOfChannels} channels`);
                    return buffer;
                },
                (error) => {
                    console.error('Error in decodeAudioData callback:', error);
                    throw error;
                }
            );
            
            if (!audioBuffer) {
                throw new Error('Decoded audio buffer is null');
            }
            
            console.log(`Adding audio buffer to queue: ${audioBuffer.duration.toFixed(2)}s`);
            elevenLabsAudioQueue.push(audioBuffer);
            audioDataBuffer = new Uint8Array(0); // Clear the buffer after successful decode
            
            if (!elevenLabsIsPlaying) {
                console.log('Starting playback of audio queue');
                // Set the flag and update UI before starting playback
                elevenLabsIsPlaying = true;
                updateProcessingUI();
                playNextElevenLabsChunk();
            } else {
                console.log(`Audio is already playing, added to queue (${elevenLabsAudioQueue.length} items in queue)`);
            }
        } else {
            // Not enough data yet, store for next time
            console.log(`Buffering small chunk (${chunkData.length} bytes), total buffered: ${combined.length} bytes`);
            audioDataBuffer = combined;
        }
    } catch (e) {
        console.error('Error processing audio chunk:', e);
        
        if (retryAttempt < MAX_RETRY_ATTEMPTS) {
            const delay = 100 * (retryAttempt + 1);
            console.log(`Retrying audio chunk in ${delay}ms (attempt ${retryAttempt + 1}/${MAX_RETRY_ATTEMPTS})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return enqueueElevenLabsAudioChunk(chunk, retryAttempt + 1);
        }
        
        console.error('Max retry attempts reached for audio chunk, skipping...');
        audioDataBuffer = new Uint8Array(0); // Clear buffer on final failure
    }
}

function actuallyPlayNextChunk() {
    if (elevenLabsAudioQueue.length === 0) {
        console.log('Audio queue is empty, stopping playback');
        elevenLabsIsPlaying = false;
        return;
    }
    
    if (!elevenLabsAudioContext) {
        console.error('AudioContext not available for playback');
        elevenLabsIsPlaying = false;
        return;
    }
    
    const audioBuffer = elevenLabsAudioQueue.shift();
    if (!audioBuffer) {
        console.error('No audio buffer available for playback');
        return;
    }
    
    try {
        // Clean up any existing source
        if (elevenLabsCurrentSource) {
            try {
                elevenLabsCurrentSource.stop();
                elevenLabsCurrentSource.disconnect();
            } catch (e) {
                console.warn('Error cleaning up audio source:', e);
            }
        }
        
        // Create new audio source
        elevenLabsCurrentSource = elevenLabsAudioContext.createBufferSource();
        elevenLabsCurrentSource.buffer = audioBuffer;
        
        // Connect to destination through a gain node
        const gainNode = elevenLabsAudioContext.createGain();
        gainNode.gain.value = 1.0;
        
        elevenLabsCurrentSource.connect(gainNode);
        gainNode.connect(elevenLabsAudioContext.destination);
        
        // Set up event handlers
        elevenLabsCurrentSource.onended = () => {
            console.log('Audio playback ended, cleaning up');
            
            // Clean up nodes
            try {
                gainNode.disconnect();
            } catch (e) {
                console.warn('Error disconnecting gain node:', e);
            }
            
            // Clean up source
            if (elevenLabsCurrentSource) {
                try {
                    elevenLabsCurrentSource.disconnect();
                } catch (e) {
                    console.warn('Error disconnecting audio source:', e);
                } finally {
                    elevenLabsCurrentSource = null;
                }
            }
            
            if (elevenLabsAudioQueue.length > 0) {
                console.log('Playing next chunk from queue');
                playNextElevenLabsChunk();
            } else {
                console.log('No more chunks in queue, stopping playback');
                // Process any remaining buffered data before stopping
                if (audioDataBuffer?.length > 0) {
                    console.log('Processing remaining buffered audio data');
                    const bufferToPlay = audioDataBuffer;
                    audioDataBuffer = new Uint8Array(0);
                    enqueueElevenLabsAudioChunk(bufferToPlay);
                } else {
                    // Only stop if there's no more data to process
                    stopElevenLabsPlaybackAndStream();
                }
            }
        };
        
        // Start playback
        elevenLabsCurrentSource.start();
        elevenLabsIsPlaying = true;
        console.log('TTS playback started, updating UI');
        updateProcessingUI(); // Make sure UI is updated to show interrupt button
    } catch (e) {
        console.error('Error during audio playback:', e);
            
        // Clean up on error
        if (elevenLabsCurrentSource) {
            try {
                elevenLabsCurrentSource.stop();
                elevenLabsCurrentSource.disconnect();
            } catch (err) {
                console.warn('Error cleaning up after playback error:', err);
            }
            elevenLabsCurrentSource = null;
        }
            
        // Try to continue with next chunk if available
        if (elevenLabsAudioQueue.length > 0) {
            console.log('Attempting to play next chunk after error');
            setTimeout(() => playNextElevenLabsChunk(), 100);
        } else {
            elevenLabsIsPlaying = false;
        }
    }
}

function playNextElevenLabsChunk() {
    if (elevenLabsAudioQueue.length === 0) {
        console.log('Audio queue is empty, stopping playback');
        elevenLabsIsPlaying = false;
        updateProcessingUI(); // Update UI when queue is empty
        return;
    }
    
    // Update UI to show interrupt button when starting playback
    if (!elevenLabsIsPlaying) {
        console.log('Starting TTS playback, showing interrupt button');
        elevenLabsIsPlaying = true;
        updateProcessingUI();
    }

    // Ensure we have a valid audio context
    if (!elevenLabsAudioContext) {
        console.log('Initializing new AudioContext...');
        initializeElevenLabsAudio();
        
        if (!elevenLabsAudioContext) {
            console.error('Failed to initialize AudioContext');
            elevenLabsIsPlaying = false;
            return;
        }
    }
    
    // Handle suspended state
    if (elevenLabsAudioContext.state === 'suspended') {
        elevenLabsAudioContext.resume()
            .then(() => {
                // Small delay to ensure the context is fully ready
                setTimeout(() => actuallyPlayNextChunk(), 50);
            })
            .catch((error) => {
                console.error('Failed to resume AudioContext:', error);
                if (userInteracted) {
                    addMessage('system', 'Error: Could not resume audio playback. Please try again.');
                }
                elevenLabsIsPlaying = false;
            });
    } else {
        actuallyPlayNextChunk();
    }
}

async function playElevenLabsTTS(text) {
    // Check if TTS is enabled
    if (!isTTSEnabled) {
        console.log('TTS is currently disabled. Not playing message.');
        return;
    }
    
    // Clear any existing audio data buffer when starting new TTS
    audioDataBuffer = new Uint8Array(0);
    elevenLabsAudioQueue = [];
    elevenLabsIsPlaying = false; // Will be set to true by playNextElevenLabsChunk when first chunk plays
    if (elevenLabsCurrentSource) { // Should have been cleared by stopElevenLabsPlaybackAndStream if active
        try { elevenLabsCurrentSource.stop(); } catch(e) { /* ignore */ }
        elevenLabsCurrentSource = null;
    }

    // Reset the abort controller for this request
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
            
            // Process the stream
            while (true) {
                const { done, value } = await elevenLabsStreamReader.read();
                
                if (done) break;
                if (elevenLabsFetchController?.signal.aborted) break;
                
                await enqueueElevenLabsAudioChunk(value.buffer);
            }
        }

    } catch (error) {
        console.error('Error with ElevenLabs TTS:', error);
        if (subsystemMessages.systemError) {
            subsystemMessages.systemError.push({
                content: `TTS Error: ${error.message}`,
                timestamp: new Date().toISOString()
            });
            updateMessageCounts();
        }
        // Reset the abort controller and reader on error
        elevenLabsFetchController = null;
        elevenLabsStreamReader = null;
    } finally {
        const wasAborted = elevenLabsFetchController?.signal.aborted;

        if (elevenLabsStreamReader?.cancel) {
            try {
                await elevenLabsStreamReader.cancel('Stream finished, errored, or aborted.');
            } catch (e) {
                console.warn('Error cancelling stream reader:', e);
            }
            elevenLabsStreamReader = null;
        }
        
        if (!wasAborted && interruptTTSButton) {
            interruptTTSButton.style.display = 'none';
        }
        
        elevenLabsFetchController = null;
        
        if (elevenLabsIsPlaying && !wasAborted) {
            elevenLabsIsPlaying = false;
        }
    }
}

// --- Canvas Functions ---

/**
 * Simple markdown to HTML converter
 * @param {string} text - Markdown text to convert
 * @returns {string} HTML string
 */
function simpleMarkdownToHtml(text) {
    if (!text) return '';
    
    // Escape HTML to prevent XSS
    const escapeHtml = (unsafe) => {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    };
    
    // Split into lines and process each line
    const lines = text.split('\n');
    let inList = false;
    let inParagraph = false;
    let result = [];
    
    const closeParagraph = () => {
        if (inParagraph) {
            result.push('</p>');
            inParagraph = false;
        }
    };
    
    const closeList = () => {
        if (inList) {
            result.push('</ul>');
            inList = false;
        }
    };
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        
        // Skip empty lines
        if (!line) {
            closeParagraph();
            closeList();
            continue;
        }
        
        // Handle headers
        if (line.startsWith('#### ')) {
            closeParagraph();
            closeList();
            result.push(`<h4>${escapeHtml(line.substring(5))}</h4>`);
            continue;
        } else if (line.startsWith('### ')) {
            closeParagraph();
            closeList();
            result.push(`<h3>${escapeHtml(line.substring(4))}</h3>`);
            continue;
        } else if (line.startsWith('## ')) {
            closeParagraph();
            closeList();
            result.push(`<h2>${escapeHtml(line.substring(3))}</h2>`);
            continue;
        } else if (line.startsWith('# ')) {
            closeParagraph();
            closeList();
            result.push(`<h1>${escapeHtml(line.substring(2))}</h1>`);
            continue;
        }

        // Handle tables (simple pipe-delimited)
        const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';
        if (line.includes('|') && /^\|?\s*[-:| ]+\|?$/.test(nextLine)) {
            closeParagraph();
            closeList();

            const headers = line.split('|').filter(c => c.trim()).map(c => `<th>${escapeHtml(c.trim())}</th>`).join('');
            let tableHtml = `<table><thead><tr>${headers}</tr></thead><tbody>`;

            i += 2; // Skip header and separator
            while (i < lines.length) {
                const rowLine = lines[i].trim();
                if (!rowLine || !rowLine.includes('|')) {
                    i--; // adjust for for-loop increment
                    break;
                }
                const cells = rowLine.split('|').filter(c => c.trim()).map(c => `<td>${processInlineMarkdown(c.trim())}</td>`).join('');
                tableHtml += `<tr>${cells}</tr>`;
                i++;
            }
            tableHtml += '</tbody></table>';
            result.push(tableHtml);
            continue;
        }
        
        // Handle lists
        if (/^[-*+]\s+/.test(line)) {
            closeParagraph();
            if (!inList) {
                result.push('<ul>');
                inList = true;
            }
            line = line.replace(/^[-*+]\s+/, '');
            result.push(`<li>${processInlineMarkdown(line)}</li>`);
            continue;
        }
        
        // If we get here, it's a regular paragraph line
        closeList();
        
        // Start a new paragraph if needed
        if (!inParagraph) {
            result.push('<p>');
            inParagraph = true;
        } else {
            // Add a space between lines in the same paragraph
            result.push(' ');
        }
        
        // Process inline markdown (bold, italic, links)
        result.push(processInlineMarkdown(line));
    }
    
    // Close any open tags
    closeParagraph();
    closeList();
    
    return result.join('');
}

/**
 * Process inline markdown (bold, italic, links) in a line
 * @param {string} line - The line to process
 * @returns {string} Processed HTML
 */
function processInlineMarkdown(line) {
    // Escape HTML first
    let result = line
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    
    // Process links
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, 
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    
    // Process bold and italic
    result = result
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/_([^_]+)_/g, '<em>$1</em>');
    
    return result;
}

/**
 * Updates the canvas with the provided content
 * @param {Object} canvasData - The canvas data to display
 * @param {string} canvasData.type - The type of content ('html', 'markdown', or 'text')
 * @param {string} canvasData.content - The content to display
 */
function updateCanvas(canvasData) {
    console.log('=== UPDATING CANVAS ===');
    console.log('Canvas Data:', canvasData);
    
    const canvasContent = document.getElementById('canvas-content');
    if (!canvasContent) {
        console.error('Canvas content element not found!');
        return;
    }
    
    // Make canvas visible
    const canvasContainer = document.getElementById('canvas-container');
    if (canvasContainer) {
        canvasContainer.style.display = 'block';
    }
    
    // Clear the canvas
    canvasContent.innerHTML = '';
    
    if (!canvasData || !canvasData.content) {
        console.log('No canvas data or content provided');
        // Show placeholder if no content
        canvasContent.innerHTML = `
            <div class="canvas-placeholder">
                <p>No content to display</p>
                <p><small>This area can display rich content like data visualizations, images, or formatted text.</small></p>
            </div>
        `;
        return;
    }
    
    console.log('Setting canvas content, type:', canvasData.type);
    
    try {
        // Handle different content types
        if (canvasData.type === 'html') {
            canvasContent.innerHTML = canvasData.content;
        } else if (canvasData.type === 'markdown' || canvasData.type === 'text') {
            // For text or markdown, apply simple markdown parsing
            const content = canvasData.content;
            const isLikelyMarkdown = 
                content.includes('## ') || // Headers
                content.includes('**') ||  // Bold
                content.includes('*') ||   // Italic or lists
                content.includes('__') ||  // Bold/italic
                content.match(/\[.*?\]\(.*?\)/); // Links
                
            if (canvasData.type === 'markdown' || isLikelyMarkdown) {
                // Apply simple markdown to HTML conversion
                canvasContent.innerHTML = `<div class="markdown-content">${simpleMarkdownToHtml(content)}</div>`;
                
                // Add some basic styling
                const style = document.createElement('style');
                style.textContent = `
                    .markdown-content { line-height: 1.6; }
                    .markdown-content h1 { 
                        font-size: 1.8em; 
                        border-bottom: 1px solid #eaecef; 
                        padding-bottom: 0.3em;
                        margin: 1em 0 0.5em 0;
                    }
                    .markdown-content h2 { 
                        font-size: 1.5em;
                        border-bottom: 1px solid #eaecef;
                        padding-bottom: 0.3em;
                        margin: 1em 0 0.5em 0;
                    }
                    .markdown-content h3 {
                        font-size: 1.25em;
                        margin: 1em 0 0.5em 0;
                    }
                    .markdown-content h4 {
                        font-size: 1.1em;
                        margin: 1em 0 0.5em 0;
                    }
                    .markdown-content p {
                        margin: 0 0 1em 0;
                    }
                    .markdown-content ul,
                    .markdown-content ol {
                        padding-left: 2em;
                        margin: 0 0 1em 0;
                    }
                    .markdown-content li { 
                        margin: 0.25em 0; 
                    }
                    .markdown-content a { 
                        color: #0366d6;
                        text-decoration: none;
                    }
                    .markdown-content a:hover { 
                        text-decoration: underline;
                    }
                    .markdown-content strong { 
                        font-weight: 600;
                    }
                    .markdown-content em {
                        font-style: italic;
                    }
                    .markdown-content table {
                        border-collapse: collapse;
                        margin: 1em 0;
                    }
                    .markdown-content th,
                    .markdown-content td {
                        border: 1px solid #ddd;
                        padding: 6px 13px;
                    }
                    .markdown-content th {
                        background-color: #f6f8fa;
                    }
                `;
                document.head.appendChild(style);
            } else {
                // Plain text
                const pre = document.createElement('pre');
                pre.style.whiteSpace = 'pre-wrap';
                pre.textContent = content;
                canvasContent.appendChild(pre);
            }
        } else {
            // Default to text if type is not specified or unsupported
            const pre = document.createElement('pre');
            pre.style.whiteSpace = 'pre-wrap';
            pre.textContent = canvasData.content;
            canvasContent.appendChild(pre);
        }
    } catch (error) {
        console.error('Error rendering canvas content:', error);
        // Fallback to plain text display on error
        const pre = document.createElement('pre');
        pre.style.whiteSpace = 'pre-wrap';
        pre.textContent = `Error: ${error.message}\n\n${canvasData.content}`;
        canvasContent.appendChild(pre);
    }
    
    // Scroll to top of canvas
    canvasContent.scrollTop = 0;
}

// --- Toggle UI Updates ---
function updateTTSToggleUI(button, isEnabled) {
    if (!button) return;
    
    const icon = button.querySelector('.tts-icon');
    const text = button.querySelector('.tts-text');
    
    if (isEnabled) {
        button.classList.add('active');
        if (icon) icon.textContent = '🔊'; // Speaker icon
        if (text) text.textContent = 'TTS: On';
    } else {
        button.classList.remove('active');
        if (icon) icon.textContent = '🔇'; // Muted speaker icon
        if (text) text.textContent = 'TTS: Off';
    }
}

function updateAutoSendToggleUI(button, isEnabled) {
    if (!button) return;
    
    const icon = button.querySelector('.auto-send-icon');
    const text = button.querySelector('.auto-send-text');
    
    if (isEnabled) {
        button.classList.add('active');
        if (icon) icon.textContent = '🚀'; // Rocket icon
        if (text) text.textContent = 'Auto-send: On';
    } else {
        button.classList.remove('active');
        if (icon) icon.textContent = '✋'; // Hand icon
        if (text) text.textContent = 'Auto-send: Off';
    }
}

// --- ElevenLabs TTS Functions End ---

// Add user interaction handler to ensure AudioContext is properly resumed
document.addEventListener('click', () => {
    userInteracted = true;
    if (elevenLabsAudioContext && elevenLabsAudioContext.state === 'suspended') {
        elevenLabsAudioContext.resume().then(() => {
            console.log('AudioContext resumed after user interaction');
            // If we were trying to play something, retry now
            if (elevenLabsAudioQueue.length > 0 && !elevenLabsIsPlaying) {
                playNextElevenLabsChunk();
            }
        }).catch(e => {
            console.error('Error resuming AudioContext after user interaction:', e);
        });
    }
}, { once: false });

document.addEventListener('DOMContentLoaded', () => {
    // Assign critical UI elements first
    chatInputField = document.getElementById('chatInput');
    sendButton = document.getElementById('send-button'); // Assign sendButton globally
    voiceInputToggleBtn = document.getElementById('voiceInputToggle');
    autoSendToggleCheckbox = document.getElementById('autoSendToggle');
    voiceStatusIndicator = document.getElementById('voiceStatusIndicator');
    interruptTTSButton = document.getElementById('interrupt-tts-button'); // Assign TTS interrupt button
    interruptButton = document.getElementById('interrupt-button'); // Assign general interrupt button
    
    // Set up interrupt button
    if (interruptButton) {
        interruptButton.addEventListener('click', handleInterrupt);
        interruptButton.style.display = 'none'; // Start hidden
        
        // Create and append the interrupt button content if it doesn't exist
        if (!interruptButton.querySelector('.interrupt-icon')) {
            interruptButton.innerHTML = `
                <span class="interrupt-icon">⏹️</span>
                <span class="interrupt-text">Interrupt</span>
            `;
        }
    } else {
        console.warn('Interrupt button not found in the DOM.');
    }

    connect(); // Establishes WebSocket and might enable/disable inputs in ws.onopen

    if (interruptTTSButton) {
        interruptTTSButton.addEventListener('click', stopElevenLabsPlaybackAndStream);
    } else {
        console.warn('Interrupt TTS button (interrupt-tts-button) not found in the DOM.');
    }
    
    // Initialize TTS toggle button
    const ttsToggle = document.getElementById('ttsToggle');
    if (ttsToggle) {
        // Load saved TTS preference from localStorage, default to true (enabled)
        isTTSEnabled = localStorage.getItem('ttsEnabled') !== 'false';
        updateTTSToggleUI(ttsToggle, isTTSEnabled);
        
        ttsToggle.addEventListener('click', () => {
            isTTSEnabled = !isTTSEnabled;
            localStorage.setItem('ttsEnabled', isTTSEnabled);
            updateTTSToggleUI(ttsToggle, isTTSEnabled);
            
            // If disabling TTS while it's playing, stop the playback
            if (!isTTSEnabled && (elevenLabsIsPlaying || elevenLabsStreamReader)) {
                stopElevenLabsPlaybackAndStream();
            }
            
            // Show feedback to the user
            const status = isTTSEnabled ? 'enabled' : 'disabled';
            addMessage('system', `Text-to-speech has been ${status}.`);
        });
    } else {
        console.warn('TTS toggle button not found in the DOM.');
    }
    
    // Initialize Auto-send toggle button
    autoSendToggle = document.getElementById('autoSendToggle');
    if (autoSendToggle) {
        // Initialize the UI based on the current state
        updateAutoSendToggleUI(autoSendToggle, isAutoSendEnabled);
        
        // Add click event listener
        autoSendToggle.addEventListener('click', () => {
            // Toggle the state
            isAutoSendEnabled = !isAutoSendEnabled;
            // Save to localStorage
            localStorage.setItem('autoSendEnabled', isAutoSendEnabled);
            // Update the UI
            updateAutoSendToggleUI(autoSendToggle, isAutoSendEnabled);
            
            // Provide feedback to the user
            const status = isAutoSendEnabled ? 'enabled' : 'disabled';
            addMessage('system', `Auto-send ${status}. ${isAutoSendEnabled ? 'Messages will be sent automatically.' : 'Click Send or press Enter to send messages.'}`);
        });
    } else {
        console.warn('Auto-send toggle button not found in the DOM.');
    }
    
    // Initialize message counts
    updateMessageCounts();

    if (chatInputField) {
        chatInputField.addEventListener('keypress', function(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault(); // Prevent newline in input
                sendMessage();
            }
        });
    }

    if (sendButton) {
        sendButton.addEventListener('click', function() {
            // Disable button and show spinner when clicked
            sendButton.disabled = true;
            sendButton.innerHTML = '<span class="spinner"></span> Sending...';
            sendMessage();
        });
    }

    // Check for chatInputField existence before proceeding with STT specific UI checks
    if (!chatInputField && voiceInputToggleBtn) { // Ensure voiceInputToggleBtn exists before trying to disable
        console.warn("Chat input field (id='chatInput') not found. STT will be disabled.");
        if(voiceStatusIndicator) voiceStatusIndicator.textContent = 'Chat Input Missing.';
        voiceInputToggleBtn.disabled = true;
    } else if (voiceInputToggleBtn) { // Only proceed if voice toggle exists
        // Setup event listeners for the voice input toggle button
        voiceInputToggleBtn.addEventListener('click', toggleVoiceSTT);
        
        // Update voice button UI based on recording state
        const updateVoiceButtonUI = (isRecording) => {
            const icon = voiceInputToggleBtn.querySelector('.voice-icon');
            const text = voiceInputToggleBtn.querySelector('.voice-text');
            
            if (isRecording) {
                voiceInputToggleBtn.classList.add('recording');
                if (icon) icon.textContent = '⏹️';
                if (text) text.textContent = 'Stop';
            } else {
                voiceInputToggleBtn.classList.remove('recording');
                if (icon) icon.textContent = '🎤';
                if (text) text.textContent = 'Start Voice';
            }
        };
        
        // Save original toggleVoiceSTT function
        const originalToggleVoiceSTT = toggleVoiceSTT;
        
        // Wrap the original function to update UI
        toggleVoiceSTT = function() {
            const wasRecording = isRecording;
            const result = originalToggleVoiceSTT.apply(this, arguments);
            
            // If the recording state changed, update the UI
            if (wasRecording !== isRecording) {
                updateVoiceButtonUI(isRecording);
            }
            
            return result;
        };
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
