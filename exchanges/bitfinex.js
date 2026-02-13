const TARGET_COINS = require('../config').TARGET_COINS;
const WebSocket = require('ws');

const WS_URL = 'wss://api-pub.bitfinex.com/ws/2';

// Bitfinex symbols: tBTCUSD, tETHUSD. Strip "t" prefix for extractCoin.
function normalizeSymbol(symbol) {
  if (!symbol || typeof symbol !== 'string') return null;
  const s = symbol.toUpperCase();
  return s.startsWith('T') ? s.slice(1) : s;
}

function isTargetCoin(symbol) {
  const sym = normalizeSymbol(symbol);
  if (!sym) return false;
  if (sym.match(/^BTC(USDT|USDC|USD)/)) return TARGET_COINS.includes('BTC');
  if (sym.match(/^ETH(USDT|USDC|USD)/)) return TARGET_COINS.includes('ETH');
  return false;
}

// Parse Bitfinex liquidation entry: [MSG_TYPE, POS_ID, TIME_MS, null, SYMBOL, AMOUNT, BASE_PRICE, null, IS_MATCH, IS_MARKET_SOLD, null, LIQUIDATION_PRICE]
function parseLiquidationEntry(entry) {
  if (!Array.isArray(entry) || entry.length < 12) return null;
  const msgType = entry[0];
  if (msgType !== 'pos') return null;
  const symbol = entry[4];
  if (!isTargetCoin(symbol)) return null;
  const amount = parseFloat(entry[5]);
  const liqPrice = parseFloat(entry[11]);
  const timeMs = parseInt(entry[2], 10);
  if (Number.isNaN(liqPrice) || Number.isNaN(amount) || amount === 0) return null;
  const sz = Math.abs(amount);
  return {
    s: normalizeSymbol(symbol) || symbol,
    S: amount < 0,
    p: liqPrice,
    q: sz,
    T: Number.isNaN(timeMs) ? Date.now() : timeMs,
    ex: 'BITFINEX',
  };
}

let reconnectTimer = null;

function connect(cb) {
  clearTimeout(reconnectTimer);

  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.info('Connected to Bitfinex WebSocket');
    ws.send(JSON.stringify({
      event: 'subscribe',
      channel: 'status',
      key: 'liq:global',
    }));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log('Bitfinex msg::', msg);

      if (msg.event === 'subscribed' || msg.event === 'info' || msg.event === 'pong') return;
      if (msg.event === 'error') {
        console.error('Bitfinex subscription error:', msg);
        return;
      }

      if (Array.isArray(msg) && msg.length >= 2) {
        const [, payload] = msg;
        if (!payload) return;

        const entries = Array.isArray(payload[0]) ? payload : [payload];
        entries.forEach((entry) => {
          const o = parseLiquidationEntry(entry);
          if (o) cb(o);
        });
      }
    } catch (error) {
      console.error('Bitfinex message error:', error.message);
    }
  });

  ws.on('error', (error) => {
    console.error('Bitfinex WebSocket Error:', error.message);
  });

  ws.on('close', (code, reason) => {
    console.warn(`Bitfinex WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
    reconnectTimer = setTimeout(() => connect(cb), 5000);
  });
}

module.exports = connect;
