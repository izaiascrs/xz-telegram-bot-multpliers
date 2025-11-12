import "dotenv/config";
import { MoneyManagementV2 } from "./money-management/types";
import { TradeService } from "./database/trade-service";
import { initDatabase } from "./database/schema";
import { MoneyManager } from "./money-management/moneyManager";
import { schedule } from 'node-cron';
import { BuyContractRequest, Candles, ContractStatus } from "@deriv/api-types";
import { TelegramManager } from "./telegram";
import apiManager from "./ws";
import { DERIV_TOKEN } from "./utils/constants";
import { TradeWinRateManger } from "./utils/trade-win-rate-manager";
import TechnicalAnalysis from "./technical-analysis";
import { formatMacd } from "./utils/macd";
import { CandleData } from "./technical-analysis/types";

const ta = TechnicalAnalysis.getInstance();

type TSymbol = (typeof symbols)[number];
const symbols = ["R_25", "R_50", "R_75"] as const;
let lastTradedSymbol: TSymbol | undefined = undefined;

const multipliersMap = new Map<TSymbol, number>([
  // ["R_10", 4000], // 3000 | 4000
  ["R_25", 1600], // 1200 | 1600
  ["R_50", 800], // 600 | 800
  ["R_75", 500], // 300 | 500
  // ["R_100", 400], // 300 | 400
]);

const symbolsPipsNeeded = new Map<TSymbol, number>([
  // ["R_10", 1600], // normal
  ["R_25", 2000], // normal
  ["R_50", 1970], // normal
  ["R_75", 1060], // normal
  // ["R_100", 230], // normal
]);

const BALANCE_TO_START_TRADING = 1000;

const config: MoneyManagementV2 = {
  type: "fixed",
  initialStake: 10,
  profitPercent: 100,
  maxStake: 600,
  maxLoss: 200,  
  winsBeforeMartingale: 0,
  initialBalance: BALANCE_TO_START_TRADING,
  targetProfit: 1000,
};

let isAuthorized = false;
let isTrading = false;
let consecutiveWins = 0;
let lastContractId: number | undefined = undefined;
let lastContractIntervalId: NodeJS.Timeout | null = null;
let tickCount = 0;
let waitingVirtualLoss = false;

let subscriptions: {
  ticks?: any;
  contracts?: any;
} = {};

// Adicionar um array para controlar todas as subscrições ativas
let activeSubscriptions: any[] = [];

// Inicializar o banco de dados
const database = initDatabase();
const tradeService = new TradeService(database);
const tradeWinRateManager = new TradeWinRateManger();
const telegramManager = new TelegramManager(tradeService, tradeWinRateManager);
const moneyManager = new MoneyManager(config, config.initialBalance);

let retryToGetLastTradeCount = 0;

type HistogramSignal = "increasing" | "decreasing" | "neutral";

function checkHistogramSignal(candle: CandleData[]): HistogramSignal {
  const { histData } = formatMacd({
    candlesData: candle,
    macdOptions: {
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    }
  });

  const [thirdLast, secLast, last] = histData.slice(-3);

  if(thirdLast?.value === undefined || secLast?.value === undefined || last?.value === undefined) return "neutral";

  // first signal if the histogram is increasing ou decreasing
  if(last.value > 0) {
    const candleIncreasing = secLast.value > thirdLast.value;
    // positive histogram check if is decreasing
    if(candleIncreasing && last.value < secLast.value) return "decreasing"
    return "neutral";
  }

  if(last.value < 0) {
    const candleDecreasing = secLast.value < thirdLast.value;
    // positive histogram check if is increasing
    if(candleDecreasing && last.value > secLast.value) return "increasing";
    return "neutral";
  }

  return "neutral";
}

function checkCandleType(candle: CandleData) {
  if(candle.close > candle.open) return "bullish";
  return "bearish";
}

