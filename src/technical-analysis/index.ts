import { calculateSMA } from "./indicators/sma";
import { calculateZeroLagTrendSignals } from "./indicators/zero-lag-trend-signals";
import { calculateEMA } from "./indicators/ema";
import { calculateAtr } from "./indicators/atr";

class TechnicalAnalysis {
  private static instance: TechnicalAnalysis | null = null;

  private constructor() {}

  static getInstance() {
    if (!TechnicalAnalysis.instance) {
      TechnicalAnalysis.instance = new TechnicalAnalysis();
    }
    return TechnicalAnalysis.instance;
  }

  atr = calculateAtr;
  sma = calculateSMA;
  ema = calculateEMA;  
  zeroLagTrend = calculateZeroLagTrendSignals;
}

export default TechnicalAnalysis;