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
        const userInput = document.getElementById('user-input');
        userInput.disabled = false;
        connectionError = false; // Reset connection error state on successful connection
        document.getElementById('send-button').disabled = false;
        showStatus('Connected to server', { noSpinner: true });
        
        // Auto-focus the chat input after connection is established
        userInput.focus();
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
    const input = document.getElementById('user-input');
    const message = input.value.trim();
    
    if (message && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            message: message
        }));
        
        addMessage('user', message);
        input.value = '';
    }
}

// Initialize WebSocket connection
document.addEventListener('DOMContentLoaded', () => {
    connect();
    
    // Initialize message counts
    updateMessageCounts();
    
    const userInput = document.getElementById('user-input');
    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
    
    document.getElementById('send-button').addEventListener('click', sendMessage);

    // Close modals on background click
    document.getElementById('debug-modal').addEventListener('click', (e) => {
        if (e.target.id === 'debug-modal') {
            toggleDebug();
        }
    });
    
    document.getElementById('results-modal').addEventListener('click', (e) => {
        if (e.target.id === 'results-modal') {
            toggleResults();
        }
    });
    
    document.getElementById('system-error-modal').addEventListener('click', (e) => {
        if (e.target.id === 'system-error-modal') {
            toggleSystemErrors();
        }
    });
});
