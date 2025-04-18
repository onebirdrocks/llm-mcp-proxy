export interface ListModelsParams {
  apiKey?: string;
  provider?: string;
}

export interface ChatParams {
  model: string;
  messages: Message[];
  apiKey?: string;  // API Key 可选参数
  isYolo?: boolean;
  mcpServerNames?: string[];
  stream?: boolean;  // 添加 stream 参数
}

export interface Message {
  role: string;
  content: string;
}

export interface BaseProvider {
  chat(params: ChatParams): Promise<any>;
  chatStream(params: ChatParams, stream: NodeJS.WritableStream): Promise<void>;
  listModels(params?: ListModelsParams): Promise<Array<{ id: string; provider: string }>>;
}