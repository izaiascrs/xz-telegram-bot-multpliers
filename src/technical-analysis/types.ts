
export const DEFAULT_PRICE_SOURCE: PriceSource = 'close';

export const getPriceValue = (candle: CandleData, source: PriceSource = DEFAULT_PRICE_SOURCE): number => {
  switch (source) {
    case 'close': return candle.close;
    case 'open': return candle.open;
    case 'high': return candle.high;
    case 'low': return candle.low;
    case 'hl2': return (candle.high + candle.low) / 2;
    case 'hlc3': return (candle.high + candle.low + candle.close) / 3;
    case 'ohlc4': return (candle.open + candle.high + candle.low + candle.close) / 4;
    case 'hlcc4': return (candle.high + candle.low + candle.close + candle.close) / 4;
    default: return candle.close;
  }
};

export type CandleData = {
  open: number;
  high: number;
  low: number;
  close: number;
  time: number;
}

export type PriceSource = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' | 'hlcc4';

export type SingleResult = {
  value: number;
  time: number;
}

export interface BaseIndicatorConfig {
  source?: PriceSource;
}

type SimpleData = {
  value: number;
  time: number;
}

export type transform<TInput, TOutput = TInput> = (input: TInput) => TOutput;

export type ICalculationOptions<TOptions, TInput, T> = TOptions & { transform?: (input: TInput) => T };

// Tipo genérico para opções com transform
export type IndicatorOptions<TResult> = BaseIndicatorConfig & {
  transform?: (input: TResult) => unknown;
};

// Tipo genérico para função de indicador - EVITA REPETIÇÃO!
export type IndicatorFunction<TResult> = <T = TResult>(
  data: CandleData[], 
  options: BaseIndicatorConfig & { transform?: (input: TResult) => T }
) => T;

export interface SmaOptions extends BaseIndicatorConfig {
  period: number;
}

export type SmaResult = {
  value: number;
  time: number;
};

export interface GaussianChannelOptions extends BaseIndicatorConfig {
  poles: number;
  period: number;
  mult: number;
  modeLag: boolean;
  modeFast: boolean;
  transform?: (input: GaussianChannelResult) => unknown;
}

export type GaussianChannelResult = {
  filt: SimpleData[];
  hband: SimpleData[];
  lband: SimpleData[];
}

export interface RsiOptions extends BaseIndicatorConfig {
  period: number;
  transform?: (input: RsiResult[]) => unknown;
}

export type RsiResult = {
  value: number;
  time: number;
}

export const createIndicatorConfig = <TOptions extends BaseIndicatorConfig, TResult>(
  options: TOptions,
  transform?: transform<TResult>
): TOptions & { transform?: transform<TResult> } => {
  return { ...options, transform };
};
