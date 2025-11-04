import { CandleData } from "../types";
import { calculateAtr } from "./atr";
import { calculateEMA } from "./ema";
import { numberArrayToCandles } from "../utils/indicator-helpers";

export interface ZeroLagTrendSignalsOptions {
  length?: number;
  mult?: number;
}

export interface ZeroLagTrendSignalsResult {
  time: number;
  zlema: number;
  upperBand: number;
  lowerBand: number;
  trend: number;
  volatility: number;
  trendChange: boolean;
  shape: "trendChange" | "signal" | null;
}

function calculateZLEMA(data: CandleData[], length: number): number {
  const lag = Math.floor((length - 1) / 2);

  if (data.length < lag + 1) return data[data.length - 1]?.close || 0;

  const adjustedValues: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i >= lag) {
      const currentSrc = data[i].close;
      const laggedSrc = data[i - lag].close;
      adjustedValues.push(currentSrc + (currentSrc - laggedSrc));
    } else {
      adjustedValues.push(data[i].close);
    }
  }

  const ema = calculateEMA(numberArrayToCandles(adjustedValues), { 
    period: length,
    source: 'close',    
  });

  return ema[ema.length - 1]?.value || 0;
}

function detectCross(
  current: number,
  previous: number,
  threshold: number
): boolean {
  return previous <= threshold && current > threshold;
}

function detectCrossUnder(
  current: number,
  previous: number,
  threshold: number
): boolean {
  return previous >= threshold && current < threshold;
}

export function calculateZeroLagTrendSignals<T = ZeroLagTrendSignalsResult[]>(
  data: CandleData[],
  options: ZeroLagTrendSignalsOptions & {
    transform?: (input: ZeroLagTrendSignalsResult[]) => T;
  }
): T {
  const { length = 70, mult = 1.2 } = options;

  if (data.length < length) {
    return options.transform ? options.transform([]) : ([] as T);
  }

  const result: ZeroLagTrendSignalsResult[] = [];
  let previousTrend = 0;

  // Otimização: calcular ATR uma única vez para toda a série
  const atrResults = calculateAtr(data, { 
    period: length,
    transform: (input) => input.map(item => item.value)
  });

  for (let i = length; i < data.length; i++) {
    const windowData = data.slice(0, i + 1);
    const currentData = data[i];
    const previousData = data[i - 1];

    const zlema = calculateZLEMA(windowData, length);
    
    // Otimização: usar ATR pré-calculado em vez de recalcular volatilidade
    const lookbackPeriod = Math.min(length * 3, atrResults.length);
    const recentATR = atrResults.slice(Math.max(0, i - lookbackPeriod + 1), i + 1);
    const highestATR = Math.max(...recentATR);
    const volatility = highestATR * mult;
    
    const currentClose = currentData.close;
    const previousClose = previousData.close;

    let trend = previousTrend;

    if (detectCross(currentClose, previousClose, zlema + volatility)) {
      trend = 1;
    } else if (
      detectCrossUnder(currentClose, previousClose, zlema - volatility)
    ) {
      trend = -1;
    }

    const trendChange = trend !== previousTrend;

    const bullishEntry =
      detectCross(currentClose, previousClose, zlema) &&
      trend === 1 &&
      previousTrend === 1;
    const bearishEntry =
      detectCrossUnder(currentClose, previousClose, zlema) &&
      trend === -1 &&
      previousTrend === -1;

    let shape: "trendChange" | "signal" | null = null;
    if (trendChange) {
      shape = "trendChange";
    } else if (bullishEntry || bearishEntry) {
      shape = "signal";
    }

    previousTrend = trend;

    let upperBand: number;
    let lowerBand: number;

    if (trend === 1) {
      lowerBand = zlema - volatility;
      upperBand = zlema;
    } else if (trend === -1) {
      upperBand = zlema + volatility;
      lowerBand = zlema;
    } else {
      upperBand = zlema + volatility;
      lowerBand = zlema - volatility;
    }

    result.push({
      time: currentData.time,
      zlema,
      upperBand,
      lowerBand,
      trend,
      volatility,
      trendChange,
      shape,
    });
  }

  return options.transform ? options.transform(result) : (result as T);
}
