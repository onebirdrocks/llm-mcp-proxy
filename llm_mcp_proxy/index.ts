import 'dotenv/config';
import Fastify from 'fastify';
import chatRoutes from './routes/chat';
import modelsRoutes from './routes/models';

const server = Fastify({ logger: true });

server.register(chatRoutes, { prefix: '/v1/chat' });
server.register(modelsRoutes, { prefix: '/v1' });

server.listen({ port: 3000 }, (err, address) => {
  if (err) {
    server.log.error(err);
    process.exit(1);
  }
  console.log(`🚀 Server ready at ${address}`);
});