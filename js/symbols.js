import { el } from './util.js';
// Symbol universe. Crypto uses live Binance market data; the rest use a
// deterministic market simulator (clearly labelled "SIM" in the UI).
const C = (s, name, base, vol = 0.7) => ({ symbol: s + 'USDT', base: s, exchange: 'BINANCE', name: `${name} / TetherUS`, type: 'crypto', feed: 'binance', price: base, vol });
const S = (s, name, price, vol = 0.3, exchange = 'NASDAQ') => ({ symbol: s, exchange, name, type: 'stock', feed: 'sim', price, vol });
const I = (s, name, price, vol = 0.18, exchange = 'INDEX') => ({ symbol: s, exchange, name, type: 'index', feed: 'sim', price, vol });
const F = (s, name, price, vol = 0.08) => ({ symbol: s, exchange: 'FX', name, type: 'forex', feed: 'sim', price, vol });
const M = (s, name, price, vol = 0.25, exchange = 'COMEX') => ({ symbol: s, exchange, name, type: 'futures', feed: 'sim', price, vol });
const B = (s, name, price, vol = 0.2) => ({ symbol: s, exchange: 'TVC', name, type: 'bond', feed: 'sim', price, vol });

export const SYMBOLS = [
  C('BTC', 'Bitcoin', 60000), C('ETH', 'Ethereum', 1700), C('BNB', 'BNB', 550), C('SOL', 'Solana', 70),
  C('XRP', 'XRP', 0.94), C('ADA', 'Cardano', 0.146), C('DOGE', 'Dogecoin', 0.056), C('AVAX', 'Avalanche', 6.6),
  C('DOT', 'Polkadot', 0.66), C('LINK', 'Chainlink', 9), C('LTC', 'Litecoin', 42), C('TRX', 'TRON', 0.3),
  C('BCH', 'Bitcoin Cash', 204), C('UNI', 'Uniswap', 4.7), C('ATOM', 'Cosmos', 1.24), C('NEAR', 'NEAR Protocol', 3),
  C('APT', 'Aptos', 0.37), C('ARB', 'Arbitrum', 0.11), C('OP', 'Optimism', 0.069), C('SUI', 'Sui', 0.66),
  C('PEPE', 'Pepe', 0.0000035), C('SHIB', 'Shiba Inu', 0.0000036), C('FIL', 'Filecoin', 0.55), C('XLM', 'Stellar', 0.128),
  C('AAVE', 'Aave', 95), C('INJ', 'Injective', 6), C('ETC', 'Ethereum Classic', 5.85), C('TON', 'Toncoin', 1.6),
  S('AAPL', 'Apple Inc.', 232, 0.25), S('MSFT', 'Microsoft Corporation', 425, 0.24), S('NVDA', 'NVIDIA Corporation', 142, 0.5),
  S('AMZN', 'Amazon.com, Inc.', 205, 0.32), S('GOOGL', 'Alphabet Inc. Class A', 176, 0.3), S('META', 'Meta Platforms, Inc.', 585, 0.38),
  S('TSLA', 'Tesla, Inc.', 340, 0.6), S('NFLX', 'Netflix, Inc.', 890, 0.36), S('AMD', 'Advanced Micro Devices', 138, 0.5),
  S('INTC', 'Intel Corporation', 23, 0.45), S('ORCL', 'Oracle Corporation', 185, 0.3, 'NYSE'), S('CRM', 'Salesforce, Inc.', 335, 0.33, 'NYSE'),
  S('ADBE', 'Adobe Inc.', 510, 0.32), S('PYPL', 'PayPal Holdings, Inc.', 86, 0.38), S('UBER', 'Uber Technologies', 70, 0.42, 'NYSE'),
  S('COIN', 'Coinbase Global, Inc.', 295, 0.75), S('PLTR', 'Palantir Technologies', 64, 0.65), S('JPM', 'JPMorgan Chase & Co.', 245, 0.22, 'NYSE'),
  S('V', 'Visa Inc.', 312, 0.18, 'NYSE'), S('MA', 'Mastercard Incorporated', 525, 0.19, 'NYSE'), S('BAC', 'Bank of America Corp', 46, 0.27, 'NYSE'),
  S('WMT', 'Walmart Inc.', 91, 0.18, 'NYSE'), S('DIS', 'The Walt Disney Company', 115, 0.28, 'NYSE'), S('KO', 'The Coca-Cola Company', 63, 0.14, 'NYSE'),
  S('PEP', 'PepsiCo, Inc.', 155, 0.15), S('NKE', 'NIKE, Inc.', 76, 0.33, 'NYSE'), S('JNJ', 'Johnson & Johnson', 152, 0.15, 'NYSE'),
  S('XOM', 'Exxon Mobil Corporation', 121, 0.24, 'NYSE'), S('BABA', 'Alibaba Group Holding', 86, 0.45, 'NYSE'), S('BRK.B', 'Berkshire Hathaway Inc.', 472, 0.16, 'NYSE'),
  I('SPX', 'S&P 500 Index', 6010, 0.16, 'SP'), I('NDX', 'Nasdaq 100 Index', 21100, 0.2, 'NASDAQ'), I('DJI', 'Dow Jones Industrial Average', 44200, 0.14, 'DJ'),
  I('RUT', 'Russell 2000 Index', 2420, 0.22, 'TVC'), I('VIX', 'CBOE Volatility Index', 15.5, 0.9, 'CBOE'), I('DAX', 'DAX Index', 19800, 0.17, 'XETR'),
  I('UKX', 'FTSE 100 Index', 8250, 0.14, 'FTSE'), I('NI225', 'Nikkei 225', 38600, 0.2, 'TVC'), I('HSI', 'Hang Seng Index', 19600, 0.25, 'HSI'),
  F('EURUSD', 'Euro / U.S. Dollar', 1.0520), F('GBPUSD', 'British Pound / U.S. Dollar', 1.2650), F('USDJPY', 'U.S. Dollar / Japanese Yen', 154.20, 0.1),
  F('USDCHF', 'U.S. Dollar / Swiss Franc', 0.8840), F('AUDUSD', 'Australian Dollar / U.S. Dollar', 0.6510, 0.1), F('USDCAD', 'U.S. Dollar / Canadian Dollar', 1.3980),
  F('NZDUSD', 'New Zealand Dollar / U.S. Dollar', 0.5850, 0.1), F('EURGBP', 'Euro / British Pound', 0.8320, 0.06), F('EURJPY', 'Euro / Japanese Yen', 161.50, 0.1),
  F('GBPJPY', 'British Pound / Japanese Yen', 194.80, 0.11), F('DXY', 'U.S. Dollar Index', 106.5, 0.07),
  M('XAUUSD', 'Gold Spot / U.S. Dollar', 2650, 0.15, 'OANDA'), M('XAGUSD', 'Silver Spot / U.S. Dollar', 31, 0.28, 'OANDA'),
  M('USOIL', 'Crude Oil WTI', 69.5, 0.35, 'NYMEX'), M('UKOIL', 'Brent Crude Oil', 73.2, 0.33, 'ICE'), M('NATGAS', 'Natural Gas', 3.3, 0.6, 'NYMEX'),
  M('COPPER', 'Copper Futures', 4.1, 0.25), M('ES1!', 'E-mini S&P 500 Futures', 6020, 0.16, 'CME'), M('NQ1!', 'E-mini Nasdaq 100 Futures', 21150, 0.2, 'CME'),
  B('US10Y', 'US 10 Year Treasury Yield', 4.32, 0.25), B('US02Y', 'US 2 Year Treasury Yield', 4.22, 0.25),
];

