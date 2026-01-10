const TARGET_COINS = require('../config').TARGET_COINS;
const WebSocket = require('ws');

let reconnectTimer = null;
let pingInterval;

function connect(cb) {
  clearTimeout(reconnectTimer);

  const ws = new WebSocket('wss://stream.bybit.com/v5/public/linear');

  ws.on('open', () => {
    console.log('Connected to Bybit WebSocket');    

    const channels = TARGET_COINS.map(coin => `allLiquidation.${coin}USDT`);
    
    if (channels.length > 0) {
      const subscription = {
        op: 'subscribe',
        args: channels,
      };
      ws.send(JSON.stringify(subscription));
    } else {
      console.warn('No target coins to subscribe for Bybit');
    }

    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({op: 'ping'}));
      }
    }, 20000);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      // Bybit은 'pong' 응답을 보내므로 필터링
      if (msg.ret_msg === 'pong' || msg.op === 'pong') return;

      if (msg.topic && msg.topic.startsWith('allLiquidation') && msg.data) {
        // Bybit은 data가 배열 형태로 올 수 있음
        const liquidations = Array.isArray(msg.data) ? msg.data : [msg.data];

        liquidations.forEach((liq) => {
          const o = {
            s: liq.s, // Symbol (BTCUSDT)
            // 💡 Side 매핑: Bybit 'Buy' = Long 청산(시장가 매도 발생) -> false (SELL)
            // Bybit 'Sell' = Short 청산(시장가 매수 발생) -> true (BUY)
            S: liq.S === 'Sell', 
            p: parseFloat(liq.p), // 가격을 숫자로 변환
            q: parseFloat(liq.v), // 수량(v)을 숫자로 변환
            T: Number(liq.T),    // 💡 문자열 타임스탬프를 숫자로 확실히 변환 (중요)
            ex: 'BYBIT'
          };

          // console.log('Parsed Bybit Data:', o);
          cb(o); // server.js의 handleLiquidationData 호출
        });
      }
    } catch (error) {
      console.error('❌ Bybit message error:', error.message);
      console.error('Raw data:', data.toString());
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
