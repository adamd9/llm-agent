const fs = require('fs').promises;
const path = require('path');

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
                    if (!parsedParams.lines || typeof parsedParams.lines !== 'number') {
                        throw new Error('Missing or invalid required parameter: lines (number)');
                    }
                    return await this.tailLogs(parsedParams.lines);
                
                case 'listSrcFiles':
                    return await this.listSrcFiles();
                
                case 'readSrcFile':
                    const filenameParam = parsedParams.find(param => param.name === 'filename');
                    if (!filenameParam) {
                        throw new Error('Missing required parameter: filename');
                    }
                    return await this.readSrcFile(filenameParam.value);
                
                default:
                    throw new Error(`Unknown action: ${action}`);
            }
        } catch (error) {
            return {
                status: 'error',
                error: error.message,
                stack: error.stack
            };
        }
    }

    async tailLogs(lines) {
        try {
            const logPath = path.join(this.basePath, '../data/logs/current.log');
            const logContent = await fs.readFile(logPath, 'utf-8');
            const logLines = logContent.split('\n');
            const lastLines = logLines.slice(-lines);

            return {
                status: 'success',
                lines: lastLines,
                count: lastLines.length
            };
        } catch (error) {
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