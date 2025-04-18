// OpenAIProvider.ts
import OpenAI from 'openai';
import type { 
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
  ChatCompletionMessage,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
  ChatCompletionToolMessageParam,
  ChatCompletionAssistantMessageParam
} from 'openai/resources/chat/completions';
import { createParser, EventSourceMessage } from 'eventsource-parser';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BaseProvider, ChatParams, ListModelsParams } from './types';
import { Stream } from 'openai/streaming';
import { getMCPClientByName } from '../providers';

/** avoid dead loop */
const MAX_TOOL_LOOPS = 5;

interface CustomToolCall {
  id: string;
  name: string;
  arguments: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface MCPClientLike {
  getToolList: () => Promise<Array<{ name: string; [key: string]: any }>>;
  invokeTool: (name: string, args: string) => Promise<any>;
}

export class OpenAIWithToolProvider implements BaseProvider {
  async chat(params: ChatParams): Promise<any> {
    // 实现chat方法
    throw new Error('Method not implemented.');
  }

  async listModels(params?: ListModelsParams): Promise<any[]> {
    // 实现listModels方法
    throw new Error('Method not implemented.');
  }

  /** 
   * Streaming + Tool‑Calling + Yolo‑Auto‑Loop
   * ---------------------------------------------------
   * 1. 开流 -> 2. 若 finish_reason=="tool_calls" 就执行工具
   * 3. 把工具结果作为 messages 再次递给模型
   * 4. 重复，直到模型返回 finish_reason=="stop" 或迭代上限
   */
  async chatStream(
    { model, messages: initMsgs, apiKey, isYolo = false, mcpServerNames = [] }: ChatParams,
    stream: NodeJS.WritableStream,
  ): Promise<void> {
    const send = (payload: any) =>
      stream.write(`data: ${JSON.stringify(payload)}\n\n`);

    const openai = new OpenAI({ apiKey });

    // ✔️ 尝试复用 MCP Client（只有在需要时才实例化）
    console.log('isYolo', isYolo);
    console.log('mcpServerNames', mcpServerNames);
    const mcpClients: MCPClientLike[] = isYolo ? mcpServerNames.map(name => ({
      getToolList: async () => {
        const client = await getMCPClientByName(name);
        if (!client) throw new Error(`Failed to get MCP client for "${name}"`);
        return client.listTools();
      },
      invokeTool: async (name: string, args: string) => {
        const client = await getMCPClientByName(name);
        if (!client) throw new Error(`Failed to get MCP client for "${name}"`);
        return client.callTool({ name, arguments: JSON.parse(args) });
      }
    })) : [];

    let loop = 0;
    let messages = [...initMsgs] as ChatCompletionMessageParam[]; // 每次循环都累加上下文

    while (loop++ < MAX_TOOL_LOOPS) {
      const reqStartTs = Date.now();

      // 1️⃣ 打开一次 ChatCompletion 流
      const tools: ChatCompletionTool[] = [];
      
      if (isYolo && mcpClients.length > 0) {
        try {
          // 获取所有可用工具
          const toolLists = await Promise.all(mcpClients.map(client => client.getToolList()));
          // 提取实际的工具数组
          const allTools = toolLists.flatMap(response => {
            if (typeof response === 'object' && response !== null && 'tools' in response) {
              return (response as { tools: any[] }).tools;
            }
            return Array.isArray(response) ? response : [];
          });
          
          console.log('Raw tools from MCP:', JSON.stringify(allTools, null, 2));
          
          // 转换为 OpenAI 工具格式
          for (const tool of allTools) {
            if (!tool.name || !tool.inputSchema) {
              console.warn('Skipping invalid tool:', tool);
              continue;
            }
            
            tools.push({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description || '',
                parameters: tool.inputSchema
              }
            });
          }
          
          console.log('Converted OpenAI tools:', JSON.stringify(tools, null, 2));
        } catch (error: any) {
          console.error('Error fetching tools:', error);
          send({ type: 'error', message: `Error preparing tools: ${error.message}` });
          stream.end();
          return;
        }
      }

      if (tools.length === 0) {
        console.log('No tools available, proceeding without function calling');
      }

      const resp = await openai.chat.completions.create({
        model,
        messages,
        stream: true,
        ...(tools.length > 0 ? {
          tools,
          tool_choice: 'auto'  // 只在有工具时设置 tool_choice
        } : {})
      });

      // ⬇️ 用于暂存本轮 tool 调用
      const toolCalls: CustomToolCall[] = [];
      let finishedWithToolCalls = false;

      // 2️⃣ 逐块解析 & 透传 token
      for await (const chunk of resp) {
        // 直接转发原始数据
        stream.write(`data: ${JSON.stringify(chunk)}\n\n`);

        // 处理工具调用
        if (chunk.choices[0]?.delta?.tool_calls) {
          const toolCallsData = chunk.choices[0].delta.tool_calls;
          const customToolCalls = toolCallsData.map((tc: any) => ({
            id: tc.id || `tool_${Date.now()}`,
            type: 'function' as const,
            name: tc.function?.name,
            arguments: tc.function?.arguments,
            function: {
              name: tc.function?.name,
              arguments: tc.function?.arguments
            }
          }));
          
          toolCalls.push(...customToolCalls);
        }

        // 检查完成原因
        if (chunk.choices[0]?.finish_reason === 'tool_calls') {
          finishedWithToolCalls = true;
        }
      }

      if (!finishedWithToolCalls) {
        stream.end();
        return;
      }

      if (!isYolo) {
        send({ type: 'need_confirm', toolCalls });
        stream.end();
        return;
      }

      if (mcpClients.length === 0) {
        send({ type: 'error', message: 'mcpServerNames 字段为空，无法执行工具' });
        stream.end();
        return;
      }

      // 执行工具调用
      try {
        const toolResults: { name: string; result: any; tool_call_id: string }[] = [];

        for (const c of toolCalls) {
          const meta = tools.find(t => t.function.name === c.name);
          if (!meta) {
            stream.write(`data: ${JSON.stringify({ type: 'tool_error', name: c.name, message: 'Tool not found' })}\n\n`);
            continue;
          }

          const res = await mcpClients[tools.findIndex(t => t.function.name === c.name)].invokeTool(c.name, c.arguments);
          toolResults.push({ name: c.name, result: res, tool_call_id: c.id });
          stream.write(`data: ${JSON.stringify({ type: 'tool_result', name: c.name, result: res })}\n\n`);
        }

        messages.push({
          role: 'assistant',
          content: '',
          tool_calls: toolCalls,
        } as ChatCompletionAssistantMessageParam);

        for (const { name, result, tool_call_id } of toolResults) {
          messages.push({
            role: 'tool',
            name,
            content: JSON.stringify(result),
            tool_call_id
          } as ChatCompletionToolMessageParam);
        }
      } catch (e: any) {
        stream.write(`data: ${JSON.stringify({ type: 'tool_error', message: e.message })}\n\n`);
        stream.end();
        return;
      }

      const duration = ((Date.now() - reqStartTs) / 1000).toFixed(1);
      stream.write(`data: ${JSON.stringify({ type: 'loop_info', loop, duration })}\n\n`);
      stream.end();
    }
  }
}

