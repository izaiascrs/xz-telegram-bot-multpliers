import { MACD } from "technicalindicators";

type TCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

type MACDOutput =  {
  MACD?: number;
  signal?: number;
  histogram?: number;
}

export type TMacdSeries = {
  id: string;
  indicator: TMacdOpt;
}

export type TMacdOpt = {
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
  SimpleMAOscillator: boolean,
  SimpleMASignal: boolean,
}

type TFormatMacdDataProps = {
  candlesData: TCandle[];
  macdOptions: TMacdOpt;
  colorUp1?: string;
  colorUp2?: string;
  colorDown1?: string;
  colorDown2?: string;
}

function formatMacdData({
  dataSet = [],
  MACD = [],
  colorUp1 = '#4bb4b3',
  colorUp2 = '#B2DFDB',
  colorDown1 = '#ec3f3f',
  colorDown2 = '#FFCDD2',
}: {
  dataSet: TCandle[];
  MACD: MACDOutput[];
  colorUp1?: string;
  colorUp2?: string;
  colorDown1?: string;
  colorDown2?: string;
}) {
  return dataSet
    .slice(dataSet.length - MACD.length)
    .map((v, i) => {
      let color = colorUp1;
      if (i > 0) {

        if (MACD[i].histogram && MACD[i - 1].histogram) {
          const currentHist = MACD[i].histogram!;
          const nextHist = MACD[i - 1].histogram!;
          color =
            currentHist > 0
              ? nextHist < currentHist
                ? colorUp1
                : colorUp2
              : nextHist < currentHist
              ? colorDown2
              : colorDown1;
        }
      }
      return {
        ...MACD[i],
        time: v.time,
        color,
      };
    });
}

export function formatMacd(props: TFormatMacdDataProps) {
  const macdDataArray = MACD.calculate({
    ...props.macdOptions,
    values: props.candlesData.map((c) => c.close),
  });

  const formatted = formatMacdData({
    dataSet: props.candlesData,
    MACD: macdDataArray,
    colorDown1: props.colorDown1,
    colorDown2: props.colorDown2,
    colorUp1: props.colorUp1,
    colorUp2: props.colorUp2,
  });

  const histData = formatted.map((v) => ({
    value: v.histogram,
    time: v.time,
    color: v.color,
  }));

  const macdData = formatted.map((v) => ({
    value: v.MACD,
    time: v.time,
  }));
  
  const signalData = formatted.map((v) => ({
    value: v.signal,
    time: v.time,
  }));

  return {
    histData,
    macdData,
    signalData
  }
}