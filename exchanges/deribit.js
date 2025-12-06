const TARGET_SYMBOLS = require('../config').TARGET_SYMBOLS;
const WebSocket = require('ws');

let reconnectTimer = null;
function connect(broadcast) {
  clearTimeout(reconnectTimer);

  const ws = new WebSocket('wss://www.deribit.com/ws/api/v2');

  ws.on('open', () => {
    console.info('Connected to Deribit WebSocket');
    const msg = {
      jsonrpc: "2.0",
      method: "public/subscribe",
      id: 42,
      params: {
        channels: ["trades.future.BTC.100ms", "trades.future.ETH.100ms"]
      }
    };
    ws.send(JSON.stringify(msg));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg && msg.params && msg.params.data) {
        console.log('parsed:', msg.params.data);
      }
        
      if (msg.params && msg.params.data) {
        msg.params.data.forEach((trade) => {
          if (trade.liquidation) {
            const o = {
              s: trade.instrument_name,       // 예: BTC-PERPETUAL
              S: trade.direction.toUpperCase(), // buy -> BUY
              p: trade.price,
              q: trade.amount,
              X: 'DERIBIT'                    // 거래소 식별자 추가
            };
            console.log('Deribit o:',o);

            //broadcast(normalizedData);
          }
        });
      }
    } catch (error) {
      console.error('Error processing Deribit message:', error);
    }
  });

  ws.on('error', (error) => {
    console.error('Deribit WebSocket Error:', error.message);
  });

  ws.on('close', (code, reason) => {
    console.warn(`Deribit WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
    reconnectTimer = setTimeout(connect, 5000);
  });
}
module.exports = connect;
