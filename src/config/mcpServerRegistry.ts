import fs from 'fs';
import path from 'path';

export class MCPServerRegistry {
    private filePath: string;
    private config: any;

    constructor(filePath: string) {
        this.filePath = path.resolve(filePath);
        this.reload();
    }

    reload() {
        this.config = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    }

    getAll() {
        return this.config.mcpServers || {};
    }

    get(name: string) {
        return this.getAll()[name];
    }

    set(name: string, config: any) {
        this.config.mcpServers[name] = config;
        fs.writeFileSync(this.filePath, JSON.stringify(this.config, null, 2));
    }
}