const TARGET_COINS = require('../config').TARGET_COINS;
const WebSocket = require('ws');

// Check if symbol is for a target coin (BTC or ETH)
// Must match exactly: BTC or ETH followed by USDT, USDC, USD, or underscore
function isTargetCoin(symbol) {
  if (!symbol) return false;
  const upperSymbol = symbol.toUpperCase();
  
  // Match BTC: BTCUSDT, BTCUSDC, BTCUSD, etc.
  if (upperSymbol.match(/^BTC(USDT|USDC|USD|USD_|USDT_|USDC_)/)) {
    return TARGET_COINS.includes('BTC');
  }
  
  // Match ETH: ETHUSDT, ETHUSDC, ETHUSD, etc.
  // But NOT ETHFI, ETHEREUM, etc.
  if (upperSymbol.match(/^ETH(USDT|USDC|USD|USD_|USDT_|USDC_)/)) {
    return TARGET_COINS.includes('ETH');
  }
  
  return false;
}

let reconnectTimer = null;
let pingInterval;

function connect(cb) {
  clearTimeout(reconnectTimer);

  const ws = new WebSocket('wss://stream.bybit.com/v5/public/linear');

  ws.on('open', () => {
    console.log('Connected to Bybit WebSocket');    

    // Bybit requires subscribing to specific symbols
    // We'll subscribe to all possible BTC and ETH symbols using wildcard pattern
    // Bybit v5 API supports subscribing to multiple symbols at once
    const subscription = {
      op: 'subscribe',
      args: ['allLiquidation'], // Subscribe to all liquidations, filter by coin in handler
    };
    ws.send(JSON.stringify(subscription));
    console.log('Subscribed to Bybit allLiquidation (will filter by coin)');

    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({op: 'ping'}));
      }
    }, 20000);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.topic && msg.topic.startsWith('allLiquidation') && msg.data) {
        msg.data.forEach((liquidation) => {
          // Filter by target coins (BTC or ETH)
          if (isTargetCoin(liquidation.s)) {
            const o = {
              s: liquidation.s, // original symbol from Bybit
              S: liquidation.S !== 'Buy', // Buy: long position has been liquidated
              p: liquidation.p, // price
              q: liquidation.v, // volume
              T: liquidation.T, // timestamp
              ex: 'BYBIT'
            };

            cb(o);
          }
        });
      }
    } catch (error) {
      console.error('Error processing Bybit message:', error);
    }
  });

  ws.on('error', (error) => {
    console.error('Bybit WebSocket Error:', error.message);
  });

  ws.on('close', (code, reason) => {
    console.warn(`Bybit WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
    reconnectTimer = setTimeout(() => connect(cb), 5000);
  });
}
module.exports = connect;
