const TARGET_SYMBOLS = require('../config').TARGET_SYMBOLS;
const WebSocket = require('ws');

let reconnectTimer = null;
let pingInterval;
function connect(broadcast) {
  clearTimeout(reconnectTimer);

  const ws = new WebSocket('wss://stream.bybit.com/v5/public/linear');

  ws.on('open', () => {
    console.log('Connected to Bybit WebSocket');    

    const channels = TARGET_SYMBOLS.map(s => `allLiquidation.${s}`);
    const subscription = {
      op: 'subscribe',
      args: channels,
    };
    ws.send(JSON.stringify(subscription));

    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({op: 'ping'}));
      }
    }, 29000);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.op !== 'ping') console.log('Bybit msg:', msg);
      if (msg.topic && msg.topic.startsWith('allLiquidation') && msg.data) {
        msg.data.forEach((liquidation) => {
          const o = {
            s: liquidation.s, // symbol
            S: liquidation.S, // Buy: 롱 청산, Sell: 숏 청산
            p: liquidation.p, // price
            q: liquidation.v, // volume
            T: liquidation.T, // timestamp
            ex: 'BYBIT'
          };
          console.log('Bybit o:',o);

          broadcast(o);
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
    reconnectTimer = setTimeout(connect, 5000);
  });
}
module.exports = connect;
