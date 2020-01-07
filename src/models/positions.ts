export namespace AvanzaPositionsReponse {
  export interface Position {
    accountName: string;
    accountType: string;
    depositable: boolean;
    accountId: string;
    volume: number;
    averageAcquiredPrice: number;
    profitPercent: number;
    acquiredValue: number;
    profit: number;
    value: number;
    currency: string;
    orderbookId: string;
    tradable: boolean;
    lastPrice: number;
    lastPriceUpdated: Date;
    change: number;
    changePercent: number;
    flagCode: string;
    name: string;
  }

  export interface InstrumentPosition {
    instrumentType: string;
    positions: Position[];
    totalValue: number;
    totalProfitValue: number;
    totalProfitPercent: number;
    todaysProfitPercent: number;
  }

  export interface Root {
    statusCode: number;
    instrumentPositions: InstrumentPosition[];
    totalBalance: number;
    totalProfitPercent: number;
    totalBuyingPower: number;
    totalOwnCapital: number;
    totalProfit: number;
  }
}
