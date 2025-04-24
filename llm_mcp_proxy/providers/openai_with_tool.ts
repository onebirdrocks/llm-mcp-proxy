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
  name?: string;  // 添加可选的name属性
  getToolList: () => Promise<any>;
  invokeTool: (name: string, args: string) => Promise<any>;
}

// 添加一个新的接口来跟踪工具调用的状态
interface ToolCallState {
  id: string;
  name: string;
  arguments: string;
  index: number;
  argumentsComplete: boolean;  // 添加新字段来跟踪参数是否完整
}

export class OpenAIWithToolProvider implements BaseProvider {
  private static isPartialJSON(str: string): boolean {
    try {
      JSON.parse(str);
      return true;
    } catch (e) {
      // 检查是否是未完成的JSON
      return str.includes('{') && !str.includes('}') || 
             (str.split('{').length > str.split('}').length);
    }
  }

  private static tryParseJSON(str: string): any {
    try {
      return JSON.parse(str);
    } catch (e) {
      return null;
    }
  }

  private static cleanAndParseJSON(str: string): any {
    console.log('开始解析JSON字符串:', str);
    
    // 处理空字符串情况
    if (!str || str.trim() === '') {
      throw new Error('Empty JSON string');
    }
    
    // 首先尝试直接解析
    try {
      const parsed = JSON.parse(str);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
    } catch (e) {
      // 继续尝试修复
    }

    // 如果失败，进行清理和修复
    try {
      // 1. 收集所有参数片段
      let cleaned = str;
      
      // 2. 移除所有多余的引号和转义
      cleaned = cleaned.replace(/\\"/g, '"')
                      .replace(/^"|"$/g, '')
                      .replace(/\s+/g, '');
      
      // 3. 重建JSON结构
      if (!cleaned.startsWith('{')) {
        cleaned = '{' + cleaned;
      }
      if (!cleaned.endsWith('}')) {
        cleaned = cleaned + '}';
      }
      
      // 4. 处理路径参数
      const pathMatch = cleaned.match(/"path":"([^"]+)"/);
      if (!pathMatch) {
        // 如果没有找到path参数，尝试从原始字符串中提取
        const parts = str.split(/[/\\]+/).filter(Boolean);
        if (parts.length > 0) {
          const path = '/' + parts.join('/');
          cleaned = `{"path":"${path}"}`;
        } else {
          throw new Error('No path found in arguments');
        }
      }
      
      console.log('清理后的JSON字符串:', cleaned);
      
      const parsed = JSON.parse(cleaned);
      if (!parsed.path) {
        throw new Error('Missing path parameter in parsed JSON');
      }
      
      return parsed;
    } catch (error) {
      console.error('JSON清理和解析失败:', {
        original: str,
        error
      });
      if (error instanceof Error) {
        throw new Error(`Failed to parse JSON: ${error.message}`);
      } else {
        throw new Error('Failed to parse JSON: Unknown error');
      }
    }
  }

  private static extractPathFromMessage(message: string): string | null {
    // 匹配中文路径模式
    const pathMatch = message.match(/我的(.*?)中/);
    if (pathMatch && pathMatch[1]) {
      return pathMatch[1].trim();
    }
    
    // 匹配普通路径模式
    const generalPathMatch = message.match(/([/\\][^/\\]+)+/);
    if (generalPathMatch) {
      return generalPathMatch[0].replace(/\\/g, '/');
    }
    
    return null;
  }

