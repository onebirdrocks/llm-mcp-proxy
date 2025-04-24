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
    const { model, messages: initMsgs, apiKey, isYolo = false, mcpServerNames = [] } = params;
    const openai = new OpenAI({ apiKey });
    
    // 初始化 MCP 客户端
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

    let messages = [...initMsgs] as ChatCompletionMessageParam[];
    let loop = 0;

    while (loop++ < MAX_TOOL_LOOPS) {
      // 获取工具列表
      const tools: ChatCompletionTool[] = [];
      if (isYolo && mcpClients.length > 0) {
        try {
          const toolLists = await Promise.all(mcpClients.map(client => client.getToolList()));
          const allTools = toolLists.flatMap(response => {
            if (typeof response === 'object' && response !== null && 'tools' in response) {
              return (response as { tools: any[] }).tools;
            }
            return Array.isArray(response) ? response : [];
          });

          for (const tool of allTools) {
            if (!tool.name || !tool.inputSchema) continue;
            tools.push({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description || '',
                parameters: tool.inputSchema
              }
            });
          }
        } catch (error: any) {
          throw new Error(`Error preparing tools: ${error.message}`);
        }
      }

      // 发送请求
      const response = await openai.chat.completions.create({
        model,
        messages,
        ...(tools.length > 0 ? {
          tools,
          tool_choice: 'auto'
        } : {})
      });

      const choice = response.choices[0];
      if (!choice) break;

      // 如果没有工具调用，直接返回结果
      if (choice.finish_reason !== 'tool_calls' || !choice.message.tool_calls) {
        return response;
      }

      // 处理工具调用
      const toolCalls = choice.message.tool_calls;
      const toolResults = [];

      for (const call of toolCalls) {
        if (!call.function) continue;

        const { name, arguments: args } = call.function;
        const clientIndex = tools.findIndex(t => t.function.name === name);

        if (clientIndex === -1 || clientIndex >= mcpClients.length) {
          throw new Error(`No MCP client available for tool "${name}"`);
        }

        try {
          const result = await mcpClients[clientIndex].invokeTool(name, args);
          toolResults.push({ name, result, tool_call_id: call.id });
        } catch (error: any) {
          throw new Error(`Tool execution failed: ${error.message}`);
        }
      }

      // 添加工具调用结果到消息历史
      messages.push({
        role: 'assistant',
        content: choice.message.content,
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
    }

    // 如果达到最大循环次数，返回最后一次响应
    const finalResponse = await openai.chat.completions.create({
      model,
      messages,
    });

    return finalResponse;
  }

  async listModels(params?: ListModelsParams): Promise<any[]> {
    const { provider = 'openai', apiKey } = params || {};
    
    if (provider === 'openai') {
      const openai = new OpenAI({ apiKey });
      const response = await openai.models.list();
      return response.data
        .filter(model => model.id.includes('gpt'))
        .map(model => ({
          id: model.id,
          provider: 'openai'
        }));
    }
    
    // 如果是其他 provider，返回空数组
    console.log(`Provider ${provider} not supported in OpenAIWithToolProvider`);
    return [];
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
        stream.write('data: "[DONE]"\n\n');
        stream.end();
        return;
      }

      if (!isYolo) {
        stream.write('data: "[DONE]"\n\n');
        stream.end();
        return;
      }

      if (mcpClients.length === 0) {
        stream.write(`data: ${JSON.stringify({ type: 'error', message: 'mcpServerNames 字段为空，无法执行工具' })}\n\n`);
        stream.write('data: "[DONE]"\n\n');
        stream.end();
        return;
      }

      // 执行工具调用
      try {
        const toolResults: { name: string; result: any; tool_call_id: string }[] = [];

        console.log('准备执行工具调用，可用工具列表:', tools.map(t => t.function.name));
        console.log('MCP 客户端列表:', mcpServerNames);

        for (const c of toolCalls) {
          console.log('\n开始处理工具调用:', {
            toolName: c.name,
            toolArguments: c.arguments,
            toolId: c.id,
            rawToolCall: JSON.stringify(c, null, 2)  // 添加原始工具调用数据
          });

          if (!c.name) {
            console.error('工具调用缺少名称:', c);
            stream.write(`data: ${JSON.stringify({ type: 'tool_error', message: 'Tool call missing name' })}\n\n`);
            continue;
          }

          if (!c.arguments || typeof c.arguments !== 'string') {
            console.error('工具调用参数无效:', {
              name: c.name,
              arguments: c.arguments
            });
            stream.write(`data: ${JSON.stringify({ type: 'tool_error', message: 'Invalid tool arguments' })}\n\n`);
            continue;
          }

          const meta = tools.find(t => t.function.name === c.name);
          if (!meta) {
            console.error('工具未找到:', {
              requestedTool: c.name,
              availableTools: tools.map(t => t.function.name)
            });
            stream.write(`data: ${JSON.stringify({ type: 'tool_error', name: c.name, message: 'Tool not found on any MCP server' })}\n\n`);
            continue;
          }

          console.log('找到工具元数据:', {
            name: meta.function.name,
            description: meta.function.description,
            parameters: meta.function.parameters
          });

          try {
            const clientIndex = tools.findIndex(t => t.function.name === c.name);
            
            if (clientIndex === -1 || clientIndex >= mcpClients.length) {
              console.error('找不到对应的 MCP 客户端:', {
                toolName: c.name,
                clientIndex,
                availableClients: mcpServerNames
              });
              stream.write(`data: ${JSON.stringify({ 
                type: 'tool_error', 
                message: `No MCP client available for tool "${c.name}"` 
              })}\n\n`);
              continue;
            }

            console.log('使用 MCP 客户端:', {
              serverName: mcpServerNames[clientIndex],
              toolName: c.name,
              args: c.arguments
            });

            // 验证参数
            if (!c.arguments || typeof c.arguments !== 'string') {
              console.error('工具参数无效:', {
                toolName: c.name,
                args: c.arguments
              });
              stream.write(`data: ${JSON.stringify({
                type: 'tool_error',
                message: `Invalid arguments for tool "${c.name}": arguments must be a string`
              })}\n\n`);
              continue;
            }

            let parsedArgs;
            try {
              parsedArgs = JSON.parse(c.arguments);
            } catch (e) {
              console.error('工具参数解析失败:', {
                toolName: c.name,
                args: c.arguments,
                error: e
              });
              stream.write(`data: ${JSON.stringify({
                type: 'tool_error',
                message: `Failed to parse arguments for tool "${c.name}": ${(e as Error).message}`
              })}\n\n`);
              continue;
            }

            const result = await mcpClients[clientIndex].invokeTool(c.name, JSON.stringify(parsedArgs));
            console.log('工具调用成功:', {
              name: c.name,
              result: result
            });

            toolResults.push({ name: c.name, result: result, tool_call_id: c.id });
            stream.write(`data: ${JSON.stringify({ type: 'tool_result', name: c.name, result: result })}\n\n`);
          } catch (e: any) {
            console.error('工具调用失败:', {
              error: e.message,
              stack: e.stack
            });
            stream.write(`data: ${JSON.stringify({ type: 'tool_error', message: e.message })}\n\n`);
          }
        }

        console.log('\n所有工具调用完成，结果:', toolResults);

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
        console.error('工具调用过程中发生错误:', {
          error: e.message,
          stack: e.stack
        });
        stream.write(`data: ${JSON.stringify({ type: 'tool_error', message: e.message })}\n\n`);
      } finally {
        stream.write('data: "[DONE]"\n\n');
        stream.end();
      }

      const duration = ((Date.now() - reqStartTs) / 1000).toFixed(1);
      stream.write(`data: ${JSON.stringify({ type: 'loop_info', loop, duration })}\n\n`);
    }
  }
}