// running every minute - America/Sao_Paulo
const task = schedule('56 * * * * *', async () => {
  updateActivityTimestamp();
  await sellExpiredContract();
  
  if(lastContractId) {
    getLastTradeResult(lastContractId);
  }

  if(telegramManager.isRunningBot() === false) {
    console.log("bot is not running!");
    return;
  }

  if(isTrading) return;

  try {
    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];

      // break if is trading
      if(isTrading) return;
      
      await new Promise((res) => setTimeout(res, 200));
        
      const candlesReq = await apiManager.augmentedSend("ticks_history", { 
        ticks_history: symbol,
        end: "latest",
        style: "candles",
        granularity: 60, // 1 minute
        // @ts-ignore
        count: 500
      });
    
      const data = (candlesReq.candles ?? [])
      const candlesData = data.map(formatCandle);

      if(candlesData.length < 100) continue;

      const histogramType = checkHistogramSignal(candlesData);


      // 1 - check if we have a signal on histogram

      // if no signal continue
      if(histogramType === "neutral") continue;

      const secondLastCandle = candlesData.at(-2);
      if(!secondLastCandle) continue;

      const secondLastCandleType = checkCandleType(secondLastCandle);

      const lastCandle = candlesData.at(-1);
      if(!lastCandle) continue;

      const lastCandleType = checkCandleType(lastCandle)
      
      const validHistogramBearishSignal = histogramType === "decreasing" && secondLastCandleType === "bullish" && lastCandleType === "bearish";
      const validHistogramBullishSignal = histogramType === "increasing" && secondLastCandleType === "bearish" && lastCandleType === "bullish";

      if(!validHistogramBearishSignal && !validHistogramBullishSignal) continue;
    
      const zeroLagData = ta.zeroLagTrend(candlesData, {
        length: 70,
        mult: 1.2,
      });

      if(!zeroLagData || !zeroLagData.length) continue;

      const lastZeroLag = zeroLagData.at(-1)!;

      const zeroLagType = (lastZeroLag.trend === 1) ? "zero-bullish" : "zero-bearish";

      const validZeroLagBearishSignal = validHistogramBullishSignal && zeroLagType === "zero-bearish";
      const validZeroLagBullishSignal = validHistogramBearishSignal && zeroLagType === "zero-bullish";
      
      if(!validZeroLagBearishSignal && !validZeroLagBullishSignal) continue;

      const validCandleUpperDistance = zeroLagType === "zero-bullish" && secondLastCandle.low > lastZeroLag.upperBand;
      const validCandleLowerDistance = zeroLagType === "zero-bearish" && secondLastCandle.high < lastZeroLag.lowerBand;

      if(!validCandleUpperDistance && !validCandleLowerDistance) continue;

      // change occur on second last candle
      // const lastZeroLagData = zeroLagData.at(-2);
      
      // if(!lastZeroLagData) continue;
      // if (lastZeroLagData.trendChange === false) continue;
    
      let contractType: NonNullable<BuyContractRequest["parameters"]>["contract_type"] = "MULTUP";
    
      // bearish trend
      if(validCandleUpperDistance) {
        contractType = "MULTDOWN"
      }

      // if(multipliersDirectionMap.get(symbol) === false) {
      //   contractType = (contractType === "MULTDOWN") ? "MULTUP" : "MULTDOWN";
      // }
    
      const stake = moneyManager.calculateNextStake();
      const canTrade = checkStakeAndBalance(stake);
      if(canTrade === false) continue;

      // avoid trading same symbol twice in row
      if(lastTradedSymbol === symbol) return;
      
      const authorized = await authorize();
      if(!authorized) {
        telegramManager.sendMessage("Fail to authorize account!");
        continue;
      }
    
      const res = await apiManager.augmentedSend("buy", {
        buy: '1',
        price: 1000,
        parameters: {
          contract_type: contractType,
          multiplier: multipliersMap.get(symbol),
          currency: "USD",
          symbol: symbol,
          amount: stake,
          basis: "stake",
          limit_order: {
            take_profit: 7 // 70% of the stake
          }
        }
      })

      lastTradedSymbol = symbol;

      lastContractId = res.buy?.contract_id;
      isTrading = true;
      let message = "🎯 Sinal identificado!\n"+
      `💰 Valor da entrada: $${stake}\n` +
      `🏁 Tipo de contrato: ${contractType}\n` +
      `📊 ${symbol.split("_").join("")}\n`+
      `🆔 ${lastContractId}`;
      telegramManager.sendMessage(message);

    }
    
  } catch (error) {
    console.log("error", error);    
    telegramManager.sendMessage("Error trying to buy contract")
  }
  
}, {
  scheduled: false,
  timezone: "America/Sao_Paulo"
});

