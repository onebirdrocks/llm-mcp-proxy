import OpenAI from 'openai';

export class OpenAIAdapter {
    private client;
    constructor(private model: string) {
        this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }

    async chat(messages: any[], tools?: any[]) {
        const result = await this.client.chat.completions.create({
            model: this.model,
            messages,
            tools,
            tool_choice: 'auto'
        });
        return result;
    }
}