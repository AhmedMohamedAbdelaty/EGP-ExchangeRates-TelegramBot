import { cheerio } from "../deps.cheerio.ts";
import { config } from "../app_config.ts";

const CACHE_DURATION = 10 * 60 * 1000;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 2_500;
const RETRY_DELAY_MS = 250;
const UNKNOWN_DATE = "غير معروف";

interface CacheEntry<T> {
    data: T;
    timestamp: number;
}
const cache = new Map<string, CacheEntry<unknown>>();

export function getCurrentEgyptTime(): string {
    return new Date().toLocaleString("en-US", {
        timeZone: config.TIMEZONE,
        hour: "2-digit", minute: "2-digit", hour12: true,
        day: "2-digit", month: "2-digit", year: "numeric",
    }).replace(",", " -");
}

function getCachedData<T>(key: string): T | null {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.timestamp < CACHE_DURATION) return entry.data as T;
    if (entry) cache.delete(key);
    return null;
}

function setCachedData<T>(key: string, data: T): void {
    cache.set(key, { data, timestamp: Date.now() });
}

function cleanPrice(price: string): string {
    return price.replace(/,/g, "").trim();
}

// Include response body consumption in the deadline, not only receipt of headers.
async function fetchText(url: string, headers?: HeadersInit): Promise<string> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(url, {
                headers,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.text();
        } catch (error) {
            if (attempt === MAX_RETRIES - 1) throw error;
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
        }
    }
    throw new Error("Provider request failed");
}

export interface CurrencyData { Buy: string; Sell: string; }
export interface AllCurrencyPrices {
    blackMarket: Record<string, CurrencyData>;
    bank: Record<string, CurrencyData>;
    lastUpdateBlackMarket: string;
    lastUpdateBank: string;
}
export interface GoldPriceEntry { price?: string; buy?: string; sell?: string; }
export interface GoldPrices { prices: Record<string, GoldPriceEntry>; lastUpdate: string; }
export interface FuelData { [key: string]: string; }
export interface FuelPrices { prices: FuelData; lastUpdate: string; }

