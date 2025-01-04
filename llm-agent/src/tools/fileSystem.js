const fs = require('fs').promises;
const path = require('path');

class FileSystemTool {
    constructor() {
        // Read-only directory for app source code
        this.appRoot = path.resolve(__dirname, '..');
        // Read-write directory for data
        this.dataRoot = path.resolve(__dirname, '../../data');
        this.name = 'fileSystem';
        this.description = 'Tool for file system operations';
    }

    async initialize() {
        // Ensure data directory exists
        try {
            await fs.access(this.dataRoot);
        } catch {
            await fs.mkdir(this.dataRoot, { recursive: true });
        }
    }

    // Helper to check if path is within allowed directories
    _validatePath(filePath, requireWritable = false) {
        const normalizedPath = path.normalize(filePath);
        const isInAppDir = normalizedPath.startsWith(this.appRoot);
        const isInDataDir = normalizedPath.startsWith(this.dataRoot);

        if (!isInAppDir && !isInDataDir) {
            throw new Error('Access denied: Path must be within app or data directory');
        }

        if (requireWritable && isInAppDir) {
            throw new Error('Access denied: App directory is read-only');
        }

        return normalizedPath;
    }

    async execute(action, params) {
        console.log('FileSystem executing:', { action, params });
        try {
            switch (action) {
                case 'read':
                    return await this.readFile(params.path);
                case 'write':
                    return await this.writeFile(params.path, params.content);
                case 'delete':
                    return await this.deleteFile(params.path);
                case 'list':
                    return await this.listFiles(params.path);
                case 'exists':
                    return await this.fileExists(params.path);
                default:
                    throw new Error(`Unknown action: ${action}`);
            }
        } catch (error) {
            console.error(`FileSystem tool error:`, error);
            return {
                status: 'error',
                error: error.message
            };
        }
    }

    async readFile(filePath) {
        const validPath = this._validatePath(filePath);
        const content = await fs.readFile(validPath, 'utf8');
        return {
            status: 'success',
            content,
            path: validPath
        };
    }

    async writeFile(filePath, content) {
        const validPath = this._validatePath(filePath, true);
        await fs.writeFile(validPath, content, 'utf8');
        return {
            status: 'success',
            path: validPath
        };
    }

    async deleteFile(filePath) {
        const validPath = this._validatePath(filePath, true);
        await fs.unlink(validPath);
        return {
            status: 'success',
            path: validPath
        };
    }

    async listFiles(dirPath) {
        const validPath = this._validatePath(dirPath);
        const items = await fs.readdir(validPath, { withFileTypes: true });
        const files = await Promise.all(items.map(async item => {
            const fullPath = path.join(validPath, item.name);
            const stats = await fs.stat(fullPath);
            return {
                name: item.name,
                path: fullPath,
                type: item.isDirectory() ? 'directory' : 'file',
                size: stats.size,
                isReadOnly: fullPath.startsWith(this.appRoot)
            };
        }));

        return {
            status: 'success',
            files,
            path: validPath,
            isReadOnly: validPath.startsWith(this.appRoot)
        };
    }

    async fileExists(filePath) {
        const validPath = this._validatePath(filePath);
        try {
            await fs.access(validPath);
            return {
                status: 'success',
                exists: true,
                path: validPath,
                isReadOnly: validPath.startsWith(this.appRoot)
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
                    name: 'read',
                    description: 'Read a file',
                    params: ['path']
                },
                {
                    name: 'write',
                    description: 'Write to a file (only in data directory)',
                    params: ['path', 'content']
                },
                {
                    name: 'delete',
                    description: 'Delete a file (only in data directory)',
                    params: ['path']
                },
                {
                    name: 'list',
                    description: 'List files in a directory',
                    params: ['path']
                },
                {
                    name: 'exists',
                    description: 'Check if a file exists',
                    params: ['path']
                }
            ],
            rootDirectories: {
                app: {
                    path: this.appRoot,
                    access: 'read-only',
                    description: 'Application source code directory'
                },
                data: {
                    path: this.dataRoot,
                    access: 'read-write',
                    description: 'Data storage directory'
                }
            }
        };
    }
}

module.exports = new FileSystemTool();
