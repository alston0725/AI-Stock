import 'cross-fetch/polyfill';
import * as https from 'https';
import yahooFinance from 'yahoo-finance2';
import { messagingApi } from '@line/bot-sdk';

interface StockQuoteData {
  price: number;
  prevClose: number;
  change: number;
  changePercent: number;
  high?: number;
  low?: number;
  volume?: number;
  shortName?: string;
}

function getTaiwanTimeString(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${m.year}/${m.month}/${m.day} ${m.hour}:${m.minute}:${m.second}`;
}

function fetchYahooChartDirect(symbol: string): Promise<StockQuoteData> {
  return new Promise((resolve, reject) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`;
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(rawData);
            const result = json?.chart?.result?.[0];
            if (!result || !result.meta) {
              return reject(new Error(`Yahoo Finance API 未返回有效數據`));
            }
            const meta = result.meta;
            const price = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose ?? price;
            const change = price - prevClose;
            const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;

            resolve({
              price,
              prevClose,
              change,
              changePercent,
              high: meta.regularMarketDayHigh,
              low: meta.regularMarketDayLow,
              volume: meta.regularMarketVolume,
              shortName: meta.shortName || meta.symbol,
            });
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('抓取 Yahoo Finance 逾時'));
    });
  });
}

async function getStockQuote(symbol: string): Promise<StockQuoteData> {
  try {
    yahooFinance.suppressNotices(['yahooSurvey']);
    const quote = await yahooFinance.quote(symbol);

    if (quote && quote.regularMarketPrice !== undefined) {
      const price = quote.regularMarketPrice;
      const prevClose = quote.regularMarketPreviousClose ?? price;
      const change = quote.regularMarketChange ?? (price - prevClose);
      const changePercent =
        quote.regularMarketChangePercent ??
        (prevClose !== 0 ? (change / prevClose) * 100 : 0);

      return {
        price,
        prevClose,
        change,
        changePercent,
        high: quote.regularMarketDayHigh,
        low: quote.regularMarketDayLow,
        volume: quote.regularMarketVolume,
        shortName: quote.shortName || symbol,
      };
    }
  } catch (err: any) {
    console.warn(`yahoo-finance2.quote 呼叫未果 (${err.message})，自動啟用備援線路...`);
  }

  return await fetchYahooChartDirect(symbol);
}

function buildStockFlexMessage(symbol: string, displayTitle: string, quote: StockQuoteData): messagingApi.FlexMessage {
  const { price, prevClose, change, changePercent, high, low, volume } = quote;

  const changeSign = change > 0 ? '+' : '';
  const changePercentSign = changePercent > 0 ? '+' : '';
  const changeFormatted = `${changeSign}${change.toFixed(2)} (${changePercentSign}${changePercent.toFixed(2)}%)`;
  const currentTime = getTaiwanTimeString();

  const highStr = high !== undefined ? `${high.toFixed(2)} 元` : '無資料';
  const lowStr = low !== undefined ? `${low.toFixed(2)} 元` : '無資料';
  const volumeStr = volume !== undefined ? `${Math.floor(volume / 1000).toLocaleString()} 張` : '無資料';

  let themeColor = '#808080';
  if (change > 0) {
    themeColor = '#D32F2F';
  } else if (change < 0) {
    themeColor = '#2E7D32';
  }

  const stockCode = symbol.replace(/\.TW$/i, '');
  const googleFinanceUrl = `https://www.google.com/finance/quote/${stockCode}:TPE?hl=zh-TW`;
  const yahooStockUrl = `https://tw.stock.yahoo.com/quote/${symbol}`;

  return {
    type: 'flex',
    altText: `${displayTitle} 最新股價：${price.toFixed(2)} 元 (${changeFormatted})`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: themeColor,
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: displayTitle,
            color: '#FFFFFF',
            weight: 'bold',
            size: 'lg',
          },
          {
            type: 'text',
            text: `回報時間：${currentTime}`,
            color: '#F0F0F0',
            size: 'xs',
            margin: 'xs',
          },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        contents: [
          {
            type: 'box',
            layout: 'baseline',
            contents: [
              {
                type: 'text',
                text: `${price.toFixed(2)}`,
                size: 'xxl',
                weight: 'bold',
                color: themeColor,
                flex: 0,
              },
              {
                type: 'text',
                text: ' 元',
                size: 'sm',
                color: themeColor,
                weight: 'bold',
                flex: 0,
              },
              {
                type: 'text',
                text: changeFormatted,
                size: 'md',
                weight: 'bold',
                color: themeColor,
                align: 'end',
              },
            ],
          },
          {
            type: 'separator',
            margin: 'md',
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  { type: 'text', text: '昨日收盤', size: 'sm', color: '#666666' },
                  { type: 'text', text: `${prevClose.toFixed(2)} 元`, size: 'sm', color: '#111111', weight: 'bold', align: 'end' },
                ],
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  { type: 'text', text: '今日最高', size: 'sm', color: '#666666' },
                  { type: 'text', text: highStr, size: 'sm', color: '#111111', weight: 'bold', align: 'end' },
                ],
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  { type: 'text', text: '今日最低', size: 'sm', color: '#666666' },
                  { type: 'text', text: lowStr, size: 'sm', color: '#111111', weight: 'bold', align: 'end' },
                ],
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  { type: 'text', text: '成交張數', size: 'sm', color: '#666666' },
                  { type: 'text', text: volumeStr, size: 'sm', color: '#111111', weight: 'bold', align: 'end' },
                ],
              },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '12px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: themeColor,
            height: 'sm',
            action: {
              type: 'uri',
              label: '查看 Google 走勢圖',
              uri: googleFinanceUrl,
            },
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: {
              type: 'uri',
              label: '查看 Yahoo 詳細盤況',
              uri: yahooStockUrl,
            },
          },
        ],
      },
    },
  };
}

