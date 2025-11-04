import {
  CandleData,
  ICalculationOptions,
  SmaOptions,
  SmaResult,
  getPriceValue,
} from "../types";

export function calculateSMA<T = SmaResult[]>(
  data: CandleData[],
  options: ICalculationOptions<SmaOptions, SmaResult[], T>
): T {
  const { period, source, transform: transformFn } = options;
  const result: SmaResult[] = [];

  if (data.length < period) {
    return (transformFn ? transformFn(result) : result) as T;
  }

  for (let i = period - 1; i < data.length; i++) {
    const window = data.slice((i - period) + 1, i + 1);
    const sum = window.reduce(
      (acc, candle) => acc + getPriceValue(candle, source),
      0
    );
    const sma = sum / period;

    const smaResult: SmaResult = {
      value: sma,
      time: data[i].time,
    };

    result.push(smaResult);
  }

  return (transformFn ? transformFn(result) : result) as T;
}
