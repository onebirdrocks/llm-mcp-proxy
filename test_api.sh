#!/bin/bash

# 加载 .env 文件
load_env() {
    if [ -f .env ]; then
        info "Loading environment variables from .env file..."
        while IFS='=' read -r key value || [ -n "$key" ]; do
            # 跳过注释和空行
            [[ $key =~ ^#.*$ ]] && continue
            [[ -z $key ]] && continue
            
            # 移除可能存在的引号
            value=$(echo "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^["\x27]//' -e 's/["\x27]$//')
            
            # 导出环境变量
            export "$key=$value"
            success "Loaded: $key"
        done < .env
    else
        error ".env file not found"
    fi
}

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的信息
info() {
    echo -e "${BLUE}[INFO] $1${NC}"
}

success() {
    echo -e "${GREEN}[SUCCESS] $1${NC}"
}

error() {
    echo -e "${RED}[ERROR] $1${NC}"
}

# 检查环境变量
check_env() {
    local missing=0
    if [ -z "$OPENAI_API_KEY" ]; then
        error "OPENAI_API_KEY is not set"
        missing=1
    fi
    if [ -z "$DEEPSEEK_API_KEY" ]; then
        error "DEEPSEEK_API_KEY is not set"
        missing=1
    fi
    if [ -z "$ANTHROPIC_API_KEY" ]; then
        error "ANTHROPIC_API_KEY is not set"
        missing=1
    fi
    if [ $missing -eq 1 ]; then
        exit 1
    fi
}

# 测试模型列表 API
test_models_api() {
    info "Testing models API..."

    info "Getting all models"
    curl -s http://localhost:3000/v1/models
    echo

    info "Getting OpenAI models"
    curl -s http://localhost:3000/v1/models/openai \
        -H "Authorization: Bearer $OPENAI_API_KEY"
    echo

    info "Getting DeepSeek models"
    curl -s http://localhost:3000/v1/models/deepseek \
        -H "Authorization: Bearer $DEEPSEEK_API_KEY"
    echo

    info "Getting Anthropic models"
    curl -s http://localhost:3000/v1/models/anthropic \
        -H "Authorization: Bearer $ANTHROPIC_API_KEY"
    echo

    info "Getting Ollama models"
    curl -s http://localhost:3000/v1/models/ollama
    echo
}

# 测试聊天 API（非流式）
test_chat_api() {
    info "Testing chat API (non-streaming)..."

    info "Testing OpenAI chat"
    curl -s -X POST http://localhost:3000/v1/chat/completions \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $OPENAI_API_KEY" \
        -d '{
            "provider": "openai",
            "model": "gpt-3.5-turbo",
            "messages": [{"role": "user", "content": "你好，请用简短的话做个自我介绍"}]
        }'
    echo

    info "Testing DeepSeek chat"
    curl -s -X POST http://localhost:3000/v1/chat/completions \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
        -d '{
            "provider": "deepseek",
            "model": "deepseek-chat",
            "messages": [{"role": "user", "content": "你好，请用简短的话做个自我介绍"}]
        }'
    echo

    info "Testing Anthropic chat"
    curl -s -X POST http://localhost:3000/v1/chat/completions \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
        -d '{
            "provider": "anthropic",
            "model": "claude-3-haiku-20240307",
            "messages": [{"role": "user", "content": "你好，请用简短的话做个自我介绍"}]
        }'
    echo

    info "Testing Ollama chat"
    curl -s -X POST http://localhost:3000/v1/chat/completions \
        -H "Content-Type: application/json" \
        -d '{
            "provider": "ollama",
            "model": "llama2",
            "messages": [{"role": "user", "content": "你好，请用简短的话做个自我介绍"}]
        }'
    echo
}

# 测试流式聊天 API
test_stream_chat_api() {
    info "Testing chat API (streaming)..."

    info "Testing OpenAI streaming chat"
    curl -N --http1.1 -X POST http://localhost:3000/v1/chat/completions \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $OPENAI_API_KEY" \
        -d '{
            "provider": "openai",
            "model": "gpt-3.5-turbo",
            "messages": [{"role": "user", "content": "你好，请用简短的话做个自我介绍"}],
            "stream": true
        }'
    echo

    info "Testing DeepSeek streaming chat"
    curl -N --http1.1 -X POST http://localhost:3000/v1/chat/completions \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
        -d '{
            "provider": "deepseek",
            "model": "deepseek-chat",
            "messages": [{"role": "user", "content": "你好，请用简短的话做个自我介绍"}],
            "stream": true
        }'
    echo

    info "Testing Anthropic streaming chat"
    curl -N --http1.1 -X POST http://localhost:3000/v1/chat/completions \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
        -d '{
            "provider": "anthropic",
            "model": "claude-3-haiku-20240307",
            "messages": [{"role": "user", "content": "你好，请用简短的话做个自我介绍"}],
            "stream": true
        }'
    echo

    info "Testing Ollama streaming chat"
    curl -N --http1.1 -X POST http://localhost:3000/v1/chat/completions \
        -H "Content-Type: application/json" \
        -d '{
            "provider": "ollama",
            "model": "llama2",
            "messages": [{"role": "user", "content": "你好，请用简短的话做个自我介绍"}],
            "stream": true
        }'
    echo
}

main() {
    info "Starting API tests..."
    
    # 加载环境变量
    load_env
    
    # 检查环境变量
    check_env
    
    # 测试各个 API
    test_models_api
    test_chat_api
    test_stream_chat_api
    
    success "All tests completed!"
}

# 运行主函数
main 