import { searchWeb, fetchPage } from "../lib/scraper";
import { analyze } from "../lib/openai";
import { log } from "../lib/logger";
import { getTierConfig } from "../lib/tier-config";

export interface SearchContractsInput {
  query: string;
  naics?: string;
  set_aside?: string;
  agency?: string;
  tier?: string;
}

export async function searchContracts(
  input: SearchContractsInput
): Promise<string> {
  const { tier, ...params } = input;
  const tc = getTierConfig(tier);
  await log("info", "Starting search_contracts", { ...params, tier: tier || "free" });

  const { query, naics, set_aside, agency } = params;

  // Build targeted search queries for federal contract opportunities
  const naicsStr = naics ? ` NAICS ${naics}` : "";
  const setAsideStr = set_aside && set_aside !== "all" ? ` ${set_aside} set-aside` : "";
  const agencyStr = agency ? ` ${agency}` : "";

  const allQueries = [
    `site:sam.gov "${query}" contract opportunity${naicsStr}${setAsideStr}`,
    `sam.gov "${query}" solicitation${agencyStr} federal contract`,
    `"${query}" federal contract opportunity${naicsStr} active solicitation 2026`,
    `"${query}" government contract RFP RFQ${setAsideStr}${agencyStr}`,
    `"${query}" federal procurement opportunity small business${naicsStr}`,
    `usaspending.gov "${query}" contract awards${agencyStr}`,
  ];
  const queries = allQueries.slice(0, tc.searchQueries);

  const allResults: { title: string; url: string; snippet: string }[] = [];
  for (const q of queries) {
    const results = await searchWeb(q, tc.searchResults);
    allResults.push(...results);
  }

  // Deduplicate by URL
  const seen = new Set<string>();
  const unique = allResults.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  // Fetch top pages (scaled by tier)
  const pagesToFetch = unique.slice(0, tc.maxPages);
  const pages = await Promise.all(
    pagesToFetch.map((r) => fetchPage(r.url).catch(() => null))
  );

  const pageData = pages
    .filter(Boolean)
    .map((p) => ({
      url: p!.url,
      title: p!.title,
      textPreview: p!.textContent.slice(0, tc.contentPreviewLength),
    }));

  const searchContext = unique
    .slice(0, tc.maxContracts)
    .map((r) => `- ${r.title}: ${r.snippet}`)
    .join("\n");

  const systemPrompt = `You are a federal contracting intelligence analyst specializing in government procurement. Analyze SAM.gov contract opportunities and federal procurement data.

Structure your response:

### Contract Opportunity Search Results
Summary of matching opportunities found for the search criteria.

### Active Opportunities
${tc.includeDataTables
    ? `Present as a table:
| Opportunity | Agency | Value Range | Set-Aside | Due Date | NAICS |
Then provide key details for each.`
    : `For each opportunity found: title, agency, estimated value, set-aside type, and response deadline.`}

### Key Insights
${tc.includeDataTables
    ? `| Insight | Impact | Relevance to Your Search |`
    : `Top findings about the contract landscape for this search.`}
${tc.includeActionMatrix ? `
### Bid/No-Bid Action Matrix
| Opportunity | Win Probability | Competition Level | Strategic Value | Recommended Action |
Prioritized assessment of which opportunities to pursue.` : `
### Recommendations
3-5 actionable recommendations for pursuing these opportunities.`}
${tc.includePipelineForecast ? `
### Pipeline Forecast
- Upcoming recompetes and follow-on opportunities
- Seasonal procurement patterns for this category
- Agency budget cycle implications
- 6/12 month opportunity projections` : ""}`;

  const report = await analyze(
    systemPrompt,
    `Search Query: "${query}"
${naics ? `NAICS Code: ${naics}` : ""}
${set_aside ? `Set-Aside Filter: ${set_aside}` : ""}
${agency ? `Agency Filter: ${agency}` : ""}

Search Results:
${searchContext}

Page Details:
${JSON.stringify(pageData, null, 2)}

Analyze these federal contract opportunities and provide actionable intelligence. ${tc.promptSuffix}`,
    tc.maxTokens
  );

  await log("info", "search_contracts complete", {
    query,
    results_found: unique.length,
    pages_analyzed: pageData.length,
  });

  return report;
}