for (const s of SYMBOLS) s.id = `${s.exchange}:${s.symbol}`;

export const TYPES = [
  { id: 'all', label: 'All' }, { id: 'stock', label: 'Stocks' }, { id: 'crypto', label: 'Crypto' }, { id: 'forex', label: 'Forex' },
  { id: 'index', label: 'Indices' }, { id: 'futures', label: 'Futures' }, { id: 'bond', label: 'Bonds' },
];

export function findSymbol(q) {
  if (!q) return null;
  const u = q.toUpperCase();
  return SYMBOLS.find((s) => s.id === u) || SYMBOLS.find((s) => s.symbol === u) || SYMBOLS.find((s) => s.symbol === u + 'USDT') || null;
}

export function searchSymbols(q, type = 'all') {
  const u = (q || '').trim().toUpperCase();
  let list = SYMBOLS.filter((s) => type === 'all' || s.type === type);
  if (!u) return list;
  const scored = [];
  for (const s of list) {
    let sc = -1;
    if (s.symbol === u || s.base === u) sc = 0;
    else if (s.symbol.startsWith(u)) sc = 1;
    else if (s.symbol.includes(u)) sc = 2;
    else if (s.name.toUpperCase().includes(u)) sc = 3;
    else if (s.exchange.includes(u)) sc = 4;
    if (sc >= 0) scored.push([sc, s]);
  }
  return scored.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
}

export function symbolPrecision(s, price) {
  if (s.type === 'forex') return s.symbol.includes('JPY') || s.symbol === 'DXY' ? 3 : 5;
  if (s.type === 'bond') return 3;
  if (s.type === 'stock' || s.type === 'index' || s.type === 'futures') return price < 10 ? 3 : 2;
  const a = Math.abs(price);
  if (a >= 1000) return 2; if (a >= 10) return 3; if (a >= 1) return 4; if (a >= 0.01) return 5;
  if (a >= 0.0001) return 7; return 8;
}

export const SYMBOL_COLORS = { crypto: '#f7931a', stock: '#2962ff', index: '#089981', forex: '#9c27b0', futures: '#ff9800', bond: '#00bcd4' };

const COIN_ICONS = new Set(['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK', 'LTC', 'TRX', 'BCH', 'UNI', 'ATOM', 'FIL', 'XLM', 'AAVE', 'ETC']);
// Round symbol logo: real coin icon when available, otherwise a coloured letter badge.
export function symbolLogo(s, cls = '') {
  const badge = () => el('span', { class: 'sym-badge ' + cls, style: { background: SYMBOL_COLORS[s.type] } }, (s.base || s.symbol)[0]);
  if (s.type === 'crypto' && COIN_ICONS.has(s.base)) {
    const img = el('img', { class: 'sym-badge logo ' + cls, src: `img/coins/${s.base.toLowerCase()}.svg`, alt: '' });
    img.addEventListener('error', () => img.replaceWith(badge()));
    return img;
  }
  return badge();
}
export function quoteCurrency(s) { return s.type === 'crypto' ? 'USDT' : s.type === 'forex' ? s.symbol.slice(3) || 'USD' : s.type === 'bond' ? '%' : 'USD'; }
