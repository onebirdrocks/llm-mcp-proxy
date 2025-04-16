declare module '@modelcontextprotocol/sdk/client/index.js' {
  export interface ClientConfig {
    name: string;
    version: string;
  }

  export class Client {
    constructor(config: ClientConfig);
    connect(transport: any): Promise<void>;
    listPrompts(): Promise<any[]>;
    getPrompt(params: { name: string; arguments: Record<string, any> }): Promise<any>;
    listResources(): Promise<any[]>;
    readResource(params: { uri: string }): Promise<any>;
    callTool(params: { name: string; arguments: Record<string, any> }): Promise<any>;
  }
}

declare module '@modelcontextprotocol/sdk/client/stdio.js' {
  export interface StdioTransportConfig {
    command: string;
    args?: string[];
  }

  export class StdioClientTransport {
    constructor(config: StdioTransportConfig);
  }
} 