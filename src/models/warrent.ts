import { ChartResolution } from "./constants";

export type DataPoint = [number, number];

export interface Comparison {
  orderbookName: string;
  shortName: string;
  orderbookId: string;
  dataPoints: DataPoint[];
}

export interface WarrentOrderbook {
  marketMakerBidPoints: DataPoint[];
  allowedResolutions: ChartResolution[];
  defaultResolution: ChartResolution;
  comparisons: Comparison[];
  changePercent: number;
  high: number;
  lastPrice: number;
  low: number;
}
