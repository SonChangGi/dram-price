export type PriceValues = Record<string, number | null | undefined>;

export interface Observation {
  cadence?: string;
  category?: string;
  collected_at?: string;
  currency?: string;
  date?: string;
  effective_date?: string;
  kind: string;
  product_id: string;
  product_name: string;
  source: string;
  source_url?: string;
  values?: PriceValues;
}

export interface SeriesMeta {
  cadences?: string[];
  categories?: string[];
  category?: string;
  kinds?: string[];
  product_id: string;
  product_name: string;
  representative?: boolean;
  source: string;
}

export interface SourceStatus {
  errors?: string[];
  observation_count?: number;
  ok?: boolean;
  source: string;
  urls?: string[];
  warnings?: string[];
}

export interface StatusPayload {
  caveats?: string[];
  counts_by_kind?: Record<string, number>;
  counts_by_source?: Record<string, number>;
  generated_at?: string;
  observation_count?: number;
  sources?: SourceStatus[];
}

export interface AutomationHealth {
  alertReasons?: string[];
  alertRequired?: boolean;
  blockingReasons?: string[];
  consecutiveBlockingFailures?: number;
  consecutiveWarningRuns?: number;
  details?: string[];
  status?: 'ok' | 'warning' | 'blocked' | string;
  targetDate?: string;
  updatedAt?: string;
}

export interface DashboardData {
  observations: Observation[];
  series: SeriesMeta[];
  status: StatusPayload;
  automation: AutomationHealth | null;
}

export interface DashboardFilters {
  kind: string;
  product: string;
  source: string;
  category: string;
  metric: string;
  limit: string;
}

export interface MetricPoint {
  key: string;
  label: string;
  value: number;
}
