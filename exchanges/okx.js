const TARGET_COINS = require('../config').TARGET_COINS;
const WebSocket = require('ws');

// OKX instId e.g. BTC-USDT-SWAP -> normalize to BTCUSDT for extractCoin
function normalizeSymbol(instId) {
  if (!instId) return null;
  const parts = instId.split('-');
  if (parts.length >= 2) return parts[0] + parts[1]; // BTC-USDT-SWAP -> BTCUSDT
  return instId.replace(/-/g, '');
}

function isTargetCoin(instId) {
  const sym = normalizeSymbol(instId);
  if (!sym) return false;
  const upper = sym.toUpperCase();
  if (upper.match(/^BTC(USDT|USDC|USD)/)) return TARGET_COINS.includes('BTC');
  if (upper.match(/^ETH(USDT|USDC|USD)/)) return TARGET_COINS.includes('ETH');
  return false;
}

let reconnectTimer = null;
let pingInterval;

function connect(cb) {
  clearTimeout(reconnectTimer);

  const ws = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');

  ws.on('open', () => {
    console.info('Connected to OKX WebSocket');

    const subscription = {
      op: 'subscribe',
      args: [{ channel: 'liquidation-orders', instType: 'SWAP' }],
    };
    ws.send(JSON.stringify(subscription));

    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ op: 'ping' }));
      }
    }, 25000);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.op === 'pong') return;
      if (msg.event === 'subscribe' || msg.event === 'error') return;

      if (msg.arg?.channel === 'liquidation-orders' && Array.isArray(msg.data)) {
        msg.data.forEach((item) => {
          if (!isTargetCoin(item.instId)) return;
          const instId = item.instId || '';
          const details = Array.isArray(item.details) ? item.details : [];

          details.forEach((d) => {
            const px = parseFloat(d.bkPx);
            const sz = parseFloat(d.sz);
            if (Number.isNaN(px) || Number.isNaN(sz) || sz <= 0) return;
            const side = (d.side || '').toLowerCase();
            const ts = d.ts ? parseInt(d.ts, 10) : Date.now();

            const o = {
              s: normalizeSymbol(instId) || instId,
              S: side === 'buy',
              p: px,
              q: sz,
              T: ts,
              ex: 'OKX',
            };
            cb(o);
          });
        });
      }
    } catch (error) {
      console.error('OKX message error:', error.message);
    }
  });

  ws.on('error', (error) => {
    console.error('OKX WebSocket Error:', error.message);
  });

  ws.on('close', (code, reason) => {
    console.warn(`OKX WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
    if (pingInterval) clearInterval(pingInterval);
    reconnectTimer = setTimeout(() => connect(cb), 5000);
  });
}

module.exports = connect;
