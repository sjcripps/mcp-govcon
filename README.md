# EzBiz Government Contracting Intelligence MCP Server

AI-powered federal contracting intelligence — contract opportunity search, competitor win analysis, agency spending intelligence, and set-aside tracking using SAM.gov, USASpending.gov, and FPDS data.

## Tools

- **search_contracts** — Search federal contract opportunities on SAM.gov — filter by NAICS code, set-aside type, agency, dollar range, and keywords. Returns active solicitations with due dates, contact info, and bid requirements.
- **analyze_agency** — Analyze a federal agency's spending patterns and contracting behavior — top contractors, spending trends, preferred NAICS codes, contract types, and upcoming opportunities. Uses USASpending.gov data.
- **competitor_win_analysis** — Analyze a competitor's federal contract wins — awarded contracts, agencies they work with, contract values, NAICS codes, and win patterns. Find out who's winning in your space and what they're doing differently.
- **set_aside_tracker** — Track small business set-aside opportunities across federal agencies — 8(a), HUBZone, SDVOSB, WOSB, and SBA set-asides. Shows trending categories, upcoming deadlines, and agency set-aside spending patterns.

## Quick Start

```bash
bun install
cp .env.example .env  # Edit with your keys
bun run server.ts
```

## MCP Client Configuration

```json
{
  "mcpServers": {
    "ezbiz-govcon": {
      "url": "https://govcon.ezbizservices.com/mcp",
      "headers": { "X-API-Key": "YOUR_API_KEY" }
    }
  }
}
```

## API

- `POST /mcp` — MCP protocol endpoint
- `POST /api/keys/signup` — Create free key
- `GET /api/keys/usage?key=KEY` — Check usage
- `GET /api/pricing` — View tiers
- `GET /health` — Health check

## License

Proprietary — EzBiz Services 2026
