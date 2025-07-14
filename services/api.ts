import { cheerio } from "../deps.cheerio.ts";
import { config } from "../config.ts";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const CACHE_DURATION = 10 * 60 * 1000;

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

const cache = new Map<string, CacheEntry<any>>();

export function getCurrentEgyptTime(): string {
    const now = new Date();
    return now.toLocaleString("en-US", {
        timeZone: config.TIMEZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    }).replace(",", " -");
}

function getCachedData<T>(key: string): T | null {
    const entry = cache.get(key);
    if (entry && (Date.now() - entry.timestamp < CACHE_DURATION)) {
        return entry.data as T;
    }
    if (entry) {
        cache.delete(key);
    }
    return null;
}

function setCachedData<T>(key: string, data: T): void {
    cache.set(key, { data, timestamp: Date.now() });
}

function cleanPrice(price: string): string {
    return price.replace(/,/g, "").trim();
}

const FOREXFY_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:139.0) Gecko/20100101 Firefox/139.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Sec-GPC": "1",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "DNT": "1",
    "Cookie": "language=f7232ce47f4ce53a4680d1dc0963d6322194d5da30a6080471d672a17a12fb37a%3A2%3A%7Bi%3A0%3Bs%3A8%3A%22language%22%3Bi%3A1%3Bs%3A2%3A%22en%22%3B%7D; country=c58ccfeba19e434161aac4e3e7df42eb820a9ed0d0470b866e7a94e73c46e923a%3A2%3A%7Bi%3A0%3Bs%3A7%3A%22country%22%3Bi%3A1%3Bs%3A2%3A%22US%22%3B%7D; _csrf-forexfy=7a8cd136abed4e9b070e75adeee8b6c5eaddd9030ad87f597d2e72aa9b94f83ea%3A2%3A%7Bi%3A0%3Bs%3A13%3A%22_csrf-forexfy%22%3Bi%3A1%3Bs%3A32%3A%22ulvD71IJhCZ-P85hB2TCjeHYsj2CPdFg%22%3B%7D"
};

