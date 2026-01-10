const TARGET_COINS = require('../config').TARGET_COINS;
const WebSocket = require('ws');

// Check if BitMEX symbol is for a target coin (BTC or ETH)
// BitMEX uses XBT for BTC
function isTargetCoin(bitmexSymbol) {
  if (!bitmexSymbol) return false;
  const upperSymbol = bitmexSymbol.toUpperCase();
  // Check if it's a BTC contract (starts with XBT)
  if (upperSymbol.startsWith('XBT')) {
    return TARGET_COINS.includes('BTC');
  }
  // Check if it's an ETH contract (starts with ETH)
  if (upperSymbol.startsWith('ETH')) {
    return TARGET_COINS.includes('ETH');
  }
  return false;
}

let reconnectTimer = null;
let pingInterval;

function connect(cb) {
  clearTimeout(reconnectTimer);

  const ws = new WebSocket('wss://www.bitmex.com/realtime');

  ws.on('open', () => {
    console.info('Connected to BitMEX WebSocket');
    
    // Subscribe to liquidation channel
    const subscription = {
      op: 'subscribe',
      args: ['liquidation']
    };
    ws.send(JSON.stringify(subscription));

    // BitMEX requires ping every 30 seconds
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({op: 'ping'}));
      }
    }, 30000);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      
      // BitMEX sends liquidation data in this format:
      // {"table": "liquidation", "action": "insert", "data": [...]}
      if (msg.table === 'liquidation' && msg.action === 'insert' && msg.data) {
        msg.data.forEach((liquidation) => {
          // Check if this is a BTC or ETH related contract
          if (isTargetCoin(liquidation.symbol)) {
            // Use original BitMEX symbol (e.g., XBTUSD, ETHUSD, XBTU22, etc.)
            // BitMEX side: 'Buy' means long position was liquidated (short liquidation)
            //              'Sell' means short position was liquidated (long liquidation)
            // Our format: S = true means short liquidation, S = false means long liquidation
            const o = {
              s: liquidation.symbol, // original BitMEX symbol
              S: liquidation.side === 'Buy', // Buy = short liquidation (long position liquidated)
              p: parseFloat(liquidation.price),
              q: parseFloat(liquidation.leavesQty || liquidation.size || 0),
              T: liquidation.timestamp ? new Date(liquidation.timestamp).getTime() : Date.now(),
              ex: 'BITMEX'
            };

            cb(o);
          }
        });
      }
    } catch (error) {
      console.error('Error processing BitMEX message:', error);
    }
  });

  ws.on('error', (error) => {
    console.error('BitMEX WebSocket Error:', error.message);
  });

  ws.on('close', (code, reason) => {
    console.warn(`BitMEX WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
    if (pingInterval) {
      clearInterval(pingInterval);
    }
    reconnectTimer = setTimeout(() => connect(cb), 5000);
  });
}

module.exports = connect;

