const TARGET_COINS = require('../config').TARGET_COINS;
const WebSocket = require('ws');

// Check if symbol is for a target coin (BTC or ETH)
// Must match exactly: BTC or ETH followed by USDT, USDC, USD, or underscore
function isTargetCoin(symbol) {
  if (!symbol) return false;
  const upperSymbol = symbol.toUpperCase();
  
  // Match BTC: BTCUSDT, BTCUSDC, BTCUSD_PERPETUAL, BTCUSD_QUARTER, etc.
  if (upperSymbol.match(/^BTC(USDT|USDC|USD|USD_|USDT_|USDC_)/)) {
    return TARGET_COINS.includes('BTC');
  }
  
  // Match ETH: ETHUSDT, ETHUSDC, ETHUSD_PERPETUAL, ETHUSD_QUARTER, etc.
  // But NOT ETHFI, ETHEREUM, etc.
  if (upperSymbol.match(/^ETH(USDT|USDC|USD|USD_|USDT_|USDC_)/)) {
    return TARGET_COINS.includes('ETH');
  }
  
  return false;
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
            p: o.ap, // average price
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
