const fs = require('fs').promises;
const path = require('path');

class PersonalityManager {
    constructor() {
        this.personalities = new Map();
        this.corePersonalitiesDir = path.join(__dirname);
        this.dataPersonalitiesDir = path.join(__dirname, '../../data/personalities');
    }

    async loadPersonalities() {
        console.log('Loading personalities...');
        // Clear existing personalities
        this.personalities.clear();

        // Load core personalities
        await this.loadPersonalitiesFromDirectory(this.corePersonalitiesDir, 'core');

        // Load data personalities if they exist
        try {
            await this.loadPersonalitiesFromDirectory(this.dataPersonalitiesDir, 'data');
        } catch (error) {
            console.log('No custom personalities found in data directory');
        }

        if (this.personalities.size === 0) {
            throw new Error('No personalities found');
        }

        console.log('Loaded personalities:', Array.from(this.personalities.keys()));
        return Array.from(this.personalities.values());
    }

    async loadPersonalitiesFromDirectory(directory, source) {
        try {
            console.log(`Loading personalities from ${directory}`);
            const files = await fs.readdir(directory);
            
            for (const file of files) {
                if (file === 'index.js') continue; // Skip this file
                
                if (file.endsWith('.txt')) {
                    const personalityPath = path.join(directory, file);
                    try {
                        console.log(`Loading personality from ${file}`);
                        const content = await fs.readFile(personalityPath, 'utf8');
                        const name = path.basename(file, '.txt');
                        
                        const personality = {
                            name,
                            prompt: content.trim(),
                            source
                        };
                        
                        this.personalities.set(name, personality);
                        console.log(`Successfully loaded personality: ${name}`);
                    } catch (error) {
                        console.error(`Error loading personality ${file}:`, error);
                    }
                }
            }
        } catch (error) {
            console.error(`Error reading directory ${directory}:`, error);
            throw error;
        }
    }

    getPersonality(name) {
        return this.personalities.get(name);
    }

    getDefaultPersonality() {
        // Return the first personality in the map
        return Array.from(this.personalities.values())[0];
    }
}

// Singleton instance
const personalityManager = new PersonalityManager();

module.exports = personalityManager;
