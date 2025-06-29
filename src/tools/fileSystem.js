const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');
const { DATA_DIR_PATH } = require('../utils/dataDir'); // Import the centralized path

class FileSystemTool {
    constructor() {
        this.dataRoot = DATA_DIR_PATH; // Directory with write permissions
        this.projectRoot = path.resolve(__dirname, '../..');
        // Logging for dataRoot selection is now handled in dataDir.js
        this.name = 'fileSystem';
        // Clarify this operates on the agent's own file system
        this.description = 'Access the agent\'s project files. Allows reading from the entire project while write operations are limited to the data directory.';
    }

    async initialize() {
        // Ensure data directory exists
        try {
            await fs.access(this.dataRoot);
        } catch {
            await fs.mkdir(this.dataRoot, { recursive: true });
        }
    }

    // Resolve a path relative to the project root and ensure it doesn't escape it
    _resolvePath(filePath) {
        logger.debug('resolvePath', 'Resolving path', {
            filePath,
            projectRoot: this.projectRoot
        });

        const base = filePath && filePath !== '/' && filePath !== '.' ? filePath : '.';
        const normalized = path.isAbsolute(base) ? base : path.join(this.projectRoot, base);
        const resolved = path.resolve(normalized);

        if (!resolved.startsWith(this.projectRoot)) {
            throw new Error('Path must be within project root');
        }

        return resolved;
    }

    // Validate that a path to be written is inside the data directory
    _validateWritePath(filePath) {
        const abs = path.isAbsolute(filePath)
            ? path.resolve(filePath)
            : path.resolve(this.projectRoot, filePath);
        if (!abs.startsWith(this.dataRoot)) {
            throw new Error('Write operations allowed only within data directory');
        }
        return abs;
    }

    async execute(action, parameters) {
        logger.debug('FileSystem executing:', JSON.stringify({ action, parameters }));
        try {
            // Parse parameters if they're passed as a string
            let parsedParams = parameters;
            if (typeof parameters === 'string') {
                try {
                    parsedParams = JSON.parse(parameters);
                } catch (parseError) {
                    logger.error('Parameter parsing error:', {
                        error: parseError.message,
                        parameters
                    });
                    return {
                        status: 'error',
                        error: 'Invalid parameters format',
                        details: parseError.message
                    };
                }
            }

            switch (action) {
                case 'read':
                    const readPathParam = parsedParams.find(param => param.name === 'path');
                    if (!readPathParam) {
                        throw new Error('Missing required parameter: path');
                    }
                    return await this.readFile(readPathParam.value);

                case 'write':
                    const writePathParam = parsedParams.find(param => param.name === 'path');
                    const writeContentParam = parsedParams.find(param => param.name === 'content');
                    if (!writePathParam || !writeContentParam) {
                        throw new Error('Missing required parameters for write: path and content');
                    }
                    return await this.writeFile(writePathParam.value, writeContentParam.value);

                case 'delete':
                    const deletePathParam = parsedParams.find(param => param.name === 'path');
                    if (!deletePathParam) {
                        throw new Error('Missing required parameter: path');
                    }
                    return await this.deleteFile(deletePathParam.value);

                case 'rename':
                    const oldPathParam = parsedParams.find(p => p.name === 'oldPath');
                    const newPathParam = parsedParams.find(p => p.name === 'newPath');
                    if (!oldPathParam || !newPathParam) {
                        throw new Error('Missing required parameters: oldPath and newPath');
                    }
                    return await this.renameFile(oldPathParam.value, newPathParam.value);

                case 'copy':
                    const srcPathParam = parsedParams.find(p => p.name === 'srcPath');
                    const destPathParam = parsedParams.find(p => p.name === 'destPath');
                    if (!srcPathParam || !destPathParam) {
                        throw new Error('Missing required parameters: srcPath and destPath');
                    }
                    return await this.copyFile(srcPathParam.value, destPathParam.value);

                case 'list':
                    const listPathParam = parsedParams.find(param => param.name === 'path');
                    return await this.listFiles(listPathParam ? listPathParam.value : '.');


                case 'exists':
                    const existsPathParam = parsedParams.find(param => param.name === 'path');
                    if (!existsPathParam) {
                        throw new Error('Missing required parameter: path');
                    }
                    return await this.fileExists(existsPathParam.value);

                default:
                    throw new Error(`Unknown action: ${action}`);
            }
        } catch (error) {
            console.error('FileSystem tool error:', {
                error: error.message,
                stack: error.stack,
                action,
                parameters
            });
            return {
                status: 'error',
                error: error.message,
                stack: error.stack,
                action,
                parameters
            };
        }
    }

    async readFile(filePath) {
        const validPath = this._resolvePath(filePath);
        const content = await fs.readFile(validPath, 'utf8');
        return {
            status: 'success',
            content,
            path: validPath
        };
    }

    async writeFile(filePath, content) {
        if (!content) {
            return {
                status: 'error',
                error: 'Content is required for write operation'
            };
        }

        let fileHandle;
        try {
            const validPath = this._validateWritePath(filePath);
            
            // Use file handle for atomic write
            fileHandle = await fs.open(validPath, 'w');
            try {
                await fileHandle.writeFile(content);
                await fileHandle.sync(); // Force write to disk
            } finally {
                if (fileHandle) {
                    await fileHandle.close();
                }
            }
            
            // Verify the write was successful
            const written = await fs.readFile(validPath, 'utf8');
            if (written !== content) {
                throw new Error(`File content verification failed. Expected "${content}" but got "${written}"`);
            }

            return {
                status: 'success',
                path: validPath,
                content: content,
                size: Buffer.from(content).length
            };
        } catch (error) {
            console.error('Write error:', {
                error: error.message,
                stack: error.stack,
                path: filePath
            });
            return {
                status: 'error',
                error: `Failed to write file ${filePath}: ${error.message}`,
                details: {
                    originalError: error.message,
                    stack: error.stack,
                    path: filePath
                }
            };
        }
    }

