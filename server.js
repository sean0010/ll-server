require('dotenv').config();
const fastify = require('fastify');
const cors = require('@fastify/cors');
const websocket = require('@fastify/websocket');
const WebSocket = require('ws');
const { Pool } = require('pg');

const connectBinance = require('./exchanges/binance');
const connectBybit = require('./exchanges/bybit');
const connectBitmex = require('./exchanges/bitmex');
const connectOkx = require('./exchanges/okx');
const connectBitfinex = require('./exchanges/bitfinex');

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

server.register(cors, {
  origin: [
    "https://liquidationlog.com",
    "https://www.liquidationlog.com",
    "https://api.liquidationlog.com",
    /^https:\/\/.*\.liquidationlog\.com$/, // 서브도메인
    "http://localhost:4000",
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  credentials: true,
});
server.register(websocket);

function extractCoin(symbol) {
  if (!symbol) return null;
  const upperSymbol = symbol.toUpperCase();
  
  // Match BTC: BTCUSDT, BTCUSDC, BTCUSD_PERPETUAL, etc. or XBT (BitMEX)
  if (upperSymbol.match(/^BTC(USDT|USDC|USD|USD_|USDT_|USDC_)/) || upperSymbol.startsWith('XBT')) {
    return 'BTC';
  }
  
  // Match ETH: ETHUSDT, ETHUSDC, ETHUSD_PERPETUAL, etc.
  // But NOT ETHFI, ETHEREUM, etc.
  if (upperSymbol.match(/^ETH(USDT|USDC|USD|USD_|USDT_|USDC_)/)) {
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

  const message = JSON.stringify(o);
  server.websocketServer.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });

  const query = `
    INSERT INTO public.liquidations (exchange, coin, symbol, side, price, quantity, time)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (exchange, symbol, side, price, quantity, time) DO NOTHING
  `;
  const values = [exchange, coin, symbol, side, price, quantity, time];
  pool.query(query, values).catch((err) => server.log.error('Error saving liquidation to DB:', err.message));
}

server.get('/api/v1/liquidations', async (req, reply) => {
  const coin = req.query.coin;
  if (!coin) {
    return reply.status(400).send({ error: `parameter coin required` });
  }
  const limit = parseInt(req.query.limit) || 100;
  const maxLimit = 500; 

  if (limit > maxLimit) {
    return reply.status(400).send({ error: `Limit cannot exceed ${maxLimit}` });
  }

  // Parse cursor parameter (optional, ISO timestamp string)
  let cursor = null;
  if (req.query.cursor) {
    try {
      // Validate cursor is a valid ISO timestamp
      const cursorDate = new Date(req.query.cursor);
      if (isNaN(cursorDate.getTime())) {
        return reply.status(400).send({ error: 'Invalid cursor format. Expected ISO timestamp.' });
      }
      cursor = cursorDate.toISOString();
    } catch (err) {
      return reply.status(400).send({ error: 'Invalid cursor format. Expected ISO timestamp.' });
    }
  }

  // Parse offset parameter (optional, for backward compatibility)
  // If cursor is provided, offset is ignored
  const offset = cursor ? 0 : (parseInt(req.query.offset) || 0);
  if (offset < 0) {
    return reply.status(400).send({ error: 'Offset cannot be negative' });
  }

  // Parse exchanges parameter (optional, comma-separated)
  let exchanges = null;
  if (req.query.exchanges) {
    exchanges = req.query.exchanges
      .split(',')
      .map(ex => ex.trim().toUpperCase())
      .filter(ex => ex.length > 0);
    
    // Validate exchange names
    const validExchanges = require('./config').EXCHANGES;
    const invalidExchanges = exchanges.filter(ex => !validExchanges.includes(ex));
    if (invalidExchanges.length > 0) {
      return reply.status(400).send({ 
        error: `Invalid exchange names: ${invalidExchanges.join(', ')}. Valid exchanges: ${validExchanges.join(', ')}` 
      });
    }
  }

  try {
    let queryParams = [coin];
    let whereClause = 'WHERE public.liquidations.coin=$1';
    let paramIndex = 1;
    
    // Add exchange filter if provided
    if (exchanges && exchanges.length > 0) {
      paramIndex++;
      whereClause += ` AND public.liquidations.exchange = ANY($${paramIndex}::text[])`;
      queryParams.push(exchanges);
    }

    // Add cursor filter if provided (cursor-based pagination)
    if (cursor) {
      paramIndex++;
      whereClause += ` AND public.liquidations.time < $${paramIndex}`;
      queryParams.push(cursor);
    }

    // Build SELECT query
    const limitParamIndex = paramIndex + 1;
    const offsetParamIndex = cursor ? null : paramIndex + 2;
    
    let selectQuery = `
      SELECT id,exchange,symbol,side,price,quantity,time
      FROM public.liquidations
      ${whereClause}
      ORDER BY time DESC
      LIMIT $${limitParamIndex}
    `;
    
    if (offsetParamIndex) {
      selectQuery += ` OFFSET $${offsetParamIndex}`;
      queryParams.push(limit, offset);
    } else {
      queryParams.push(limit);
    }

    const result = await pool.query(selectQuery, queryParams);

    // Calculate nextCursor and hasMore for cursor-based pagination
    let nextCursor = null;
    let hasMore = false;
    
    if (cursor || result.rows.length > 0) {
      // If using cursor or got results, calculate next cursor
      if (result.rows.length > 0) {
        // Use the last item's time as the next cursor
        // For duplicate timestamps, we need to handle them properly
        const lastTime = result.rows[result.rows.length - 1].time;
        // Ensure nextCursor is an ISO string
        if (lastTime instanceof Date) {
          nextCursor = lastTime.toISOString();
        } else if (typeof lastTime === 'string') {
          // If it's already a string, ensure it's ISO format
          nextCursor = new Date(lastTime).toISOString();
        } else {
          nextCursor = lastTime;
        }
        
        // hasMore: if we got exactly 'limit' items, there might be more
        hasMore = result.rows.length === limit;
      }
    }

    // Build response
    let response = {
      data: result.rows,
      hasMore: hasMore,
    };

    if (cursor) {
      // Cursor-based: include nextCursor
      response.nextCursor = nextCursor;
    } else {
      // Initial load or offset-based: include both nextCursor and total
      if (nextCursor) {
        response.nextCursor = nextCursor;
      }
      // Include total for backward compatibility
      const countQuery = `SELECT COUNT(*) FROM public.liquidations ${whereClause}`;
      const countParams = exchanges && exchanges.length > 0 
        ? [coin, exchanges] 
        : [coin];
      const countResult = await pool.query(countQuery, countParams);
      const totalCount = parseInt(countResult.rows[0].count);
      response.total = totalCount;
    }

    reply.send(response);
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
    connectOkx(handleLiquidationData);
    connectBitfinex(handleLiquidationData);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
