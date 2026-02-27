export type Tier = "free" | "starter" | "pro" | "business";

export interface TierConfig {
  maxTokens: number;
  maxPages: number;
  searchResults: number;
  searchQueries: number;
  contentPreviewLength: number;
  includeDataTables: boolean;
  includeActionMatrix: boolean;
  includeProjections: boolean;
  promptSuffix: string;
  // GovCon domain-specific fields
  maxContracts: number;
  maxAgencies: number;
  includeWinPatterns: boolean;
  includeSetAsideBreakdown: boolean;
  includePipelineForecast: boolean;
}

export const TIER_CONFIG: Record<Tier, TierConfig> = {
  free: {
    maxTokens: 1500,
    maxPages: 3,
    searchResults: 3,
    searchQueries: 3,
    contentPreviewLength: 300,
    includeDataTables: false,
    includeActionMatrix: false,
    includeProjections: false,
    maxContracts: 5,
    maxAgencies: 3,
    includeWinPatterns: false,
    includeSetAsideBreakdown: false,
    includePipelineForecast: false,
    promptSuffix:
      "Keep the analysis concise. Provide a brief executive summary, top 3 key findings, and 3 actionable recommendations. No data tables. Limit to the most important insights only.",
  },
  starter: {
    maxTokens: 3000,
    maxPages: 6,
    searchResults: 5,
    searchQueries: 4,
    contentPreviewLength: 500,
    includeDataTables: false,
    includeActionMatrix: false,
    includeProjections: false,
    maxContracts: 10,
    maxAgencies: 5,
    includeWinPatterns: false,
    includeSetAsideBreakdown: true,
    includePipelineForecast: false,
    promptSuffix:
      "Provide a detailed analysis with clear sections. Include 5-6 key findings with specific examples and data points. Add a prioritized recommendation list with estimated effort levels.",
  },
  pro: {
    maxTokens: 5000,
    maxPages: 10,
    searchResults: 8,
    searchQueries: 5,
    contentPreviewLength: 1000,
    includeDataTables: true,
    includeActionMatrix: true,
    includeProjections: false,
    maxContracts: 20,
    maxAgencies: 8,
    includeWinPatterns: true,
    includeSetAsideBreakdown: true,
    includePipelineForecast: false,
    promptSuffix:
      "Provide an in-depth analysis with comprehensive sections. Include data tables where relevant, specific contract values, agency benchmarks, competitive scoring, and a prioritized action matrix with effort vs impact ratings. Include specific dollar amounts and NAICS breakdowns wherever possible.",
  },
  business: {
    maxTokens: 8000,
    maxPages: 15,
    searchResults: 10,
    searchQueries: 6,
    contentPreviewLength: 2000,
    includeDataTables: true,
    includeActionMatrix: true,
    includeProjections: true,
    maxContracts: 30,
    maxAgencies: 12,
    includeWinPatterns: true,
    includeSetAsideBreakdown: true,
    includePipelineForecast: true,
    promptSuffix:
      "Provide an executive-ready comprehensive report. Include detailed data tables, competitive scoring matrices with specific dollar amounts, agency spending benchmarks, trend analysis with fiscal year projections, risk assessment, pipeline opportunity sizing, and a prioritized strategic roadmap with timelines and resource requirements. Format this as a boardroom-ready GovCon intelligence deliverable.",
  },
};

export function getTierConfig(tier?: string): TierConfig {
  return TIER_CONFIG[(tier as Tier) || "free"] || TIER_CONFIG.free;
}