// Configura callback para quando atingir o lucro alvo
moneyManager.setOnTargetReached(async (profit, balance) => {
  const message = `🎯 Lucro alvo atingido!\n\n` +
    `💰 Lucro: $${profit.toFixed(2)}\n` +
    `🎯 Meta: $${config.targetProfit}\n` +
    `💵 Saldo: $${balance.toFixed(2)}\n\n` +
    `✨ Bot será reiniciado automaticamente amanhã às 09:00\n` +
    `🛑 Bot parado com sucesso!`;

  telegramManager.sendMessage(message);
  await stopBot();
  telegramManager.setBotRunning(false);
});


function formatCandle(candle: Candles[number] & { open_time?: string }) {  
  return {
    time: (candle.open_time || candle.epoch) as unknown as number,
    open: +(candle.open ?? 0),
    high: +(candle.high ?? 0),
    low:  +(candle.low ?? 0),
    close: +(candle.close ?? 0),
  };
}

function handleTradeResult({
  profit,
  stake,
  status,
  exit_tick_display_value,
  tick_stream,
}: {
  profit: number;
  stake: number;
  status: ContractStatus;
  exit_tick_display_value: string | undefined;
  tick_stream:  {
    epoch?: number;
    tick?: null | number;
    tick_display_value?: null | string;
  }[] | undefined
}) {

  updateActivityTimestamp();

  if(status === "open") return;

  // const isWin = status === "won" || (status === "sold" && profit > 0);
  const isWin = profit > 0;
  
  // Calcular novo saldo baseado no resultado
  const currentBalance = moneyManager.getCurrentBalance();
  let newBalance = currentBalance;

  isTrading = false;
  lastContractId = undefined;
  // waitingVirtualLoss = !isWin;
  
  if (isWin) {
    newBalance = currentBalance + profit;
    consecutiveWins++;
  } else {
    newBalance = currentBalance - Math.abs(profit);
    consecutiveWins = 0;
  }
  
  // moneyManager.updateBalance(Number(newBalance.toFixed(2)));
  moneyManager.updateLastTrade(isWin, profit);
  telegramManager.updateTradeResult(isWin, moneyManager.getCurrentBalance());

  const resultMessage = isWin ? "✅ Trade ganho!" : "❌ Trade perdido!";
  telegramManager.sendMessage(
    `${resultMessage}\n` +
    `💰 ${isWin ? 'Lucro' : 'Prejuízo'}: $${profit}\n` +
    `💵 Saldo: $${moneyManager.getCurrentBalance().toFixed(2)}`
  );  

  // Salvar trade no banco
  tradeService.saveTrade({
    isWin,
    stake,
    profit: profit,
    balanceAfter: newBalance
  }).catch(err => console.error('Erro ao salvar trade:', err));

  tradeWinRateManager.updateTradeResult(isWin);

}

async function getLastTradeResult(contractId: number | undefined) { 
  if(!contractId) return;  
  if(retryToGetLastTradeCount >= 2) return;

  try {
    const data = await apiManager.augmentedSend('proposal_open_contract', { contract_id: contractId });

    // console.dir(data.proposal_open_contract, { depth: null });

    if(
      !data.proposal_open_contract?.is_expired &&
      (!data.proposal_open_contract?.status || data.proposal_open_contract?.status === "open")
    ) return;
    
    const contract = data.proposal_open_contract;
    const profit = contract?.profit ?? 0;
    const stake = contract?.buy_price ?? 0;
    const status = contract?.status;
    const exit_tick_display_value = contract?.exit_tick_display_value;
    const tick_stream = contract?.tick_stream;
    retryToGetLastTradeCount = 0;
  
    handleTradeResult({
      profit,
      stake,
      status: status ?? profit > 0 ? "won" : "lost",
      exit_tick_display_value,
      tick_stream
    });    

    isTrading = false;
    // lastContractId = undefined;
    // waitingVirtualLoss = false;
    tickCount = 0;
  } catch (error: any) {
    console.log("error trying to get last Trade!", error);
    const codeError = error?.error?.code;
    if(codeError && codeError === "AuthorizationRequired") {
      retryToGetLastTradeCount++;
      await authorize()
        .then(() => getLastTradeResult(contractId))
        .catch((err) => console.error("Error trying to login", err))
    }
  }
}

