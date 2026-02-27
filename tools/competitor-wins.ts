import { searchWeb, fetchPage } from "../lib/scraper";
import { analyze } from "../lib/openai";
import { log } from "../lib/logger";
import { getTierConfig } from "../lib/tier-config";

export interface CompetitorWinAnalysisInput {
  company: string;
  naics?: string;
  agency?: string;
  tier?: string;
}

export async function competitorWinAnalysis(
  input: CompetitorWinAnalysisInput
): Promise<string> {
  const { tier, ...params } = input;
  const tc = getTierConfig(tier);
  await log("info", "Starting competitor_win_analysis", { ...params, tier: tier || "free" });

  const { company, naics, agency } = params;
  const naicsStr = naics ? ` NAICS ${naics}` : "";
  const agencyStr = agency ? ` ${agency}` : "";

  // Build search queries for competitor contract wins
  const allQueries = [
    `site:usaspending.gov "${company}" contract awards`,
    `"${company}" federal contract win award${naicsStr}${agencyStr}`,
    `"${company}" government contract awards history`,
    `"${company}" GovCon contract wins${agencyStr} 2025 2026`,
    `"${company}" SAM.gov entity registration capabilities`,
    `"${company}" federal contractor profile DUNS CAGE`,
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
    .slice(0, tc.maxContracts)
    .map((r) => `- ${r.title}: ${r.snippet}`)
    .join("\n");

  // Try to fetch USASpending recipient page
  let usaSpendingData = "";
  try {
    const companySlug = encodeURIComponent(company);
    const searchUrl = `https://www.usaspending.gov/search/?hash=recipient&query=${companySlug}`;
    const usaPage = await fetchPage(searchUrl);
    if (usaPage && !usaPage.error) {
      usaSpendingData = `\nUSASpending Recipient Data:\n${usaPage.textContent.slice(0, tc.contentPreviewLength)}`;
    }
  } catch {}

  const systemPrompt = `You are a federal contracting competitive intelligence analyst. Analyze a company's federal contract win history, patterns, and positioning.

Structure your response:

### Company Profile
Brief summary of the company's GovCon presence — size, certifications, primary capabilities.

### Contract Win History
${tc.includeDataTables
    ? `Present as a table:
| Contract | Agency | Value | NAICS | Type | Period |
Show the top ${tc.maxContracts} most significant contract wins.`
    : `List of major contract wins with agency, estimated value, and contract type.`}

### Win Pattern Analysis
${tc.includeDataTables
    ? `| Pattern | Detail | Frequency |
Analyze: preferred agencies, NAICS concentrations, contract size sweet spots, win rate indicators.`
    : `Key patterns: which agencies they win with most, preferred contract types, and typical deal sizes.`}
${tc.includeWinPatterns ? `
### Competitive Positioning
- Market segments where this company dominates
- Teaming and subcontracting relationships
- Certifications and set-aside advantages (8a, HUBZone, SDVOSB, etc.)
- Pricing strategy indicators (low-cost vs best-value)
- Geographic footprint and facility locations` : ""}
${tc.includeActionMatrix ? `
### Competitive Counter-Strategy Matrix
| Strategy | Impact (1-5) | Feasibility (1-5) | Priority | Notes |
How to compete against or differentiate from this company.` : `
### How to Compete
3-5 actionable strategies for competing against this company in federal contracting.`}
${tc.includePipelineForecast ? `
### Forward-Looking Intelligence
- Expiring contracts ripe for recompete
- Agency relationships at risk or growing
- Market share trajectory projections (6/12/24 months)
- Teaming opportunity assessment
- Vulnerability windows and recommended timing` : ""}`;

  const report = await analyze(
    systemPrompt,
    `Company: ${company}
${naics ? `NAICS Focus: ${naics}` : ""}
${agency ? `Agency Focus: ${agency}` : ""}

Search Results:
${searchContext}
${usaSpendingData}

Page Details:
${JSON.stringify(pageData, null, 2)}

Analyze this competitor's federal contracting wins and provide actionable competitive intelligence. ${tc.promptSuffix}`,
    tc.maxTokens
  );

  await log("info", "competitor_win_analysis complete", {
    company,
    results_found: unique.length,
    pages_analyzed: pageData.length,
  });

  return report;
}
