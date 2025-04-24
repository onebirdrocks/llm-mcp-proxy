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
}

export class OpenAIWithToolProvider implements BaseProvider {
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

    const send = (payload: any) => {
      console.log('Sending payload:', payload);
      stream.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const openai = new OpenAI({ apiKey });
    console.log('OpenAI client initialized');

    // ✔️ 尝试复用 MCP Client
    console.log('Initializing MCP clients:', {
      isYolo,
      mcpServerNames
    });

    const mcpClients: MCPClientLike[] = isYolo ? mcpServerNames.map(name => ({
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
      invokeTool: async (name: string, args: string) => {
        console.log(`Invoking tool ${name} with args:`, args);
        const client = await getMCPClientByName(name);
        if (!client) throw new Error(`Failed to get MCP client for "${name}"`);
        return client.callTool({ name, arguments: JSON.parse(args) });
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
                index: tc.index
              };
              toolCallStates.set(tc.id, state);
              console.log('创建新的工具调用状态:', JSON.stringify(state, null, 2));
            }
            
            // 更新函数名
            if (tc.function?.name) {
              state.name = tc.function.name;
            }
            
            // 累积参数
            if (tc.function?.arguments !== undefined) {  // 注意这里的改变
              state.arguments += tc.function.arguments;
              console.log(`累积参数 [${tc.id}]:`, {
                currentChunk: tc.function.arguments,
                accumulatedArgs: state.arguments,
                chunkLength: tc.function.arguments.length
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
              arguments: state.arguments
            });
            
            try {
              // 验证参数是否为有效的 JSON
              if (state.arguments) {
                JSON.parse(state.arguments);
              }
              
              toolCalls.push({
                id: state.id,
                name: state.name,
                type: 'function',
                function: {
                  name: state.name,
                  arguments: state.arguments || '{}'  // 提供默认值
                },
                arguments: state.arguments || '{}'
              });
            } catch (e) {
              console.error('参数解析失败:', {
                id: state.id,
                error: e,
                rawArguments: state.arguments
              });
              send({ type: 'tool_error', message: 'Invalid JSON arguments' });
            }
          }
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
        const toolResults: { name: string; result: any; tool_call_id: string }[] = [];

        console.log('准备执行工具调用，可用工具列表:', tools.map(t => t.function.name));
        console.log('MCP 客户端列表:', mcpServerNames);

        for (const c of toolCalls) {
          console.log('\n开始处理工具调用:', {
            toolName: c.name,
            argumentsType: typeof c.arguments,
            rawArguments: c.arguments,
            toolId: c.id,
            rawToolCall: JSON.stringify(c, null, 2)  // 完整的工具调用数据
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

          // 在处理工具调用之前，先检查参数是否有效
          console.log('验证工具调用:', {
            name: c.name,
            arguments: c.arguments
          });

          // // 确保参数不为空
          // if (!c.arguments || c.arguments === '{}') {
          //   console.error('工具调用缺少必要参数');
          //   stream.write(`data: ${JSON.stringify({ 
          //     type: 'tool_error', 
          //     message: `Tool ${c.name} requires valid arguments with 'path' parameter` 
          //   })}\n\n`);
          //   continue;
          // }

          // 在查找具体工具的客户端时
          console.log('查找工具对应的客户端:', {
            toolName: 'get_all_epub_files',
            availableClients: mcpClients.map(c => c.name),
            toolsPerClient: mcpClients.map(c => ({
              client: c.name,
              tools: c.getToolList()  // 假设有这个方法
            }))
          });

          // 使用正确的 MCP 服务器名称
          const serverName = mcpServerNames[0] || 'ebook-mcp';  // 使用提供的服务器名或默认值
          try {
            console.log(`使用 MCP 客户端:`, { 
              serverName, 
              toolName: c.name, 
              args: c.arguments 
            });
            
            //const result = await mcpClients[0].invokeTool(c.name, c.arguments);
            const result = await mcpClients[0].invokeTool(c.name, "/Users/onebird/Downloads/");
            console.log('工具调用成功:', {
              name: c.name,
              result: result
            });

            toolResults.push({ name: c.name, result: result, tool_call_id: c.id });
            stream.write(`data: ${JSON.stringify({ type: 'tool_result', name: c.name, result: result })}\n\n`);
          } catch (error) {
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