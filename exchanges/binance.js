const TARGET_SYMBOLS = require('../config').TARGET_SYMBOLS;
const WebSocket = require('ws');

let reconnectTimer = null;
function connect(handleLiquidationData) {
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

        if (TARGET_SYMBOLS.includes(o.s)) {          
          handleLiquidationData({
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
    reconnectTimer = setTimeout(connect, 5000); 
  });
}
module.exports = connect;
