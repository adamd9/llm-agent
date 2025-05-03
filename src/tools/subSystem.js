const fs = require('fs').promises;
const path = require('path');
const sharedEventEmitter = require('../utils/eventEmitter');

class SubsystemTool {
    constructor() {
        this.name = 'subsystem';
        this.description = 'Tool for system self-inspection and introspection';
        this.basePath = path.resolve(__dirname);
    }

    async execute(action, parameters) {
        console.log('SubsystemTool executing:', { action, parameters });
        try {
            // Parse parameters if they're passed as a string
            let parsedParams = parameters;
            if (typeof parameters === 'string') {
                try {
                    parsedParams = JSON.parse(parameters);
                } catch (parseError) {
                    return {
                        status: 'error',
                        error: 'Invalid parameters format',
                        details: parseError.message
                    };
                }
            }

            console.log('Executing action:', action);
            console.log('Parameters:', parameters);
            if (Array.isArray(parameters)) {
                parameters.forEach(param => {
                    console.log(`Parameter Name: ${param.name}, Value: ${param.value}`);
                });
            }

            switch (action) {
                case 'tailLogs':
                    // Handle both object format and array format parameters
                    let linesValue;
                    
                    if (Array.isArray(parsedParams)) {
                        const linesParam = parsedParams.find(param => param.name === 'lines');
                        if (!linesParam) {
                            throw new Error('Missing required parameter: lines');
                        }
                        linesValue = linesParam.value;
                    } else {
                        linesValue = parsedParams.lines;
                    }
                    
                    // Convert string to number if needed
                    if (typeof linesValue === 'string') {
                        linesValue = parseInt(linesValue, 10);
                    }
                    
                    // Validate the number
                    if (isNaN(linesValue) || typeof linesValue !== 'number') {
                        throw new Error('Invalid parameter: lines must be a number');
                    }
                    
                    return await this.tailLogs(linesValue);
                
                case 'listSrcFiles':
                    return await this.listSrcFiles();
                
                case 'readSrcFile':
                    // Handle both object format and array format parameters
                    let filename;
                    
                    if (Array.isArray(parsedParams)) {
                        const filenameParam = parsedParams.find(param => param.name === 'filename');
                        if (!filenameParam) {
                            throw new Error('Missing required parameter: filename');
                        }
                        filename = filenameParam.value;
                    } else {
                        filename = parsedParams.filename;
                        if (!filename) {
                            throw new Error('Missing required parameter: filename');
                        }
                    }
                    
                    return await this.readSrcFile(filename);
                
                default:
                    throw new Error(`Unknown action: ${action}`);
            }
        } catch (error) {
            // Emit system error message
            sharedEventEmitter.emit('systemError', {
                module: 'subSystemTool',
                content: {
                    type: 'system_error',
                    error: error.message,
                    stack: error.stack,
                    location: `execute.${action}`,
                    status: 'error'
                }
            });
            
            return {
                status: 'error',
                error: error.message,
                stack: error.stack
            };
        }
    }

    async tailLogs(lines) {
        try {
            // Update the path to look for logs in the data/temp directory instead
            const logPath = path.join(this.basePath, '../../data/temp');
            
            // Check if directory exists
            try {
                await fs.access(logPath);
            } catch (error) {
                throw new Error(`Logs directory does not exist: ${logPath}`);
            }
            
            // List files in the directory
            const files = await fs.readdir(logPath);
            
            // Filter for log files (assuming they have a .log or .json extension)
            const logFiles = files.filter(file => file.endsWith('.log') || file.endsWith('.json'));
            
            if (logFiles.length === 0) {
                throw new Error(`No log files found in ${logPath}`);
            }
            
            // Sort by modification time (newest first)
            const fileStats = await Promise.all(
                logFiles.map(async file => {
                    const filePath = path.join(logPath, file);
                    const stats = await fs.stat(filePath);
                    return { file, stats };
                })
            );
            
            fileStats.sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());
            
            // Read the most recent log file
            const mostRecentLog = fileStats[0].file;
            const mostRecentLogPath = path.join(logPath, mostRecentLog);
            const logContent = await fs.readFile(mostRecentLogPath, 'utf-8');
            
            // Split by lines and get the last 'lines' number of lines
            const logLines = logContent.split('\n');
            const lastLines = logLines.slice(-lines);

            return {
                status: 'success',
                file: mostRecentLog,
                lines: lastLines,
                count: lastLines.length
            };
        } catch (error) {
            // Emit system error message
            sharedEventEmitter.emit('systemError', {
                module: 'subSystemTool',
                content: {
                    type: 'system_error',
                    error: error.message,
                    stack: error.stack,
                    location: 'tailLogs',
                    status: 'error'
                }
            });
            
            throw new Error(`Failed to read logs: ${error.message}`);
        }
    }

    async listSrcFiles() {

        try {
            const srcPath = path.join(this.basePath, '../');
            console.log('Listing src files from:', srcPath);
            const files = await fs.readdir(srcPath);
            
            const fileDetails = await Promise.all(files.map(async (file) => {
                const filePath = path.join(srcPath, file);
                const stats = await fs.stat(filePath);
                return {
                    name: file,
                    size: stats.size,
                    isDirectory: stats.isDirectory(),
                    created: stats.birthtime,
                    modified: stats.mtime
                };
            }));

            return {
                status: 'success',
                files: fileDetails
            };
        } catch (error) {
            // Emit system error message
            sharedEventEmitter.emit('systemError', {
                module: 'subSystemTool',
                content: {
                    type: 'system_error',
                    error: error.message,
                    stack: error.stack,
                    location: 'listSrcFiles',
                    status: 'error'
                }
            });
            
            throw new Error(`Failed to list src files: ${error.message}`);
        }
    }

    async readSrcFile(filename) {
        try {
            // Basic security check for path traversal
            if (filename.includes('..') || filename.includes('/')) {
                throw new Error('Invalid filename: must not contain path separators');
            }

            const filePath = path.join(this.basePath, '../', filename);
            const content = await fs.readFile(filePath, 'utf-8');

            return {
                status: 'success',
                filename,
                content
            };
        } catch (error) {
            // Emit system error message
            sharedEventEmitter.emit('systemError', {
                module: 'subSystemTool',
                content: {
                    type: 'system_error',
                    error: error.message,
                    stack: error.stack,
                    location: `readSrcFile.${filename}`,
                    status: 'error'
                }
            });
            
            throw new Error(`Failed to read file ${filename}: ${error.message}`);
        }
    }

    getCapabilities() {
        return {
            name: this.name,
            description: this.description,
            actions: [
                {
                    name: 'tailLogs',
                    description: 'Retrieve the last N lines from the application logs',
                    parameters: [
                        {
                            name: 'lines',
                            description: 'Number of log lines to retrieve',
                            type: 'number',
                            required: true
                        }
                    ]
                },
                {
                    name: 'listSrcFiles',
                    description: 'List all files in the src directory',
                    parameters: [] // No parameters needed
                },
                {
                    name: 'readSrcFile',
                    description: 'Read contents of a specific file from the src directory',
                    parameters: [
                        {
                            name: 'filename',
                            description: 'Name of the file to read (without path)',
                            type: 'string',
                            required: true
                        }
                    ]
                }
            ]
        };
    }
}

module.exports = new SubsystemTool();