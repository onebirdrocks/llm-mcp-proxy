export interface Message {
    role: string;
    content: string;
}

export interface ChatParams {
    model: string;
    messages: Message[];
    isYolo?: boolean;
    mcpServerNames?: string[];
}

export interface ChatResponse {
    choices: {
        message: Message;
    }[];
} 