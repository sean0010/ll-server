const TARGET_COINS = require('../config').TARGET_COINS;
const WebSocket = require('ws');

// Check if BitMEX symbol is for a target coin (BTC or ETH)
// BitMEX uses XBT for BTC, and ETH for ETH
// Match XBT contracts (XBTUSD, XBTU22, etc.) and ETH contracts (ETHUSD, ETHU22, etc.)
// But NOT ETHFI or other ETH-prefixed tokens
function isTargetCoin(bitmexSymbol) {
  if (!bitmexSymbol) return false;
  const upperSymbol = bitmexSymbol.toUpperCase();
  
  // Check if it's a BTC contract (starts with XBT)
  if (upperSymbol.startsWith('XBT')) {
    return TARGET_COINS.includes('BTC');
  }
  
  // Check if it's an ETH contract (ETHUSD, ETHU22, etc.)
  // But NOT ETHFI or other tokens
  // BitMEX typically uses ETHUSD for perpetual and ETHU22, ETHZ22, etc. for quarterly
  if (upperSymbol.match(/^ETH(USD|U\d{2}|Z\d{2}|M\d{2}|H\d{2})/)) {
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
              q: parseFloat(liquidation.leavesQty) / parseFloat(liquidation.price),
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