function findToolByName(tools: CustomToolCall[], targetTool: CustomToolCall): CustomToolCall | undefined {
  return tools.find(t => t.name === targetTool.name);
}

async function streamToString(stream: Stream<ChatCompletionChunk>): Promise<string> {
  let result = '';
  for await (const chunk of stream) {
    result += chunk.choices[0]?.delta?.content || '';
  }
  return result;
}

async function testOpenAIStreaming() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const stream = process.stdout;
  
  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Say "Hello, World!" slowly.' }],
      stream: true
    });

    const parser = createParser({
      onEvent(event: EventSourceMessage) {
        try {
          if (event.data === '[DONE]') {
            stream.write('data: "[DONE]"\n\n');
            return;
          }

          const data = JSON.parse(event.data);
          
          // 转发内容
          if (data?.choices?.[0]?.delta?.content) {
            stream.write(`data: ${JSON.stringify({ content: data.choices[0].delta.content })}\n\n`);
          }

          // 检查完成原因
          if (data?.choices?.[0]?.finish_reason) {
            stream.write(`data: ${JSON.stringify({ finish_reason: data.choices[0].finish_reason })}\n\n`);
          }
        } catch (err) {
          console.error('Error processing chunk:', err);
        }
      }
    });

    for await (const chunk of resp) {
      parser.feed(chunk.toString());
    }
    
  } catch (error) {
    console.error('Error in streaming test:', error);
  }
}

// 执行测试
console.log('Starting OpenAI streaming test...');
testOpenAIStreaming().then(() => {
  console.log('\nTest completed');
}).catch(error => {
  console.error('Test failed:', error);
});