    async deleteFile(filePath) {
        const validPath = this._validateWritePath(filePath);
        await fs.unlink(validPath);
        return {
            status: 'success',
            path: validPath
        };
    }

    async renameFile(oldPath, newPath) {
        const src = this._validateWritePath(oldPath);
        const dest = this._validateWritePath(newPath);
        await fs.rename(src, dest);
        return {
            status: 'success',
            from: src,
            to: dest
        };
    }

    async copyFile(srcPath, destPath) {
        const src = this._resolvePath(srcPath);
        const dest = this._validateWritePath(destPath);
        await fs.copyFile(src, dest);
        return {
            status: 'success',
            from: src,
            to: dest
        };
    }

    async listFiles(dirPath) {
        const validPath = this._resolvePath(dirPath);

        const root = this.projectRoot;
        async function getFilesRecursively(currentPath) {
            try {
                const items = (await fs.readdir(currentPath, { withFileTypes: true }))
                    .filter(item => !item.name.startsWith('.')); // skip hidden files
                const files = await Promise.all(items.map(async item => {
                    const fullPath = path.join(currentPath, item.name);
                    try {
                        const stats = await fs.stat(fullPath);
                        const result = {
                            name: item.name,
                            path: path.relative(root, fullPath),
                            type: item.isDirectory() ? 'directory' : 'file',
                            size: stats.size,
                            modifiedTime: stats.mtime
                        };

                        if (item.isDirectory()) {
                            try {
                                result.children = await getFilesRecursively(fullPath);
                            } catch (dirError) {
                                // If we can't read directory contents, mark it as inaccessible
                                result.children = [];
                                result.error = 'Directory not accessible';
                            }
                        }

                        return result;
                    } catch (statError) {
                        // If we can't stat the file, return basic info
                        return {
                            name: item.name,
                            path: path.relative(root, fullPath),
                            type: 'unknown',
                            error: 'File not accessible'
                        };
                    }
                }));

                return files;
            } catch (error) {
                if (error.code === 'ENOENT') {
                    // Directory doesn't exist, return empty array
                    return [];
                }
                throw error; // Re-throw other errors
            }
        }

        try {
            // Check that directory exists before reading
            await fs.access(validPath);
            const files = await getFilesRecursively(validPath);

            return {
                status: 'success',
                files,
                path: validPath
            };
        } catch (error) {
            if (error.code === 'ENOENT') {
                return {
                    status: 'error',
                    error: 'Directory does not exist',
                    path: validPath
                };
            }
            return {
                status: 'error',
                error: error.message,
                path: validPath
            };
        }
    }


    async fileExists(filePath) {
        const validPath = this._resolvePath(filePath);
        try {
            await fs.access(validPath);
            return {
                status: 'success',
                exists: true,
                path: validPath
            };
        } catch {
            return {
                status: 'success',
                exists: false,
                path: validPath
            };
        }
    }

    getCapabilities() {
        return {
            name: this.name,
            description: this.description,
            actions: [
                {
                    name: 'list',
                    description: 'List all non-hidden files starting from a directory in the agent project',
                    parameters: []
                },
                {
                    name: 'read',
                    description: 'Read a file',
                    parameters: [{
                        name: 'path',
                        description: 'Path to the file to read',
                        type: 'string',
                        required: true
                    }]
                },
                {
                    name: 'write',
                    description: 'Write to a file',
                    parameters: [
                        {
                            name: 'path',
                            description: 'Path to write',
                            type: 'string',
                            required: true
                        },
                        {
                            name: 'content',
                            description: 'Content to write to the file',
                            type: 'string',
                            required: true
                        }
                    ]
                },
                {
                    name: 'delete',
                    description: 'Delete a file',
                    parameters: [{
                        name: 'path',
                        description: 'Path to delete',
                        type: 'string',
                        required: true
                    }]
                },
                {
                    name: 'exists',
                    description: 'Check if a file exists',
                    parameters: [{
                        name: 'path',
                        description: 'Path to check',
                        type: 'string',
                        required: true
                    }]
                },
                {
                    name: 'rename',
                    description: 'Rename or move a file within the data directory',
                    parameters: [
                        {
                            name: 'oldPath',
                            description: 'Existing path',
                            type: 'string',
                            required: true
                        },
                        {
                            name: 'newPath',
                            description: 'New path',
                            type: 'string',
                            required: true
                        }
                    ]
                },
                {
                    name: 'copy',
                    description: 'Copy a file into the data directory',
                    parameters: [
                        {
                            name: 'srcPath',
                            description: 'Source file path',
                            type: 'string',
                            required: true
                        },
                        {
                            name: 'destPath',
                            description: 'Destination path in data directory',
                            type: 'string',
                            required: true
                        }
                    ]
                }
            ],
            // Paths exposed to agent tools and MCP servers
            rootDirectories: {
                project: {
                    path: this.projectRoot,
                    access: 'read',
                    description: 'Agent project root (read-only)'
                },
                data: {
                    path: this.dataRoot,
                    access: 'read-write',
                    description: 'Data directory for runtime files'
                }
            }
        };
    }
}

module.exports = new FileSystemTool();