declare module '@modelcontextprotocol/sdk/dist/esm/client' {
    export interface Client {
        listTools(): Promise<any[]>;
        listPrompts(): Promise<any[]>;
        // Add other methods as needed
    }
}

declare module '@modelcontextprotocol/sdk/dist/esm/client/stdio' {
    export class StdioClientTransport {
        constructor();
    }
}

declare module '@modelcontextprotocol/sdk/dist/esm/config' {
    export interface MCPConfig {
        name: string;
        url: string;
        apiKey?: string;
    }

    export function initializeMCP(config: MCPConfig | MCPConfig[]): void;
    export function getMCPClientByName(name: string): Client;
} 