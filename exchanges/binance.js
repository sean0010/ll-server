const TARGET_COINS = require('../config').TARGET_COINS;
const WebSocket = require('ws');

// Check if symbol is for a target coin (BTC or ETH)
function isTargetCoin(symbol) {
  if (!symbol) return false;
  const upperSymbol = symbol.toUpperCase();
  return TARGET_COINS.some(coin => upperSymbol.startsWith(coin));
}

let reconnectTimer = null;
function connect(cb) {
  clearTimeout(reconnectTimer);

  const ws = new WebSocket('wss://fstream.binance.com/ws/!forceOrder@arr');

  ws.on('open', () => {
    console.info('Connected to Binance forceOrder@arr');
  });

  ws.on('message', (data) => {
    try {
      const rawData = JSON.parse(data.toString());
        
      if (rawData.e === 'forceOrder' && rawData.o) {
        const o = rawData.o;

        // Check if symbol is for BTC or ETH
        if (isTargetCoin(o.s)) {
          cb({
            ...o,
            S: o.S === 'BUY',
            ex: 'BINANCE',
          }); 
        }
      }
    } catch (error) {
      console.error('Error processing Binance message:', error);
    }
  });

  ws.on('error', (error) => {
    console.error('Binance WebSocket Error:', error.message);
  });

  ws.on('close', (code, reason) => {
    console.warn(`Binance WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
    reconnectTimer = setTimeout(() => connect(cb), 5000);
  });
}
module.exports = connect;
