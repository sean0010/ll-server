require('dotenv').config();
const fastify = require('fastify');
const cors = require('@fastify/cors');
const websocket = require('@fastify/websocket');
const WebSocket = require('ws');
const { Pool } = require('pg');

const connectBinance = require('./exchanges/binance');
const connectBybit = require('./exchanges/bybit');
const connectBitmex = require('./exchanges/bitmex');

const server = fastify({ logger: true });

const pool = new Pool({
  connectionString: process.env.SUPABASE_DB_URL,
  // Supabase 환경에서는 SSL 연결이 필요할 수 있습니다.
  ssl: {
    rejectUnauthorized: false 
  }
});
pool.on('error', (err) => {
  server.log.error('Unexpected error on idle PostgreSQL client', err);
  process.exit(1); 
});

server.register(cors);
server.register(websocket);

function extractCoin(symbol) {
  if (!symbol) return null;
  const upperSymbol = symbol.toUpperCase();
  if (upperSymbol.startsWith('BTC') || upperSymbol.startsWith('XBT')) {
    return 'BTC';
  }
  if (upperSymbol.startsWith('ETH')) {
    return 'ETH';
  }
  return null;
}

async function handleLiquidationData(o) {
  const exchange = o.ex;
  const symbol = o.s;
  const side = o.S;
  const price = o.p;
  const quantity = o.q;
  const time = new Date(o.T).toISOString();
  const coin = extractCoin(symbol);
  
  const query = `
    INSERT INTO public.liquidations (exchange, symbol, side, price, quantity, time, coin)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (exchange, symbol, side, price, quantity, time) DO NOTHING
  `;
  const values = [exchange, symbol, side, price, quantity, time, coin];

  try {
    await pool.query(query, values);
  } catch (err) {
    server.log.error('Error saving liquidation to DB:', err.message);
  }

  // WebSocket broadcast
  const message = JSON.stringify(o);
  server.websocketServer.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

server.get('/api/v1/liquidations', async (req, reply) => {
  const symbol = req.query.symbol;
  if (!symbol) {
    return reply.status(400).send({ error: `parameter symbol required` });
  }
  const limit = parseInt(req.query.limit) || 100;
  const offset = parseInt(req.query.offset) || 0;
  const maxLimit = 500; 

  if (limit > maxLimit) {
    return reply.status(400).send({ error: `Limit cannot exceed ${maxLimit}` });
  }
  if (offset < 0) {
    return reply.status(400).send({ error: 'Offset cannot be negative' });
  }

  try {
    const result = await pool.query(`
      SELECT id,exchange,symbol,side,price,quantity,time,coin
      FROM public.liquidations
      WHERE public.liquidations.symbol=$1
      ORDER BY time DESC
      LIMIT $2 OFFSET $3;`, [symbol, limit, offset]);
    const countResult = await pool.query('SELECT COUNT(*) FROM public.liquidations WHERE public.liquidations.symbol=$1', [symbol]);
    const totalCount = parseInt(countResult.rows[0].count);

    reply.send({
      data: result.rows,
      total: totalCount,
    });
  } catch (err) {
    server.log.error('API Error:', err.message);
    reply.status(500).send({ error: 'Failed to fetch data from database.' });
  }
});

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

const start = async () => {
  try {
    // DB 연결 테스트
    const countResult = await pool.query('SELECT COUNT(*) FROM public.liquidations');
    const totalCount = parseInt(countResult.rows[0].count);
    console.log('PostgreSQL connection successful.', totalCount);

    await server.listen({ port: 3000, host: '0.0.0.0' });
    console.info(`Fastify server listening on 3000`);
    
    connectBinance(handleLiquidationData);
    connectBybit(handleLiquidationData);
    connectBitmex(handleLiquidationData);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
