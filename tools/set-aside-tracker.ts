import { searchWeb, fetchPage } from "../lib/scraper";
import { analyze } from "../lib/openai";
import { log } from "../lib/logger";
import { getTierConfig } from "../lib/tier-config";

export interface SetAsideTrackerInput {
  set_aside_type: string;
  naics?: string;
  agency?: string;
  tier?: string;
}

export async function setAsideTracker(
  input: SetAsideTrackerInput
): Promise<string> {
  const { tier, ...params } = input;
  const tc = getTierConfig(tier);
  await log("info", "Starting set_aside_tracker", { ...params, tier: tier || "free" });

  const { set_aside_type, naics, agency } = params;
  const setAsideLabel = getSetAsideLabel(set_aside_type);
  const naicsStr = naics ? ` NAICS ${naics}` : "";
  const agencyStr = agency ? ` ${agency}` : "";

  // Build search queries for set-aside opportunities
  const allQueries = [
    `site:sam.gov ${setAsideLabel} set-aside contract opportunity${naicsStr}`,
    `${setAsideLabel} federal contract opportunities small business${agencyStr} 2026`,
    `${setAsideLabel} set-aside awards spending analysis government`,
    `SBA ${setAsideLabel} program federal contracting goals statistics`,
    `${setAsideLabel} small business contract awards trending NAICS categories`,
    `federal small business contracting ${setAsideLabel} agency goals scorecard`,
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
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  // Fetch pages
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

  // Try to fetch SBA scorecard data
  let sbaData = "";
  try {
    const sbaPage = await fetchPage("https://www.sba.gov/document/support-government-contracting-scorecard");
    if (sbaPage && !sbaPage.error) {
      sbaData = `\nSBA Scorecard Data:\n${sbaPage.textContent.slice(0, tc.contentPreviewLength)}`;
    }
  } catch {}

  const systemPrompt = `You are a federal small business contracting specialist focused on set-aside programs. Analyze set-aside opportunities, agency compliance with small business goals, and trends.

Structure your response:

### Set-Aside Program Overview
Brief overview of the ${setAsideLabel} program — eligibility requirements, current status, and recent policy changes.

### Active Opportunities
${tc.includeDataTables
    ? `Present as a table:
| Opportunity | Agency | Value Range | NAICS | Due Date | Competition Level |
Show top ${tc.maxContracts} active ${setAsideLabel} opportunities.`
    : `List of current ${setAsideLabel} set-aside opportunities with key details.`}
${tc.includeSetAsideBreakdown ? `
### Set-Aside Category Breakdown
${tc.includeDataTables
      ? `| NAICS Category | # of Opportunities | Avg Value | Growth Trend |
Breakdown of ${setAsideLabel} opportunities by industry category.`
      : `Top NAICS categories for ${setAsideLabel} opportunities, with volume and value estimates.`}

### Agency Compliance
${tc.includeDataTables
      ? `| Agency | ${setAsideLabel} Goal % | Actual % | Gap | Opportunity Level |
Top agencies ranked by set-aside goal achievement — agencies falling short = more opportunities.`
      : `Which agencies are meeting vs missing their ${setAsideLabel} goals (shortfall = opportunity).`}` : ""}
${tc.includeWinPatterns ? `
### Winning Patterns
- Average contract size for ${setAsideLabel} awards
- Most common contract vehicles (GSA, BPA, GWAC)
- Geographic hotspots for opportunities
- Peak procurement periods
- Common teaming arrangements` : ""}
${tc.includeActionMatrix ? `
### Opportunity Prioritization Matrix
| Opportunity/Category | Volume | Competition | Win Probability | Strategic Priority |
Prioritized assessment of where to focus pursuit efforts.` : `
### Recommendations
3-5 strategies for maximizing ${setAsideLabel} set-aside wins.`}
${tc.includePipelineForecast ? `
### Pipeline Forecast
- Seasonal patterns for ${setAsideLabel} procurement
- End-of-fiscal-year spending surge predictions
- Agency-level pipeline projections
- Emerging NAICS categories with growing set-aside volumes
- 6/12 month opportunity forecast with estimated addressable value` : ""}`;

  const report = await analyze(
    systemPrompt,
    `Set-Aside Type: ${setAsideLabel} (${set_aside_type})
${naics ? `NAICS Focus: ${naics}` : ""}
${agency ? `Agency Focus: ${agency}` : ""}

Search Results:
${searchContext}
${sbaData}

Page Details:
${JSON.stringify(pageData, null, 2)}

Analyze ${setAsideLabel} set-aside opportunities and provide actionable intelligence for small business contractors. ${tc.promptSuffix}`,
    tc.maxTokens
  );

  await log("info", "set_aside_tracker complete", {
    set_aside_type,
    results_found: unique.length,
    pages_analyzed: pageData.length,
  });

  return report;
}

function getSetAsideLabel(type: string): string {
  const labels: Record<string, string> = {
    "8a": "8(a) Business Development",
    "hubzone": "HUBZone",
    "sdvosb": "Service-Disabled Veteran-Owned Small Business (SDVOSB)",
    "wosb": "Women-Owned Small Business (WOSB)",
    "sba": "SBA Small Business",
    "all": "Small Business (All Set-Asides)",
  };
  return labels[type.toLowerCase()] || type;
}
