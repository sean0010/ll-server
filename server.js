const fastify = require('fastify');
const websocket = require('@fastify/websocket');
const WebSocket = require('ws');

const TARGET_SYMBOLS = ['BTCUSDT', 'ETHUSDT', ];
const BINANCE_WS_URL = 'wss://fstream.binance.com/ws/!forceOrder@arr'; 

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

let binanceWs;
let reconnectTimer = null;
function connectToBinance() {
  clearTimeout(reconnectTimer);

  console.info(`Connecting to Binance WebSocket: ${BINANCE_WS_URL}`);
  binanceWs = new WebSocket(BINANCE_WS_URL);

  binanceWs.on('open', () => {
    console.info('Connected to Binance Futures Liquidation Stream.');
  });

  binanceWs.on('message', (data) => {
    try {
      const rawData = JSON.parse(data.toString());
        
      if (rawData.e === 'forceOrder' && rawData.o) {
        const o = rawData.o;

        if (TARGET_SYMBOLS.includes(o.s)) {
          console.log(`${o.S} ${o.s} ${o.q}(${o.ap*o.q}) ${o.p} $${o.l}[$${o.z}] ${o.X}`);
          broadcast(o); 
        }
      }
    } catch (error) {
      console.error('Error processing Binance message:', error);
    }
  });

  binanceWs.on('error', (error) => {
    console.error('Binance WebSocket Error:', error.message);
  });

  binanceWs.on('close', (code, reason) => {
    console.warn(`Binance WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
    setTimeout(connectToBinance, 5000); 
  });
}

const start = async () => {
  try {
    await server.listen({ port: 3000 });
    console.info(`Fastify server listening on 3000`);
    
    connectToBinance();
  } catch (err) {
    console.error(err);
    if (binanceWs) binanceWs.close();
    process.exit(1);
  }
};

start();
