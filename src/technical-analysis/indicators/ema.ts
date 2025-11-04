import {
  CandleData,
  ICalculationOptions,
  PriceSource,
  getPriceValue,
} from "../types";

export type EmaOptions = {
  period: number;
  source?: PriceSource;
  transform?: (input: EmaResult[]) => unknown;
}

export type EmaResult = {
  value: number;
  time: number;
}

export function calculateEMA<T = EmaResult[]>(
  data: CandleData[],
  options: ICalculationOptions<EmaOptions, EmaResult[], T>
): T {
  const { period, source = "close", transform: transformFn } = options;
  const result: EmaResult[] = [];

  if (data.length < period) {
    return (transformFn ? transformFn(result) : result) as T;
  }

  // Calcular EMA
  const multiplier = 2 / (period + 1);
  let ema = 0;

  // Primeiro valor é SMA dos primeiros 'period' valores
  for (let i = 0; i < period; i++) {
    ema += getPriceValue(data[i], source);
  }
  ema = ema / period;

  // Adicionar o primeiro valor EMA
  result.push({
    value: ema,
    time: data[period - 1].time,
  });

  // Calcular EMA para os valores restantes
  for (let i = period; i < data.length; i++) {
    const currentPrice = getPriceValue(data[i], source);
    ema = (currentPrice * multiplier) + (ema * (1 - multiplier));

    result.push({
      value: ema,
      time: data[i].time,
    });
  }

  return (transformFn ? transformFn(result) : result) as T;
}
