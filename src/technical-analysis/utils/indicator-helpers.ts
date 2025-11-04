import { CandleData } from "../types";

// Converte array de números para CandleData[] (usando o valor como close)
export function numberArrayToCandles(numbers: number[], startTime: number = 0): CandleData[] {
  return numbers.map((value, index) => ({
    open: value,
    high: value,
    low: value,
    close: value,
    time: (startTime + index)
  }));
}

// Função auxiliar para extrair apenas os valores de um resultado
export function extractValues<T extends { value: number }>(result: T[]): number[] {
  return result.map(item => item.value);
}
