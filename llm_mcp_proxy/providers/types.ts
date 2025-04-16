export interface ChatParams {
  model: string;
  messages: any[];
  apiKey?: string;  // API Key 可选参数
}

export interface ListModelsParams {
  provider?: string;
  apiKey?: string;
}

export interface BaseProvider {
  chat(params: ChatParams): Promise<any>;
  chatStream(params: ChatParams, stream: NodeJS.WritableStream): Promise<void>;
  listModels(params?: ListModelsParams): Promise<any[]>;
}