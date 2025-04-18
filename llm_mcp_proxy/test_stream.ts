import OpenAI from 'openai';
import { createParser, EventSourceMessage } from 'eventsource-parser';

async function testOpenAIStreaming() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY environment variable is not set');
    return;
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  try {
    console.log('Making request to OpenAI...');
    const resp = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: 'Say "Hello, World!" slowly.' }],
      stream: true
    });

    console.log('Response received, processing stream...');

    for await (const chunk of resp) {
      console.log('Received chunk:', JSON.stringify(chunk, null, 2));
      if (chunk.choices[0]?.delta?.content) {
        process.stdout.write(chunk.choices[0].delta.content);
      }
    }
    
    console.log('\nStream completed');
  } catch (error) {
    console.error('Error in streaming test:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
      console.error('Error stack:', error.stack);
    }
  }
}

// 执行测试
console.log('Starting OpenAI streaming test...');
testOpenAIStreaming().then(() => {
  console.log('\nTest completed');
}).catch(error => {
  console.error('Test failed:', error);
}); 