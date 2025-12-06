const fastify = require('fastify');
const websocket = require('@fastify/websocket');
const WebSocket = require('ws');
const connectBinance = require('./exchanges/binance');
const connectBybit = require('./exchanges/bybit');

const server = fastify({ logger: true });

server.register(websocket);

server.register(async function (fastify) {
  fastify.get('/ws/liquidations', { websocket: true }, (socket, req) => {
    socket.on('close', () => {
      console.info('Client disconnected.');
    });
    
    socket.on('message', (message) => {
      console.log(`Received client message: ${message.toString()}`);
    });
  });
});

function broadcast(data) {
  const message = JSON.stringify(data);
  server.websocketServer.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) { 
      client.send(message);
    }
  });
}

const start = async () => {
  try {
    await server.listen({ port: 3000 });
    console.info(`Fastify server listening on 3000`);
    
    connectBinance(broadcast);
    connectBybit(broadcast);
  } catch (err) {
    console.error(err);
    //if (binanceWs) binanceWs.close();
    process.exit(1);
  }
};

start();