/**
 * Vercel Serverless Webhook 處理函式：接收 LINE 訊息並即時回覆股票卡片
 */
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(200).send('LINE Stock Webhook is running.');
  }

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.error('錯誤：缺少 LINE_CHANNEL_ACCESS_TOKEN 環境變數');
    return res.status(500).json({ error: 'Missing LINE_CHANNEL_ACCESS_TOKEN' });
  }

  const events = req.body?.events || [];
  if (events.length === 0) {
    // LINE Developers 後台點擊 Verify 時會發送空 events，直接回傳 200
    return res.status(200).json({ status: 'ok' });
  }

  const client = new messagingApi.MessagingApiClient({
    channelAccessToken: token,
  });

  for (const event of events) {
    if (event.type === 'message' && event.message?.type === 'text') {
      const userText = (event.message.text || '').trim();
      const replyToken = event.replyToken;

      const defaultSymbol = process.env.STOCK_SYMBOL || '0050.TW';
      const defaultStockName = (process.env.STOCK_NAME || '').trim();

      let targetSymbol = '';
      let displayTitle = '';

      if (userText === '查詢盤況' || userText === '查詢當前盤況' || userText === '盤況') {
        targetSymbol = defaultSymbol;
        displayTitle = defaultStockName ? `${defaultStockName}股票盤況通知` : '股票盤況通知';
      } else if (/^\d{4,6}[A-Za-z]?$/.test(userText)) {
        // 若使用者直接輸入台股代號（例如 0050、2330、00878），也可直接查詢該檔股票
        targetSymbol = `${userText.toUpperCase()}.TW`;
        displayTitle = `${userText.toUpperCase()} 股票盤況通知`;
      }

      if (targetSymbol && replyToken) {
        try {
          const quote = await getStockQuote(targetSymbol);
          const flexMsg = buildStockFlexMessage(targetSymbol, displayTitle, quote);
          await client.replyMessage({
            replyToken,
            messages: [flexMsg],
          });
        } catch (err: any) {
          console.error('回覆股票盤況失敗：', err?.message || err);
          await client.replyMessage({
            replyToken,
            messages: [
              {
                type: 'text',
                text: `查詢失敗，請確認股票代號是否正確或稍後再試。`,
              },
            ],
          });
        }
      }
    }
  }

  return res.status(200).json({ status: 'ok' });
}
