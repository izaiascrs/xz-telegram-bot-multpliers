import {
  CandleData,
  ICalculationOptions
} from "../types";
import { calculateSMA } from "./sma";
import { numberArrayToCandles } from "../utils/indicator-helpers";
import { calculateEMA } from "./ema";

export type AtrSmoothing = "RMA" | "SMA" | "EMA" | "WMA" | "NONE";

export type AtrOptions = {
  period: number;
  smoothing?: AtrSmoothing;
  transform?: (input: AtrResult[]) => unknown;
}

export type AtrResult = {
  value: number;
  time: number;
}

function calculateRMA(data: number[], period: number): number[] {
  const result: number[] = [];
  
  if (data.length === 0) return result;
  
  const alpha = 1 / period;
  
  let rma = data[0];
  result.push(rma);
  
  for (let i = 1; i < data.length; i++) {
    rma = (data[i] * alpha) + (rma * (1 - alpha));
    result.push(rma);
  }
  
  return result;
}

function calculateWMA(data: number[], period: number): number[] {
  const result: number[] = [];
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    
    let sum = 0;
    let weightSum = 0;
    for (let j = 0; j < period; j++) {
      const weight = period - j;
      sum += data[i - j] * weight;
      weightSum += weight;
    }
    result.push(sum / weightSum);
  }
  
  return result;
}

export function calculateAtr<T = AtrResult[]>(
  data: CandleData[],
  options: ICalculationOptions<AtrOptions, AtrResult[], T>
): T {
  const { period, smoothing = "RMA", transform: transformFn } = options;
  const result: AtrResult[] = [];

  if (data.length < 2) {
    return (transformFn ? transformFn(result) : result) as T;
  }

  const trueRanges: number[] = [];
  
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      const tr = data[i].high - data[i].low;
      trueRanges.push(tr);
      continue;
    }
    
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;
    
    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    
    const tr = Math.max(tr1, tr2, tr3);
    trueRanges.push(tr);
  }

  let smoothedValues: number[];
  
  switch (smoothing) {
    case "RMA":
      smoothedValues = calculateRMA(trueRanges, period);
      break;
    case "SMA":
      smoothedValues = calculateSMA(numberArrayToCandles(trueRanges), {
        period: period,
        source: 'close',
        transform: (input) => input.map(item => item.value)
      });
      break;
    case "EMA":
      smoothedValues = calculateEMA(numberArrayToCandles(trueRanges), {
        period: period,
        source: 'close',
        transform: (input) => input.map(item => item.value)
      });
      break;
    case "WMA":
      smoothedValues = calculateWMA(trueRanges, period);
      break;
    case "NONE":
      smoothedValues = trueRanges;
      break;
    default:
      smoothedValues = calculateRMA(trueRanges, period);
  }

  for (let i = 0; i < data.length; i++) {
    const value = smoothedValues[i];
    if (!isNaN(value) && isFinite(value) && value >= 0) {
      result.push({
        value: value,
        time: data[i].time,
      });
    }
  }

  return (transformFn ? transformFn(result) : result) as T;
}
