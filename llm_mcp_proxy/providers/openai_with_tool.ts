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
    const mcpClients: MCPClientLike[] = isYolo ? mcpServerNames.map(name => ({
      getToolList: async () => [],
      invokeTool: async (name: string, args: string) => ({})
    })) : [];

    let loop = 0;
    let messages = [...initMsgs] as ChatCompletionMessageParam[]; // 每次循环都累加上下文

    while (loop++ < MAX_TOOL_LOOPS) {
      const reqStartTs = Date.now();

      // 1️⃣ 打开一次 ChatCompletion 流
      const resp = await openai.chat.completions.create({
        model,
        messages,
        stream: true,
      });

      // ⬇️ 用于暂存本轮 tool 调用
      const toolCalls: CustomToolCall[] = [];
      let finishedWithToolCalls = false;

      // 2️⃣ 逐块解析 & 透传 token
      const parser = createParser({
        onEvent(event: EventSourceMessage) {
          if (event.data === '[DONE]') {
            return;
          }
          try {
            const data = JSON.parse(event.data);
            if (data?.choices?.[0]?.delta?.content) {
              send({ type: 'token', content: data.choices[0].delta.content });
            }
            if (data?.choices?.[0]?.delta?.tool_calls) {
              const customToolCalls = data.choices[0].delta.tool_calls.map((tc: any) => ({
                id: tc.id || `tool_${Date.now()}`,
                name: tc.name,
                arguments: tc.arguments,
                type: 'function' as const,
                function: {
                  name: tc.name,
                  arguments: tc.arguments
                }
              }));
              toolCalls.push(...customToolCalls);
            }
            if (data?.choices?.[0]?.finish_reason === 'tool_calls') {
              finishedWithToolCalls = true;
            }
          } catch (err) {
            console.error('Error parsing SSE message:', err);
          }
        }
      });

      for await (const chunk of resp) {
        parser.feed(chunk.toString());
      }

      /*  ---- 本轮结束，判断是否要进工具 ---- */
      if (!finishedWithToolCalls) {
        // ✅ 模型正常结束，无需工具；整个对话完成
        break;
      }

      // ❌ 模型想用工具，但 isYolo=false
      if (!isYolo) {
        send({ type: 'need_confirm', toolCalls });
        stream.end();
        return;
      }

      // ❌ Yolo 但没有 mcpServer
      if (mcpClients.length === 0) {
        send({ type: 'error', message: 'mcpServerNames 字段为空，无法执行工具' });
        stream.end();
        return;
      }

      // 3️⃣ 执行所有工具（串行；如需并发可 Promise.all）
      try {
        const toolLists = await Promise.all(mcpClients.map(client => client.getToolList()));
        const allTools = toolLists.flat();
        const toolResults: { name: string; result: any; tool_call_id: string }[] = [];

        for (const c of toolCalls) {
          const meta = allTools.find(t => t.name === c.name);
          if (!meta) {
            send({
              type: 'tool_error',
              name: c.name,
              message: 'Tool not found on any MCP server',
            });
            continue;
          }
          // 找到包含该工具的客户端
          const clientIndex = toolLists.findIndex(list => 
            list.some(tool => tool.name === c.name)
          );
          if (clientIndex === -1) continue;
          
          const res = await mcpClients[clientIndex].invokeTool(meta.name, c.arguments);
          toolResults.push({ name: meta.name, result: res, tool_call_id: c.id });
          send({ type: 'tool_result', name: meta.name, result: res });
        }

        // 4️⃣ 把工具调用 & 结果压到 messages，开启下一轮
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
        send({ type: 'tool_error', message: e.message });
        stream.end();
        return;
      }

      // 🔄 进入下一循环（继续与模型对话）
      const duration = ((Date.now() - reqStartTs) / 1000).toFixed(1);
      send({ type: 'loop_info', loop, duration });
    }

    // 循环完毕 → 通知前端结束
    send('[DONE]');
    stream.end();
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
