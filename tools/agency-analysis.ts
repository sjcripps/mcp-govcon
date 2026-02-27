import { searchWeb, fetchPage } from "../lib/scraper";
import { analyze } from "../lib/openai";
import { log } from "../lib/logger";
import { getTierConfig } from "../lib/tier-config";

export interface AnalyzeAgencyInput {
  agency: string;
  fiscal_year?: string;
  naics?: string;
  tier?: string;
}

export async function analyzeAgency(
  input: AnalyzeAgencyInput
): Promise<string> {
  const { tier, ...params } = input;
  const tc = getTierConfig(tier);
  await log("info", "Starting analyze_agency", { ...params, tier: tier || "free" });

  const { agency, fiscal_year, naics } = params;
  const fyStr = fiscal_year || "2025";
  const naicsStr = naics ? ` NAICS ${naics}` : "";

  // Build search queries targeting agency spending and contracting data
  const allQueries = [
    `site:usaspending.gov "${agency}" spending fiscal year ${fyStr}`,
    `"${agency}" federal contract awards ${fyStr}${naicsStr}`,
    `"${agency}" top contractors spending analysis ${fyStr}`,
    `"${agency}" procurement forecast contracting plan`,
    `"${agency}" small business contracting goals set-aside`,
    `"${agency}" NAICS codes contract types spending breakdown ${fyStr}`,
  ];
  const queries = allQueries.slice(0, tc.searchQueries);

  const allResults: { title: string; url: string; snippet: string }[] = [];
  for (const q of queries) {
    const results = await searchWeb(q, tc.searchResults);
    allResults.push(...results);
  }

  // Deduplicate
  const seen = new Set<string>();
  const unique = allResults.filter((r) => {
    try {
      const key = r.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    } catch {
      return false;
    }
  });

  // Fetch pages (scaled by tier)
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
    .slice(0, 15)
    .map((r) => `- ${r.title}: ${r.snippet}`)
    .join("\n");

  // Also try to fetch the agency's USASpending page directly
  let usaSpendingData = "";
  try {
    const agencySlug = agency.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const usaPage = await fetchPage(`https://www.usaspending.gov/agency/${agencySlug}`);
    if (usaPage && !usaPage.error) {
      usaSpendingData = `\nUSASpending.gov Agency Page:\n- Title: ${usaPage.title}\n- Content: ${usaPage.textContent.slice(0, tc.contentPreviewLength)}`;
    }
  } catch {}

  const systemPrompt = `You are a federal agency spending intelligence analyst. Analyze a federal agency's contracting behavior, spending patterns, and procurement priorities.

Structure your response:

### Agency Overview
Brief summary of the agency's mission, size, and contracting profile.

### Spending Analysis (FY ${fyStr})
${tc.includeDataTables
    ? `Present as a table:
| Category | Spending | % of Total | YoY Change |
Include top NAICS codes, contract types (FFP, T&M, CPFF), and vehicle preferences (GSA, GWAC, BPA).`
    : `Top spending categories, preferred contract types, and total obligation estimates.`}

### Top Contractors
${tc.includeDataTables
    ? `| Contractor | Contract Value | NAICS | Contract Type | Duration |
Top ${tc.maxAgencies} contractors with the agency.`
    : `List of top contractors working with this agency and their contract areas.`}
${tc.includeSetAsideBreakdown ? `
### Small Business & Set-Aside Breakdown
${tc.includeDataTables
      ? `| Set-Aside Type | % of Awards | Dollar Volume | Goal vs Actual |`
      : `Small business goals, set-aside utilization rates, and underserved categories.`}` : ""}
${tc.includeWinPatterns ? `
### Procurement Patterns
- Preferred acquisition methods (full & open, set-aside, sole source)
- Average contract duration and renewal patterns
- Peak procurement periods and budget cycle timing
- Geographic distribution of awards` : ""}
${tc.includeActionMatrix ? `
### Strategic Action Matrix
| Action | Impact (1-5) | Effort (1-5) | Priority | Timeline |
Prioritized list of strategies for winning contracts with this agency.` : `
### Recommendations
3-5 actionable strategies for targeting this agency.`}
${tc.includePipelineForecast ? `
### Pipeline Forecast
- Upcoming recompetes and expiring contracts
- Budget trajectory and spending projections
- New program areas and emerging requirements
- 6/12/24 month opportunity projections with estimated values` : ""}`;

  const report = await analyze(
    systemPrompt,
    `Agency: ${agency}
Fiscal Year: ${fyStr}
${naics ? `NAICS Focus: ${naics}` : ""}

Search Results:
${searchContext}
${usaSpendingData}

Page Details:
${JSON.stringify(pageData, null, 2)}

Analyze this agency's contracting behavior and spending patterns. ${tc.promptSuffix}`,
    tc.maxTokens
  );

  await log("info", "analyze_agency complete", {
    agency,
    fiscal_year: fyStr,
    pages_analyzed: pageData.length,
  });

  return report;
}
