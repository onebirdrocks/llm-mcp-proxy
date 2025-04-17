#!/bin/bash

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

# 测试模型元数据 API
test_models_meta_api() {
    info "Testing models metadata API..."

    info "Getting all models metadata"
    curl -s http://localhost:3000/v1/models/meta | jq '.'
    echo

    info "Getting OpenAI models metadata"
    curl -s -H "Authorization: Bearer $OPENAI_API_KEY" \
        http://localhost:3000/v1/models/meta/openai | jq '.'
    echo

    info "Getting Anthropic models metadata"
    curl -s -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
        http://localhost:3000/v1/models/meta/anthropic | jq '.'
    echo

    info "Getting DeepSeek models metadata"
    curl -s -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
        http://localhost:3000/v1/models/meta/deepseek | jq '.'
    echo

    info "Getting Ollama models metadata"
    curl -s http://localhost:3000/v1/models/meta/ollama | jq '.'
    echo

    info "Testing non-existent provider metadata"
    curl -s http://localhost:3000/v1/models/meta/nonexistent | jq '.'
    echo
}

# 测试模型列表 API
test_models_list_api() {
    info "Testing models list API..."

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

    local test_prompt="你好，请用简短的话做个自我介绍"

    info "Testing OpenAI chat"
    curl -s -X POST http://localhost:3000/v1/chat/completions \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $OPENAI_API_KEY" \
        -d "{
            \"provider\": \"openai\",
            \"model\": \"gpt-3.5-turbo\",
            \"messages\": [{\"role\": \"user\", \"content\": \"$test_prompt\"}]
        }"
    echo

    info "Testing DeepSeek chat"
    curl -s -X POST http://localhost:3000/v1/chat/completions \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
        -d "{
            \"provider\": \"deepseek\",
            \"model\": \"deepseek-chat\",
            \"messages\": [{\"role\": \"user\", \"content\": \"$test_prompt\"}]
        }"
    echo

    info "Testing Anthropic chat"
    curl -s -X POST http://localhost:3000/v1/chat/completions \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
        -d "{
            \"provider\": \"anthropic\",
            \"model\": \"claude-3-haiku-20240307\",
            \"messages\": [{\"role\": \"user\", \"content\": \"$test_prompt\"}]
        }"
    echo

    info "Testing Ollama chat"
    curl -s -X POST http://localhost:3000/v1/chat/completions \
        -H "Content-Type: application/json" \
        -d "{
            \"provider\": \"ollama\",
            \"model\": \"llama2\",
            \"messages\": [{\"role\": \"user\", \"content\": \"$test_prompt\"}]
        }"
    echo
}

# 测试流式聊天 API
test_stream_chat_api() {
    info "Testing chat API (streaming)..."

    local test_prompt="你好，请用简短的话做个自我介绍"

    info "Testing OpenAI streaming chat"
    curl -N --http1.1 -X POST http://localhost:3000/v1/chat/completions \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $OPENAI_API_KEY" \
        -d "{
            \"provider\": \"openai\",
            \"model\": \"gpt-3.5-turbo\",
            \"messages\": [{\"role\": \"user\", \"content\": \"$test_prompt\"}],
            \"stream\": true
        }"
    echo

    info "Testing DeepSeek streaming chat"
    curl -N --http1.1 -X POST http://localhost:3000/v1/chat/completions \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
        -d "{
            \"provider\": \"deepseek\",
            \"model\": \"deepseek-chat\",
            \"messages\": [{\"role\": \"user\", \"content\": \"$test_prompt\"}],
            \"stream\": true
        }"
    echo

    info "Testing Anthropic streaming chat"
    curl -N --http1.1 -X POST http://localhost:3000/v1/chat/completions \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
        -d "{
            \"provider\": \"anthropic\",
            \"model\": \"claude-3-haiku-20240307\",
            \"messages\": [{\"role\": \"user\", \"content\": \"$test_prompt\"}],
            \"stream\": true
        }"
    echo

    info "Testing Ollama streaming chat"
    curl -N --http1.1 -X POST http://localhost:3000/v1/chat/completions \
        -H "Content-Type: application/json" \
        -d "{
            \"provider\": \"ollama\",
            \"model\": \"llama2\",
            \"messages\": [{\"role\": \"user\", \"content\": \"$test_prompt\"}],
            \"stream\": true
        }"
    echo
}

# 测试 MCP Tools API
test_mcp_tools_api() {
    info "Testing MCP Tools API..."

    info "Getting ebook-mcp tools"
    curl -s -X GET "http://localhost:3000/v1/mcp/ebook-mcp/tools" \
        -H "Content-Type: application/json"
    echo

    info "Testing non-existent MCP server"
    curl -s -X GET "http://localhost:3000/v1/mcp/nonexistent/tools" \
        -H "Content-Type: application/json"
    echo
}

# 运行所有测试
run_all_tests() {
    info "Starting API tests..."
    
    test_models_meta_api
    test_models_list_api
    test_chat_api
    test_stream_chat_api
    test_mcp_tools_api
    
    success "All tests completed!"
}

# 主函数
main() {
    # 加载环境变量
    load_env
    
    # 检查环境变量
    check_env
    
    # 运行所有测试
    run_all_tests
}

# 运行主函数
main 