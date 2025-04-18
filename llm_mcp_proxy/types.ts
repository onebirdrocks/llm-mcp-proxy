export interface Message {
  role: string;
  content: string;
}

export interface ModelMeta {
  max_tokens: number;
  max_input_tokens: number;
  max_output_tokens: number;
  input_cost_per_token: number;
  output_cost_per_token: number;
  mode: string;
  model_id: string;
  deprecation_date?: string;
  supports_function_calling?: boolean;
  supports_prompt_caching?: boolean;
  supports_system_messages?: boolean;
  supports_tool_choice?: boolean;
  input_cost_per_token_batches?: number;
  output_cost_per_token_batches?: number;
  cache_read_input_token_cost?: number;
  supported_endpoints?: string[];
  supported_modalities?: string[];
  supported_output_modalities?: string[];
  supports_parallel_function_calling?: boolean;
  supports_response_schema?: boolean;
  supports_vision?: boolean;
  supports_native_streaming?: boolean;
  supports_web_search?: boolean;
  search_context_cost_per_query?: {
    search_context_size_low: number;
    search_context_size_medium: number;
    search_context_size_high: number;
  };
}

export interface ModelsMetaConfig {
  openai: ModelMeta[];
  anthropic: ModelMeta[];
  deepseek: ModelMeta[];
  ollama: ModelMeta[];
} 