const checkStakeAndBalance = (stake: number) => {
  if (stake < 1 || moneyManager.getCurrentBalance() < 1) {
    telegramManager.sendMessage(
      "🚨 *ALERTA CRÍTICO*\n\n" +
        "❌ Bot finalizado automaticamente!\n" +
        "💰 Saldo ou stake chegou a zero\n" +
        `💵 Saldo final: $${moneyManager.getCurrentBalance().toFixed(2)}`
    );
    stopBot();
    return false;
  }
  return true;
};

const clearSubscriptions = async () => {
  try {
    // Limpar todas as subscrições ativas
    for (const subscription of activeSubscriptions) {
      if (subscription) {
        try {
          subscription.unsubscribe();
        } catch (error) {
          console.error("Erro ao limpar subscrição:", error);
        }
      }
    }
    
    // Limpar array de subscrições
    activeSubscriptions = [];
    
    // Limpar objeto de subscrições
    subscriptions = {};

    // waitingVirtualLoss = false;
    isAuthorized = false;

    console.log("Subscrições limpas. Total agora:", activeSubscriptions.length);

    
  } catch (error) {
    console.error("Erro ao limpar subscrições:", error);
  }
};

const startBot = async () => {
  updateActivityTimestamp(); // Atualizar timestamp ao iniciar o bot
  await clearSubscriptions();

  if (!isAuthorized) {
    await authorize();
  }

  try {
    telegramManager.setBotRunning(true); // Define o estado como rodando ANTES de criar as subscrições
    subscriptions.contracts = subscribeToOpenOrders();
    
    if (!subscriptions.contracts) {
      throw new Error("Falha ao criar subscrições");
    }

    telegramManager.sendMessage("🤖 Bot iniciado e conectado aos serviços Deriv");
  } catch (error) {
    console.error("Erro ao iniciar bot:", error);
    telegramManager.sendMessage("❌ Erro ao iniciar o bot. Tentando parar e limpar as conexões...");
    telegramManager.setBotRunning(false);
    await stopBot();
  }
};

const sellOpenContract = async (contractId: number) => {
  try {
    const res = await apiManager.augmentedSend("sell", {
      price: 0,
      sell: contractId,
    });

    const msg = 
    "⚠ contract sold successfully.\n"+
    `🆔 ${contractId}`

    telegramManager.sendMessage(msg)
  } catch (error) {
    console.error("error selling contract", error);    
  }
}

const sellExpiredContract = async () => {
  try {
    apiManager.augmentedSend("sell_expired", {});
  } catch (error) {
    console.error("Error selling expired contract", error);
  }
}

const stopBot = async () => {
  updateActivityTimestamp(); // Atualizar timestamp ao parar o bot
  await clearSubscriptions();
  isTrading = false;
  retryToGetLastTradeCount = 0;
  telegramManager.sendMessage("🛑 Bot parado e desconectado dos serviços Deriv");
};

type TrailingStop = {
  stopProfit: number;
  isExpired: number;
  isSelling: boolean;
}

const contractTrailingStop = new Map<Number, TrailingStop>([]);

