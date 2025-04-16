# LLM MCP Proxy

## API 测试命令

### 获取模型列表

获取所有提供商的模型列表：
```bash
curl http://localhost:3000/v1/models
```

获取特定提供商的模型列表：

```bash
# OpenAI
curl http://localhost:3000/v1/models/openai \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# DeepSeek
curl http://localhost:3000/v1/models/deepseek \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY"

# Anthropic
curl http://localhost:3000/v1/models/anthropic \
  -H "Authorization: Bearer $ANTHROPIC_API_KEY"

# Ollama (无需认证)
curl http://localhost:3000/v1/models/ollama
```

### 聊天完成

非流式响应：

```bash
# OpenAI
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "provider": "openai",
    "model": "gpt-3.5-turbo",
    "messages": [{"role": "user", "content": "你好，请用简短的话做个自我介绍"}]
  }'

# DeepSeek
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -d '{
    "provider": "deepseek",
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "你好，请用简短的话做个自我介绍"}]
  }'

# Anthropic
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  -d '{
    "provider": "anthropic",
    "model": "claude-3-haiku-20240307",
    "messages": [{"role": "user", "content": "你好，请用简短的话做个自我介绍"}]
  }'

# Ollama
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "ollama",
    "model": "llama2",
    "messages": [{"role": "user", "content": "你好，请用简短的话做个自我介绍"}]
  }'
```

流式响应：

```bash
# OpenAI
curl -N --http1.1 -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "provider": "openai",
    "model": "gpt-3.5-turbo",
    "messages": [{"role": "user", "content": "你好，请用简短的话做个自我介绍"}],
    "stream": true
  }'

# DeepSeek
curl -N --http1.1 -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -d '{
    "provider": "deepseek",
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "你好，请用简短的话做个自我介绍"}],
    "stream": true
  }'

# Anthropic
curl -N --http1.1 -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  -d '{
    "provider": "anthropic",
    "model": "claude-3-haiku-20240307",
    "messages": [{"role": "user", "content": "你好，请用简短的话做个自我介绍"}],
    "stream": true
  }'

# Ollama
curl -N --http1.1 -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "ollama",
    "model": "llama2",
    "messages": [{"role": "user", "content": "你好，请用简短的话做个自我介绍"}],
    "stream": true
  }'
```

注意：
1. 在运行命令前，请确保已设置相应的环境变量：
   - `OPENAI_API_KEY`
   - `DEEPSEEK_API_KEY`
   - `ANTHROPIC_API_KEY`
2. Ollama 是本地服务，不需要 API Key
3. 流式响应使用 Server-Sent Events (SSE) 格式
4. 服务器默认运行在 `localhost:3000`