  async chat(params: ChatParams): Promise<any> {
    const { model, messages: initMsgs, apiKey, isYolo = false, mcpServerNames = [] } = params;
    const openai = new OpenAI({ apiKey });
    
    // 初始化 MCP 客户端
    const mcpClients: MCPClientLike[] = [];
    if (isYolo && mcpServerNames.length > 0) {
      console.log('Initializing MCP clients for non-stream mode:', mcpServerNames);
      
      for (const name of mcpServerNames) {
        const client = await getMCPClientByName(name);
        if (!client) {
          console.error(`Failed to get MCP client for "${name}"`);
          continue;
        }
        mcpClients.push({
          name,  // 添加name属性以便调试
          getToolList: async () => {
            return client.listTools();
          },
          invokeTool: async (toolName: string, args: string) => {
            console.log(`Invoking tool ${toolName} with args:`, args);
            return client.callTool({ name: toolName, arguments: JSON.parse(args) });
          }
        });
        console.log(`Successfully initialized MCP client for "${name}"`);
      }
    }

    let messages = [...initMsgs] as ChatCompletionMessageParam[];
    let loop = 0;

    while (loop++ < MAX_TOOL_LOOPS) {
      // 获取工具列表
      const tools: ChatCompletionTool[] = [];
      
      if (isYolo && mcpClients.length > 0) {
        try {
          console.log('Fetching tools from MCP clients...');
          const toolLists = await Promise.all(mcpClients.map(client => client.getToolList()));
          const allTools = toolLists.flatMap(response => {
            if (typeof response === 'object' && response !== null && 'tools' in response) {
              return (response as { tools: any[] }).tools;
            }
            return Array.isArray(response) ? response : [];
          });
          
          console.log('Raw tools from MCP:', JSON.stringify(allTools, null, 2));
          
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
          console.error('Error preparing tools:', error);
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
    console.log('Starting chatStream with params:', {
      model,
      isYolo,
      mcpServerNames,
      messageCount: initMsgs.length
    });

    let streamEnded = false;
    const toolResults: { name: string; result: any; tool_call_id: string }[] = [];
    
    const send = (payload: any) => {
      if (!streamEnded) {
        try {
          stream.write(`data: ${JSON.stringify(payload)}\n\n`);
        } catch (e) {
          console.error('Stream write error:', e);
        }
      }
    };
    
    const endStream = () => {
      if (!streamEnded) {
        try {
          if (toolResults.length > 0) {
            console.log('所有工具调用完成，结果:', toolResults);
            
            // 添加工具调用结果到消息历史
            messages.push({
              role: 'assistant',
              content: '',
              tool_calls: toolResults.map(result => ({
                id: result.tool_call_id,
                type: 'function',
                function: {
                  name: result.name,
                  arguments: JSON.stringify(result.result)
                }
              }))
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
          
          stream.write('data: "[DONE]"\n\n');
          stream.end();
          streamEnded = true;
        } catch (e) {
          console.error('Stream end error:', e);
        }
      }
    };

    const openai = new OpenAI({ apiKey });
    console.log('OpenAI client initialized');

    // ✔️ 尝试复用 MCP Client
    console.log('Initializing MCP clients:', {
      isYolo,
      mcpServerNames
    });

    const mcpClients: MCPClientLike[] = isYolo ? mcpServerNames.map(name => ({
      name, // 添加name属性
      getToolList: async () => {
        console.log(`Getting tool list for ${name}`);
        const client = await getMCPClientByName(name);
        if (!client) {
          console.error(`Failed to get MCP client for "${name}"`);
          throw new Error(`Failed to get MCP client for "${name}"`);
        }
        const tools = await client.listTools();
        console.log(`Got tools for ${name}:`, tools);
        return tools;
      },
      invokeTool: async (toolName: string, args: string) => {
        console.log(`Invoking tool ${toolName} with args:`, args);
        const client = await getMCPClientByName(name);  // 使用外部的name变量
        if (!client) throw new Error(`Failed to get MCP client for "${name}"`);
        
        // 确保args是一个有效的JSON字符串
        let parsedArgs;
        try {
          parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
          console.log('Parsed arguments:', parsedArgs);
        } catch (e: any) {
          console.error('Failed to parse args:', e);
          throw new Error(`Invalid arguments format: ${e.message}`);
        }
        
        return client.callTool({ name: toolName, arguments: parsedArgs });
      }
    })) : [];

    console.log('MCP clients initialized:', mcpClients.length);

    let loop = 0;
    let messages = [...initMsgs] as ChatCompletionMessageParam[]; // 每次循环都累加上下文

    // 用于跟踪工具调用的状态
    const toolCallStates = new Map<string, ToolCallState>();
    
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
          endStream();
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

      console.log('tools:', tools);
      // ⬇️ 用于暂存本轮 tool 调用
      const toolCalls: CustomToolCall[] = [];
      let finishedWithToolCalls = false;

      // 2️⃣ 逐块解析 & 透传 token
      for await (const chunk of resp) {
        // 调试日志
        console.log('收到chunk:', JSON.stringify(chunk, null, 2));
        
        stream.write(`data: ${JSON.stringify(chunk)}\n\n`);
        
        const delta = chunk.choices[0]?.delta;
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            console.log('处理工具调用片段:', JSON.stringify(tc, null, 2));
            
            if (!tc.id) continue;
            
            let state = toolCallStates.get(tc.id);
            if (!state) {
              state = {
                id: tc.id,
                name: tc.function?.name || '',
                arguments: '',
                index: tc.index,
                argumentsComplete: false
              };
              toolCallStates.set(tc.id, state);
              console.log('创建新的工具调用状态:', JSON.stringify(state, null, 2));
            }
            
            // 更新函数名
            if (tc.function?.name) {
              state.name = tc.function.name;
            }
            
            // 累积参数
            if (tc.function?.arguments !== undefined) {
              const newArgs = tc.function.arguments;
              state.arguments += newArgs;
              
              // 检查是否是完整的JSON
              const isCompleteJSON = (() => {
                try {
                  const trimmed = state.arguments.trim();
                  if (!trimmed) return false;
                  if (!trimmed.startsWith('{')) return false;
                  if (!trimmed.endsWith('}')) return false;
                  JSON.parse(trimmed);
                  return true;
                } catch (e) {
                  return false;
                }
              })();
              
              state.argumentsComplete = isCompleteJSON;
              
              console.log(`累积参数 [${tc.id}]:`, {
                currentChunk: newArgs,
                accumulatedArgs: state.arguments,
                chunkLength: newArgs.length,
                isCompleteJSON
              });
            }
          }
        }

        if (chunk.choices[0]?.finish_reason === 'tool_calls') {
          finishedWithToolCalls = true;
          
          // 转换累积的状态为工具调用
          for (const state of toolCallStates.values()) {
            console.log('工具调用完成:', {
              id: state.id,
              name: state.name,
              argumentsLength: state.arguments.length,
              arguments: state.arguments,
              isComplete: state.argumentsComplete
            });
            
            try {
              let parsedArgs;
              
              // 如果参数不完整或为空，尝试从用户消息中提取路径
              if (!state.argumentsComplete || !state.arguments.trim()) {
                const userMessage = messages.find(m => m.role === 'user')?.content;
                if (userMessage && typeof userMessage === 'string') {
                  const path = OpenAIWithToolProvider.extractPathFromMessage(userMessage);
                  if (path) {
                    parsedArgs = { path };
                    console.log('从用户消息中提取的路径:', path);
                  }
                }
              } else {
                // 如果参数完整，使用累积的参数
                parsedArgs = OpenAIWithToolProvider.cleanAndParseJSON(state.arguments);
              }
              
              if (!parsedArgs || !parsedArgs.path) {
                throw new Error('No valid path found in arguments or user message');
              }
              
              console.log('最终解析的参数:', parsedArgs);
              
              // 执行工具调用
              try {
                const result = await mcpClients[0].invokeTool(state.name, JSON.stringify(parsedArgs));
                console.log('工具调用结果:', result);
                
                if (!streamEnded) {
                  send({ type: 'tool_result', name: state.name, result });
                  toolResults.push({ name: state.name, result, tool_call_id: state.id });
                }
              } catch (error) {
                console.error('工具执行失败:', error);
                if (!streamEnded) {
                  if (error instanceof Error) {
                    send({ type: 'tool_error', message: error.message });
                  } else {
                    send({ type: 'tool_error', message: 'Tool execution failed' });
                  }
                }
              }
            } catch (error) {
              console.error('参数解析失败:', {
                id: state.id,
                error,
                rawArguments: state.arguments
              });
              if (!streamEnded) {
                if (error instanceof Error) {
                  send({ type: 'tool_error', message: error.message });
                } else {
                  send({ type: 'tool_error', message: 'Failed to parse tool arguments' });
                }
              }
            }
          }
          
          if (!streamEnded) {
            endStream();
          }
          return;
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

      // 在工具执行之前
      console.log('当前MCP客户端状态:', {
        clientsCount: mcpClients.length,
        clientNames: mcpClients.map(c => c.name),
        requestedServer: mcpServerNames
      });

      // 执行工具调用
      try {
        console.log('准备执行工具调用，可用工具列表:', tools.map(t => t.function.name));
        console.log('MCP 客户端列表:', mcpServerNames);

        for (const c of toolCalls) {
          console.log('\n开始处理工具调用:', {
            toolName: c.name,
            argumentsType: typeof c.arguments,
            rawArguments: c.arguments,
            toolId: c.id,
            rawToolCall: JSON.stringify(c, null, 2)
          });

          if (!c.name) {
            console.error('工具调用缺少名称:', c);
            stream.write(`data: ${JSON.stringify({ type: 'tool_error', message: 'Tool call missing name' })}\n\n`);
            continue;
          }

          if (!c.arguments || typeof c.arguments !== 'string') {
            console.error('工具参数无效:', {
              name: c.name,
              argumentsType: typeof c.arguments,
              arguments: c.arguments
            });
            stream.write(`data: ${JSON.stringify({ type: 'tool_error', message: 'Invalid tool arguments' })}\n\n`);
            continue;
          }

          try {
            // 使用第一个可用的MCP客户端
            if (mcpClients.length === 0) {
              throw new Error('No MCP clients available');
            }
            
            console.log('Tool call details:', {
              name: c.name,
              arguments: c.arguments,
              parsedArguments: typeof c.arguments === 'string' ? JSON.parse(c.arguments) : c.arguments
            });
            
            const result = await mcpClients[0].invokeTool(c.name, c.arguments);
            console.log('工具调用成功:', {
              name: c.name,
              result: result
            });

            toolResults.push({ name: c.name, result: result, tool_call_id: c.id });
            stream.write(`data: ${JSON.stringify({ type: 'tool_result', name: c.name, result: result })}\n\n`);
          } catch (error: any) {
            console.error('工具调用失败:', {
              error: error.message,
              stack: error.stack
            });
            stream.write(`data: ${JSON.stringify({ type: 'tool_error', message: error.message })}\n\n`);
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

// 修改 invokeTool 函数
async function invokeTool(serverName: string, toolName: string, args: string): Promise<any> {
  const client = await getMCPClientByName(serverName);
  if (!client) {
    throw new Error(`Failed to get MCP client for "${serverName}"`);
  }

  const parsedArgs = JSON.parse(args);
  if (!parsedArgs.path) {
    throw new Error(`Tool ${toolName} requires 'path' parameter`);
  }

  console.log(`Invoking tool ${toolName} with args:`, parsedArgs);
  return await client.callTool({ name: toolName, arguments: parsedArgs });  // 使用 callTool 替代 invokeTool
}