const subscribeToOpenOrders = () => {
  const contractSub = apiManager.augmentedSubscribe("proposal_open_contract");

  const calculateTrailingStop = (profit: number) => {
    if(profit >= 4) return 2;
    if(profit >= 5) return 2.5;    
    if(profit >= 6) return 3;
    if(profit >= 7) return 4;
    if(profit >= 8) return 6;
    if(profit >= 9) return 7;
    return 0;
  }
  
  const subscription = contractSub.subscribe(async (data) => {
    updateActivityTimestamp();

    if (!telegramManager.isRunningBot()) {
      subscription.unsubscribe();
      const index = activeSubscriptions.indexOf(subscription);
      if (index > -1) {
        activeSubscriptions.splice(index, 1);
      }
      return;
    }

    // const contract = data.proposal_open_contract;
    // const status = contract?.status;
    // const profit = contract?.profit ?? 0;
    // const isExpired = contract?.is_expired ?? 0;
    // const contractId = contract?.contract_id;

    // if(profit <= 0) return;

    // if(!contractId) return;

    // if(status !== "open") return;

    // if(!contractTrailingStop.has(contractId)) {
    //   contractTrailingStop.set(contractId, { isExpired, stopProfit: 0, isSelling: false });
    // }

    // const currentTStopObj = contractTrailingStop.get(contractId);

    // if(!currentTStopObj) return;

    // let currentTrailingStop = currentTStopObj.stopProfit;

    // const nextTrailingStop = calculateTrailingStop(profit);

    // if(nextTrailingStop > currentTrailingStop) {
    //   contractTrailingStop.set(contractId, { ...currentTStopObj, stopProfit: nextTrailingStop });
    //   currentTrailingStop = nextTrailingStop;
    // }

    // if(currentTrailingStop !== 0 && currentTrailingStop >= profit) {
    //   console.log("SELLING TRAILING STOP HIT!...");
      
    //   contractTrailingStop.set(contractId, { ...currentTStopObj, isSelling: true });
    //   await sellOpenContract(contractId);
    // }

  },(err) => {
    console.log("CONTRACT SUBSCRIPTION ERROR", err);    
  });

  activeSubscriptions.push(subscription);
  return contractSub;
};

const authorize = async () => {
  try {
    await apiManager.authorize(DERIV_TOKEN);
    isAuthorized = true;
    telegramManager.sendMessage("🔐 Bot autorizado com sucesso na Deriv");
    return true;
  } catch (err) {
    isAuthorized = false;
    telegramManager.sendMessage("❌ Erro ao autorizar bot na Deriv");
    await clearSubscriptions();
    apiManager.connection.close();
    return false;
  }
};

// Adicionar verificação periódica do estado do bot
setInterval(async () => {
  if (telegramManager.isRunningBot() && !waitingVirtualLoss && moneyManager.getCurrentBalance() > 0) {
    // Verificar se o bot está "travado"
    const lastActivity = Date.now() - lastActivityTimestamp;
    if (lastActivity > (60_000 * 40)) { // 40 minutos sem atividade
      console.log("Detectado possível travamento do bot, resetando estados...");
      isTrading = false;
      // lastContractId = undefined;
      // waitingVirtualLoss = false;
      lastActivityTimestamp = Date.now();
      await clearSubscriptions();
    }
  }

  apiManager.augmentedSend("ping").catch(console.error);
}, (28_000)); // 30 seconds

// Adicionar timestamp da última atividade
let lastActivityTimestamp = Date.now();

// Atualizar o timestamp em momentos importantes
const updateActivityTimestamp = () => {
  lastActivityTimestamp = Date.now();
};

async function sleep(ms: number) {
  return await new Promise((res) => setTimeout(res, ms));
}

async function main() {
  task.start();

  apiManager.connection.addEventListener("open", async () => {
    telegramManager.sendMessage("🌐 Conexão WebSocket estabelecida");
    await clearSubscriptions();
    await authorize();
    subscribeToOpenOrders();
  });

  apiManager.connection.addEventListener("close", async () => {
    isAuthorized = false;
    await clearSubscriptions();
    telegramManager.sendMessage("⚠️ Conexão WebSocket fechada");
  });

  apiManager.connection.addEventListener("error", async (event) => {
    console.error("Erro na conexão:", event);
    isAuthorized = false;
    telegramManager.sendMessage("❌ Erro na conexão com o servidor Deriv");
    await clearSubscriptions();
  });

  // Observadores do estado do bot do Telegram
  setInterval(async () => {
    // Se o bot está marcado como rodando mas não tem subscrições, tenta reconectar
    if (telegramManager.isRunningBot() && !subscriptions.contracts) {
      console.log("Tentando reconectar bot...");
      await clearSubscriptions();
      await sleep(10_000)
      await startBot();
    } 
    // Se o bot não está marcado como rodando MAS tem subscrições ativas, limpa as subscrições
    else if (!telegramManager.isRunningBot() && subscriptions.contracts) {
      console.log("Limpando subscrições pendentes...");      
      await clearSubscriptions();
    }
  }, 20_000);
}

main();
