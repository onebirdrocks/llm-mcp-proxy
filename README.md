# LLM MCP Proxy

A unified proxy server that integrates multiple LLM (Large Language Model) providers and MCP (Model Context Protocol) servers. This project provides a standardized API interface for accessing various AI models and tools.

## Features

- Unified API interface for multiple LLM providers:
  - OpenAI
  - DeepSeek
  - Anthropic
  - Ollama (local models)
- Support for MCP (Model Context Protocol) servers
- Streaming and non-streaming chat completions
- Standardized model listing and information
- Easy integration with new providers

## Installation

### As a dependency in your project

```bash
npm install llm-mcp-proxy
```

### Usage in Code

```typescript
import { createServer } from 'llm-mcp-proxy';

// Create MCP configuration
const mcpConfig = {
  mcpServers: {
    'ebook-mcp': {
      command: 'python',
      args: ['-m', 'your_mcp_server']
    }
  }
};

// Start the server
const server = await createServer({
  port: 3000,  // optional, default is 3000
  mcpConfig    // optional, if you need MCP support
});

// Server is now running at http://localhost:3000
console.log(`Server is running at ${server.url}`);

// To stop the server
await server.close();
```

Required environment variables:
```env
OPENAI_API_KEY=your_openai_api_key      # If using OpenAI
DEEPSEEK_API_KEY=your_deepseek_api_key  # If using DeepSeek
ANTHROPIC_API_KEY=your_anthropic_api_key # If using Anthropic
```

### As a standalone server

1. Clone the repository:
```bash
git clone https://github.com/yourusername/llm-mcp-proxy.git
cd llm-mcp-proxy
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory and add your API keys:
```env
OPENAI_API_KEY=your_openai_api_key
DEEPSEEK_API_KEY=your_deepseek_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
```

4. Configure MCP servers in `mcp_servers.json`:
```json
{
  "servers": {
    "ebook-mcp": {
      "url": "your_mcp_server_url"
    }
  }
}
```

## Running the Server

Start the development server:
```bash
npm run dev
```

The server will be available at `http://localhost:3000`.

## API Testing

The project includes a test script that verifies all API endpoints. To run the tests:

1. Make sure the server is running
2. Open a new terminal and run:
```bash
chmod +x test_api.sh  # Make the script executable (first time only)
./test_api.sh
```

The test script will check:
- Model listing for all providers
- Chat completions (streaming and non-streaming)
- MCP tools availability

## API Endpoints

### Models
- `GET /v1/models` - List all available models
- `GET /v1/models/:provider` - List models for a specific provider

### Chat
- `POST /v1/chat/completions` - Create chat completion
  - Supports both streaming and non-streaming responses
  - Compatible with OpenAI API format

### MCP
- `GET /v1/mcp/:server/tools` - List available tools for an MCP server

## Environment Variables

- `OPENAI_API_KEY` - OpenAI API key
- `DEEPSEEK_API_KEY` - DeepSeek API key
- `ANTHROPIC_API_KEY` - Anthropic API key

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT License](LICENSE)