interface ParsedForexFyData {
    bankPrices: Record<string, CurrencyData>;
    blackMarketPrices: Record<string, CurrencyData>;
    goldPrices: Record<string, GoldPriceEntry>;
    currencyDate: string;
    goldDate: string;
}

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as ObjectValue : undefined;
}
function positiveNumber(value: unknown): number | undefined {
    if (typeof value !== "string" && typeof value !== "number") return undefined;
    if (typeof value === "string" && !/^(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return undefined;
    const result = Number(value);
    return Number.isFinite(result) && result > 0 ? result : undefined;
}
function providerDate(value: unknown): string {
    const date = String(value ?? "");
    if (!/^\d{8}$/.test(date)) return UNKNOWN_DATE;
    const year = Number(date.slice(0, 4));
    const month = Number(date.slice(4, 6));
    const day = Number(date.slice(6, 8));
    const checked = new Date(Date.UTC(year, month - 1, day));
    return checked.getUTCFullYear() === year && checked.getUTCMonth() === month - 1 && checked.getUTCDate() === day
        ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : UNKNOWN_DATE;
}
function sourcePrices(value: unknown, expectedSource: string, unit = 1): CurrencyData | undefined {
    const source = object(value);
    if (!source || source.source !== expectedSource) return undefined;
    const buy = positiveNumber(source.buy);
    const sell = positiveNumber(source.sell);
    if (buy === undefined || sell === undefined) return undefined;
    const normalizedBuy = buy / unit;
    const normalizedSell = sell / unit;
    if (!Number.isFinite(normalizedBuy) || !Number.isFinite(normalizedSell) || normalizedBuy <= 0 || normalizedSell <= 0) return undefined;
    return { Buy: String(normalizedBuy), Sell: String(normalizedSell) };
}

const GOLD_CODES: Record<string, string> = {
    "24k": "24k", "21k": "21k", "18k": "18k", "22k": "22k",
    xau: "Gold Ounce", coin: "Gold Pound(Coin)", "14k": "14k", "12k": "12k", "9k": "9k",
};

function parseForexFyHtml(html: string): ParsedForexFyData {
    const pageJson = cheerio(html)("div#app[data-page]").attr("data-page");
    if (!pageJson) throw new Error("ForexFy page data missing");
    let parsed: unknown;
    try { parsed = JSON.parse(pageJson); } catch { throw new Error("Invalid ForexFy page data"); }
    const page = object(parsed);
    const context = object(page?.context);
    if (object(context?.country)?.code !== "EG" || object(context?.currency)?.code !== "EGP") {
        throw new Error("Unexpected ForexFy country or quote currency");
    }
    const data = object(page?.data);
    if (!data || !Array.isArray(data.currencies) || !Array.isArray(data.calculatorMetals)) {
        throw new Error("ForexFy price collections missing");
    }
    const bankPrices: Record<string, CurrencyData> = {};
    const blackMarketPrices: Record<string, CurrencyData> = {};
    for (const item of data.currencies) {
        const currency = object(item);
        if (!currency || typeof currency.code !== "string" || !config.CURRENCIES.includes(currency.code)) continue;
        const unit = positiveNumber(currency.unit);
        if (currency.quote !== "EGP" || unit === undefined) continue;
        const sources = object(currency.sources);
        const bank = sourcePrices(sources?.bank, "bank", unit);
        const market = sourcePrices(sources?.market, "market", unit);
        if (bank) bankPrices[currency.code] = bank;
        if (market) blackMarketPrices[currency.code] = market;
    }
    const goldPrices: Record<string, GoldPriceEntry> = {};
    for (const metalItem of data.calculatorMetals) {
        const metal = object(metalItem);
        if (metal?.code !== "gold" || !Array.isArray(metal.units)) continue;
        for (const unitItem of metal.units) {
            const unit = object(unitItem);
            if (!unit || typeof unit.code !== "string" || unit.currency !== "EGP") continue;
            const key = GOLD_CODES[unit.code];
            if (!key) continue;
            const local = sourcePrices(object(unit.sources)?.local, "local");
            if (local) goldPrices[key] = { buy: local.Buy, sell: local.Sell };
        }
    }
    return { bankPrices, blackMarketPrices, goldPrices,
        currencyDate: providerDate(data.currencyDayId), goldDate: providerDate(data.metalDayId) };
}

async function getParsedDataWithCache(): Promise<ParsedForexFyData> {
    const cacheKey = "forexfy";
    const cached = getCachedData<ParsedForexFyData>(cacheKey);
    if (cached) return cached;
    const html = await fetchText(config.API_URLS.FOREXFY_EG, {
        "User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.5",
    });
    const data = parseForexFyHtml(html);
    // A partial response remains usable, but is retried on the next request.
    if (config.CURRENCIES.every((code) => data.bankPrices[code] && data.blackMarketPrices[code]) &&
        Object.values(GOLD_CODES).every((code) => data.goldPrices[code])) setCachedData(cacheKey, data);
    return data;
}

export async function getCurrencyPrices(): Promise<AllCurrencyPrices> {
    const data = await getParsedDataWithCache();
    if (!Object.keys(data.bankPrices).length && !Object.keys(data.blackMarketPrices).length) {
        throw new Error("No valid ForexFy currency prices");
    }
    return { bank: data.bankPrices, blackMarket: data.blackMarketPrices,
        lastUpdateBank: data.currencyDate, lastUpdateBlackMarket: data.currencyDate };
}

export async function getGoldPrices(): Promise<GoldPrices> {
    const data = await getParsedDataWithCache();
    if (!Object.keys(data.goldPrices).length) throw new Error("No valid ForexFy gold prices");
    return { prices: data.goldPrices, lastUpdate: data.goldDate };
}

export async function getFuelPrices(): Promise<FuelPrices> {
    const cacheKey = "fuel";
    const cached = getCachedData<FuelPrices>(cacheKey);
    if (cached) return cached;
    const html = await fetchText(config.API_URLS.SARF_TODAY_CURRENCY_EXCHANGE);
    const $ = cheerio(html);
    const prices: FuelData = {};
    $("table.table.fuel-home-block tbody tr").each((_i, el) => {
        const row = $(el);
        const name = row.find("th span a").text().trim();
        const priceElement = row.find("td strong");
        const price = positiveNumber(cleanPrice(priceElement.text()));
        const unit = priceElement.parent().text().replace(priceElement.text(), "").trim();
        if (config.FUEL_TYPES.includes(name) && price !== undefined && unit === "EGP") {
            prices[name] = `${price} EGP`;
        }
    });
    if (!Object.keys(prices).length) throw new Error("No valid Sarf Today fuel prices");
    const result = { prices, lastUpdate: UNKNOWN_DATE };
    if (config.FUEL_TYPES.every((name) => prices[name])) setCachedData(cacheKey, result);
    return result;
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