async function fetchWithRetries(url: string, options?: RequestInit, retries = MAX_RETRIES): Promise<Response> {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status} for ${url}`);
            }
            return response;
        } catch (error) {
            console.error(`Attempt ${i + 1}/${retries} failed for ${url}:`, error.message);
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (i + 1)));
        }
    }
    throw new Error(`Failed to fetch ${url} after ${retries} retries.`);
}


async function fetchForexFyPage(): Promise<string> {
    console.log(`Fetching data from: ${config.API_URLS.FOREXFY_EG}`);
    const response = await fetchWithRetries(config.API_URLS.FOREXFY_EG, {
        method: "GET",
        headers: FOREXFY_HEADERS,
    });
    return await response.text();
}

export interface CurrencyData {
    Buy: string;
    Sell: string;
}

export interface AllCurrencyPrices {
    blackMarket: Record<string, CurrencyData>;
    bank: Record<string, CurrencyData>;
    lastUpdateBlackMarket: string;
    lastUpdateBank: string;
}

export interface GoldPriceEntry {
    price?: string;
    buy?: string;
    sell?: string;
}

export interface GoldPrices {
    prices: Record<string, GoldPriceEntry>;
    lastUpdate: string;
}

interface ParsedForexFyData {
    bankPrices: Record<string, CurrencyData>;
    blackMarketPrices: Record<string, CurrencyData>;
    goldPrices: Record<string, GoldPriceEntry>;
}

function parseForexFyHtml(html: string): ParsedForexFyData {
    const $ = cheerio(html);
    const bankPrices: Record<string, CurrencyData> = {};
    const blackMarketPrices: Record<string, CurrencyData> = {};
    const goldPrices: Record<string, GoldPriceEntry> = {};

    // --- Parse Bank Currency Prices ---
    const bankRatesAnchor = $('h2 a[href="/en/currency/EGP/bank"]');
    if (bankRatesAnchor.length) {
        const tableContainer = bankRatesAnchor.closest('h2').next('div');
        const bankRatesTable = tableContainer.find('div.table-responsive table');
        bankRatesTable.find('tbody tr').each((_i, el) => {
            const row = $(el);
            const nameCell = row.find('td.name a');
            let currencyText = nameCell.text().trim();
            const currencyCodeMatch = currencyText.match(/\(([A-Z]{3})\)/);

            if (currencyCodeMatch) {
                let currencyCode = currencyCodeMatch[1];
                // Only process if it's in our desired CURRENCIES
                if (config.CURRENCIES.includes(currencyCode)) {
                    let buyPrice = cleanPrice(row.find('td:nth-child(2)').text());
                    let sellPrice = cleanPrice(row.find('td:nth-child(3)').text());
                    if (currencyText.includes("100 ")) {
                        buyPrice = (parseFloat(buyPrice) / 100).toFixed(4);
                        sellPrice = (parseFloat(sellPrice) / 100).toFixed(4);
                    }
                    bankPrices[currencyCode] = { Buy: buyPrice, Sell: sellPrice };
                }
            }
        });
    } else {
        console.warn("Could not find Bank Currency Prices table anchor on ForexFy.");
    }

    // --- Parse Black Market Currency Prices ---
    const blackMarketRatesAnchor = $('h2 a[href="/en/currency/EGP/blackMarket"]');
    if (blackMarketRatesAnchor.length) {
        const tableContainer = blackMarketRatesAnchor.closest('h2').next('div');
        const blackMarketRatesTable = tableContainer.find('div.table-responsive table');
        blackMarketRatesTable.find('tbody tr').each((_i, el) => {
            const row = $(el);
            const nameCell = row.find('td.name a');
            let currencyText = nameCell.text().trim();
            const currencyCodeMatch = currencyText.match(/\(([A-Z]{3})\)/);

            if (currencyCodeMatch) {
                let currencyCode = currencyCodeMatch[1];
                // Only process if it's in our desired CURRENCIES
                if (config.CURRENCIES.includes(currencyCode)) {
                    let buyPrice = cleanPrice(row.find('td:nth-child(2)').text());
                    let sellPrice = cleanPrice(row.find('td:nth-child(3)').text());
                    if (currencyText.includes("100 ")) {
                        buyPrice = (parseFloat(buyPrice) / 100).toFixed(4);
                        sellPrice = (parseFloat(sellPrice) / 100).toFixed(4);
                    }
                    blackMarketPrices[currencyCode] = { Buy: buyPrice, Sell: sellPrice };
                }
            }
        });
    } else {
        console.warn("Could not find Black Market Currency Prices table anchor on ForexFy.");
    }

    console.log("Attempting to parse Gold prices...");
    const goldPricesAnchorForexFy = $('h2 a[href="/en/gold/EGP/stores"]');
    if (goldPricesAnchorForexFy.length) {
        console.log("Gold prices anchor found.");
        const h2ParentDiv = $('h2:has(a[href="/en/gold/EGP/stores"])').parent();
        let goldPricesTable = h2ParentDiv.find('div.table-responsive table');

        if (!goldPricesTable.length) {
            goldPricesTable = $('h2:contains("Gold prices at Goldsmiths in Pound")').next('div.wow').find('table.table');
        }

        if (goldPricesTable.length) {
            console.log("Gold prices table found, processing rows...");
            goldPricesTable.find('tbody tr').each((i, el) => {
                const row = $(el);
                const karatNameElement = row.find('td:first-child a span.fw-medium');
                const karatName = karatNameElement.text().trim();
                const buyPrice = cleanPrice(row.find('td:nth-child(2)').text());
                const sellPrice = cleanPrice(row.find('td:nth-child(3)').text());

                console.log(`Gold Row ${i}: Raw Karat='${karatName}', Buy='${buyPrice}', Sell='${sellPrice}'`);

                let mappedKey: string | undefined = undefined;
                for (const key in config.GOLD_TYPES) {
                    if (config.GOLD_TYPES[key as keyof typeof config.GOLD_TYPES].toLowerCase() === karatName.toLowerCase()) {
                        mappedKey = key;
                        break;
                    }
                }
                if (!mappedKey && karatName.toLowerCase() === "gold coin" && config.GOLD_TYPES["Gold Pound(Coin)"].toLowerCase() === "gold coin") {
                    mappedKey = "Gold Pound(Coin)";
                }

                if (mappedKey) {
                    goldPrices[mappedKey] = { buy: buyPrice, sell: sellPrice };
                    console.log(`   Mapped to Key='${mappedKey}', Stored: {buy: ${buyPrice}, sell: ${sellPrice}}`);
                } else {
                    console.warn(`   ForexFy Gold: Unmapped karat name '${karatName}'`);
                }
            });
            if (Object.keys(goldPrices).length === 0) {
                console.warn("Gold parsing loop completed, but no gold prices were mapped.");
            } else {
                console.log("ForexFy Gold prices parsed:", JSON.stringify(goldPrices));
            }
        } else {
            console.warn("Could not find Gold Prices table element on ForexFy.");
        }
    } else {
        console.warn("Could not find Gold Prices table anchor on ForexFy.");
    }


    return { bankPrices, blackMarketPrices, goldPrices };
}

async function getParsedDataWithCache(): Promise<ParsedForexFyData> {
    const cacheKey = "forexFy_parsedData_eg";
    const cached = getCachedData<ParsedForexFyData>(cacheKey);
    if (cached) {
        console.log("Returning cached parsed ForexFy data.");
        return cached;
    }

    console.log("Fetching and parsing ForexFy data.");
    const html = await fetchForexFyPage();
    const parsedData = parseForexFyHtml(html);
    setCachedData(cacheKey, parsedData);
    return parsedData;
}

export async function getCurrencyPrices(): Promise<AllCurrencyPrices> {
    try {
        const parsedData = await getParsedDataWithCache();
        const currentTime = getCurrentEgyptTime();

        if (Object.keys(parsedData.bankPrices).length === 0 && Object.keys(parsedData.blackMarketPrices).length === 0) {
            console.error("ForexFy: No currency data could be parsed from the page.");
        }

        return {
            bank: parsedData.bankPrices,
            blackMarket: parsedData.blackMarketPrices,
            lastUpdateBank: currentTime,
            lastUpdateBlackMarket: currentTime,
        };
    } catch (error) {
        console.error("Error fetching or parsing currency prices from ForexFy:", error);
        throw new Error("Unable to fetch currency prices from ForexFy.app. " + error.message);
    }
}

export async function getGoldPrices(): Promise<GoldPrices> {
    try {
        const parsedData = await getParsedDataWithCache();
        const currentTime = getCurrentEgyptTime();
        if (Object.keys(parsedData.goldPrices).length === 0) {
            console.error("ForexFy: No gold data could be parsed from the page.");
        }
        return {
            prices: parsedData.goldPrices,
            lastUpdate: currentTime,
        };
    } catch (error) {
        console.error("Error fetching or parsing gold prices from ForexFy:", error);
        throw new Error("Unable to fetch gold prices from ForexFy.app. " + error.message);
    }
}

// --- Fuel Prices ---
export interface FuelData {
    [key: string]: string;
}
export interface FuelPrices {
    prices: FuelData;
    lastUpdate: string;
}

async function scrapeSarfTodayWebsite<T>(url: string, cacheKey: string, parser: ($: any) => T): Promise<T> {
    const cached = getCachedData<T>(cacheKey);
    if (cached) {
        console.log(`Returning cached data for key: ${cacheKey} (SarfToday)`);
        return cached;
    }
    console.log(`Fetching and parsing data for key: ${cacheKey} from URL: ${url} (SarfToday)`);
    const response = await fetchWithRetries(url);
    const body = await response.text();
    const $ = cheerio(body);
    const result = parser($);

    setCachedData(cacheKey, result);
    return result;
}

function parseSarfTodayFuelPrices($: any): FuelPrices {
    const prices: FuelData = {};
    let lastUpdate = getCurrentEgyptTime();

    const currencyTimestampElement = $("table.table.local-cur thead th:first-child");
    if (currencyTimestampElement.length) {
        const tsText = currencyTimestampElement.text().trim();
        if (tsText) lastUpdate = tsText;
    } else {
        const genericTimestamp = $("span.date-time, .last-updated, .update-time, p.text-muted.mini-text > span").first().text().trim();
        if (genericTimestamp) lastUpdate = genericTimestamp;
    }

    $("table.table.fuel-home-block tbody tr").each((_i: number, el: any) => {
        const row = $(el);
        const fuelTypeElement = row.find("th span a");
        const fuelType = fuelTypeElement.text().trim();
        const priceElement = row.find("td strong");
        const priceValue = cleanPrice(priceElement.text().trim());
        const currencyUnit = (priceElement.get(0)?.nextSibling?.nodeValue?.trim() || "EGP").replace(/[\/\s-Litre]/gi, '').trim();


        if (fuelType && priceValue) {
            const fullPrice = `${priceValue} ${currencyUnit || 'EGP'}`;
            prices[fuelType] = fullPrice;
        }
    });

    if (Object.keys(prices).length === 0) {
        console.warn("Sarf-Today Fuel: Could not find any fuel prices.");
    }
    return { prices, lastUpdate };
}

export async function getFuelPrices(): Promise<FuelPrices> {
    const cacheKey = "sarfToday_fuelPrices_v2";
    try {
        console.log("Attempting to fetch fuel prices from sarf-today.com");
        const result = await scrapeSarfTodayWebsite(config.API_URLS.SARF_TODAY_CURRENCY_EXCHANGE, cacheKey, parseSarfTodayFuelPrices);

        if (Object.keys(result.prices).length === 0) {
            console.warn("Sarf-Today Fuel: No fuel data found/parsed. Returning N/A structure.");
            result.lastUpdate = result.lastUpdate || getCurrentEgyptTime();
        } else {
            console.log("Successfully fetched fuel prices from sarf-today.com");
        }
        return result;
    } catch (error) {
        console.error("Error fetching fuel prices from sarf-today.com:", error);
        return {
            prices: {},
            lastUpdate: getCurrentEgyptTime(),
        };
    }
}


export async function convertCurrency(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
): Promise<{ convertedAmount: number; rate: number; from: string; to: string }> {
    const prices = await getCurrencyPrices();

    // Prefer black market prices for conversion if available
    const sourceToUse = Object.keys(prices.blackMarket).length > 0 ? prices.blackMarket : prices.bank;

    let rate: number | undefined;
    const actualFromCurrency = fromCurrency.toUpperCase();
    const actualToCurrency = toCurrency.toUpperCase();

    if (actualFromCurrency === "EGP" && sourceToUse[actualToCurrency]) {
        const sellPrice = parseFloat(cleanPrice(sourceToUse[actualToCurrency]?.Sell));
        if (!isNaN(sellPrice) && sellPrice > 0) {
            rate = 1 / sellPrice;
        }
    } else if (actualToCurrency === "EGP" && sourceToUse[actualFromCurrency]) {
        const buyPrice = parseFloat(cleanPrice(sourceToUse[actualFromCurrency]?.Buy));
        if (!isNaN(buyPrice)) {
            rate = buyPrice;
        }
    } else if (sourceToUse[actualFromCurrency] && sourceToUse[actualToCurrency]) {
        // Cross-currency conversion via EGP
        const fromToEgpRate = parseFloat(cleanPrice(sourceToUse[actualFromCurrency]?.Buy));
        const egpToToRate = parseFloat(cleanPrice(sourceToUse[actualToCurrency]?.Sell));
        if (!isNaN(fromToEgpRate) && !isNaN(egpToToRate) && egpToToRate > 0) {
            rate = fromToEgpRate / egpToToRate;
        }
    }

    if (rate === undefined) {
        throw new Error(
            `لا يمكن التحويل من ${actualFromCurrency} إلى ${actualToCurrency} باستخدام أسعار ${Object.keys(prices.blackMarket).length > 0 ? 'السوق السوداء' : 'البنك'} المتاحة.`,
        );
    }

    const convertedAmount = amount * rate;
    return {
        convertedAmount: parseFloat(convertedAmount.toFixed(2)),
        rate: parseFloat(rate.toFixed(4)),
        from: actualFromCurrency,
        to: actualToCurrency,
    };
}
