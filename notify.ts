import 'cross-fetch/polyfill';
import * as https from 'https';
import * as dotenv from 'dotenv';
import yahooFinance from 'yahoo-finance2';
import { messagingApi } from '@line/bot-sdk';

// 載入 .env 環境變數（本地測試用）
dotenv.config();

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_USER_ID = process.env.LINE_USER_ID;

/**
 * 股票行情數據結構
 */
interface StockQuoteData {
  price: number;
  prevClose: number;
  change: number;
  changePercent: number;
  high?: number;
  low?: number;
  volume?: number;
}

/**
 * 格式化時間為台灣時間字串 (UTC+8)
 */
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

/**
 * 原生備援方案：當 Yahoo Finance Crumb 遭遇 429 頻率限制時，直接透過官方 Chart API 取得報價
 */
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
              return reject(new Error(`Yahoo Finance API 未返回有效數據: ${rawData.substring(0, 100)}`));
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

/**
 * 取得股票報價（優先使用 yahoo-finance2，失敗時自動平滑切換備援）
 */
async function getStockQuote(symbol: string): Promise<StockQuoteData> {
  try {
    // 抑制問卷等額外終端通知
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
      };
    }
  } catch (err: any) {
    console.warn(`yahoo-finance2.quote 呼叫未果 (${err.message})，自動啟用直接請求備援線路...`);
  }

  // 備援線路
  return await fetchYahooChartDirect(symbol);
}

/**
 * 主執行函式
 */
async function main() {
  console.log('開始執行股票行情通知腳本...');

  // 1. 檢查必要環境變數
  if (!LINE_CHANNEL_ACCESS_TOKEN || !LINE_USER_ID) {
    console.error('錯誤：缺少必要的環境變數！');
    console.error('請確保設定了 LINE_CHANNEL_ACCESS_TOKEN 與 LINE_USER_ID。');
    process.exit(1);
  }

  try {
    // 2. 抓取股票即時報價
    const symbol = process.env.STOCK_SYMBOL || '0050.TW';
    console.log('正在獲取最新盤況資料...');
    const quote = await getStockQuote(symbol);

    const price = quote.price;
    const prevClose = quote.prevClose;
    const change = quote.change;
    const changePercent = quote.changePercent;
    const high = quote.high;
    const low = quote.low;
    const volume = quote.volume;

    // 格式化漲跌指標
    const changeSign = change > 0 ? '+' : '';
    const changePercentSign = changePercent > 0 ? '+' : '';
    const changeFormatted = `${changeSign}${change.toFixed(2)} (${changePercentSign}${changePercent.toFixed(2)}%)`;
    const currentTime = getTaiwanTimeString();

    // 組織標題與摘要文字
    const stockName = (process.env.STOCK_NAME || '').trim();
    const title = stockName ? `${stockName}股票盤況通知` : '股票盤況通知';
    const highStr = high !== undefined ? `${high.toFixed(2)} 元` : '無資料';
    const lowStr = low !== undefined ? `${low.toFixed(2)} 元` : '無資料';
    const volumeStr = volume !== undefined ? `${Math.floor(volume / 1000).toLocaleString()} 張` : '無資料';

    const summaryText = [
      title,
      `回報時間：${currentTime}`,
      ``,
      `最新股價：${price.toFixed(2)} 元`,
      `今日漲跌：${changeFormatted}`,
      `昨日收盤：${prevClose.toFixed(2)} 元`,
      `今日最高：${highStr}`,
      `今日最低：${lowStr}`,
      `成交張數：${volumeStr}`,
    ].join('\n');

    console.log('即將發送的推播內容：\n' + summaryText);

    // 依漲跌決定卡片主題色（台股習慣：紅漲 #D32F2F、綠跌 #2E7D32、平盤 #546E7A）
    let themeColor = '#546E7A';
    if (change > 0) {
      themeColor = '#D32F2F';
    } else if (change < 0) {
      themeColor = '#2E7D32';
    }

    // 組合 Google 財經與 Yahoo 股市連結
    const stockCode = symbol.replace(/\.TW$/i, '');
    const googleFinanceUrl = `https://www.google.com/finance/quote/${stockCode}:TPE`;
    const yahooStockUrl = `https://tw.stock.yahoo.com/quote/${symbol}`;

    // 建立 LINE Flex Message 卡片
    const flexMessage: messagingApi.FlexMessage = {
      type: 'flex',
      altText: `${title} 最新股價：${price.toFixed(2)} 元 (${changeFormatted})`,
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
              text: title,
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

    // 3. 使用 LINE Messaging API 發送推播訊息 (Push Message)
    console.log('正在透過 LINE Messaging API 發送訊息...');
    const client = new messagingApi.MessagingApiClient({
      channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
    });

    await client.pushMessage({
      to: LINE_USER_ID,
      messages: [flexMessage],
    });

    console.log('LINE 推播訊息已成功發送！');
  } catch (error: any) {
    console.error('執行過程發生錯誤：', error?.message || error);
    if (error?.response?.data) {
      console.error('LINE API 回應詳情：', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

main();
