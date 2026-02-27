import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import { join } from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

import { validateApiKey, recordUsage, createApiKey, getKeyByEmail, upgradeKey, getKeyUsage, TIER_LIMITS, TIER_PRICES } from "./lib/auth";
import type { Tier } from "./lib/auth";
import { log } from "./lib/logger";

import { searchContracts } from "./tools/contract-search";
import { analyzeAgency } from "./tools/agency-analysis";
import { competitorWinAnalysis } from "./tools/competitor-wins";
import { setAsideTracker } from "./tools/set-aside-tracker";

const PORT = parseInt(process.env.MCP_PORT || "4203");
const BASE_DIR = import.meta.dir;

// --- Page cache ---
const pageCache: Record<string, string> = {};
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function loadPage(name: string): Promise<string> {
  if (pageCache[name]) return pageCache[name];
  const content = await readFile(join(BASE_DIR, "pages", name), "utf-8");
  pageCache[name] = content;
  return content;
}

async function serveStatic(pathname: string): Promise<Response | null> {
  if (!pathname.startsWith("/static/") && !pathname.startsWith("/.well-known/")) return null;
  const filePath = pathname.startsWith("/.well-known/")
    ? join(BASE_DIR, "static", pathname)
    : join(BASE_DIR, pathname);
  try {
    const content = await readFile(filePath);
    const ext = pathname.substring(pathname.lastIndexOf("."));
    return new Response(content, {
      headers: {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return null;
  }
}

// --- MCP Server factory ---
function createMcpServer(tier: string = "free"): McpServer {
  const server = new McpServer({
    name: "ezbiz-govcon",
    version: "1.0.0",
  });

  server.tool(
    "search_contracts",
    "Search federal contract opportunities on SAM.gov — filter by NAICS code, set-aside type, agency, dollar range, and keywords. Returns active solicitations with due dates, contact info, and bid requirements.",
    {
      query: z.string().describe("Keywords to search for (e.g., 'cybersecurity', 'IT support', 'janitorial services')"),
      naics: z.string().optional().describe("NAICS code to filter by (e.g., '541512' for computer systems design)"),
      set_aside: z.string().optional().describe("Set-aside type: 8a, HUBZone, SDVOSB, WOSB, SBA, or 'all'"),
      agency: z.string().optional().describe("Federal agency name (e.g., 'Department of Defense', 'VA')")
    },
    async (params) => {
      const result = await searchContracts({ ...params, tier });
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "analyze_agency",
    "Analyze a federal agency's spending patterns and contracting behavior — top contractors, spending trends, preferred NAICS codes, contract types, and upcoming opportunities. Uses USASpending.gov data.",
    {
      agency: z.string().describe("Federal agency name (e.g., 'Department of Defense', 'Department of Veterans Affairs', 'GSA')"),
      fiscal_year: z.string().optional().describe("Fiscal year to analyze (e.g., '2025')"),
      naics: z.string().optional().describe("NAICS code to focus analysis on")
    },
    async (params) => {
      const result = await analyzeAgency({ ...params, tier });
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "competitor_win_analysis",
    "Analyze a competitor's federal contract wins — awarded contracts, agencies they work with, contract values, NAICS codes, and win patterns. Find out who's winning in your space and what they're doing differently.",
    {
      company: z.string().describe("Company name to analyze (e.g., 'Booz Allen Hamilton', 'SAIC')"),
      naics: z.string().optional().describe("NAICS code to filter wins by"),
      agency: z.string().optional().describe("Agency to filter wins by")
    },
    async (params) => {
      const result = await competitorWinAnalysis({ ...params, tier });
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "set_aside_tracker",
    "Track small business set-aside opportunities across federal agencies — 8(a), HUBZone, SDVOSB, WOSB, and SBA set-asides. Shows trending categories, upcoming deadlines, and agency set-aside spending patterns.",
    {
      set_aside_type: z.string().describe("Set-aside type: '8a', 'HUBZone', 'SDVOSB', 'WOSB', 'SBA', or 'all'"),
      naics: z.string().optional().describe("NAICS code to filter by"),
      agency: z.string().optional().describe("Agency to filter by")
    },
    async (params) => {
      const result = await setAsideTracker({ ...params, tier });
      return { content: [{ type: "text", text: result }] };
    }
  );

  return server;
}

// --- Session management ---
const transports: Record<
  string,
  { transport: WebStandardStreamableHTTPServerTransport; apiKey: string }
> = {};

// --- Bun HTTP server ---
Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        server: "ezbiz-govcon",
        version: "1.0.0",
        uptime: process.uptime(),
        activeSessions: Object.keys(transports).length,
      });
    }

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-API-Key, X-Admin-Secret",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const ADMIN_SECRET = process.env.ADMIN_SECRET;

    // --- API Key Management Endpoints ---
    if (url.pathname === "/api/keys/signup" && req.method === "POST") {
      try {
        const body = await req.json();
        const { name, email } = body;
        if (!email || !name) {
          return Response.json({ error: "name and email required" }, { status: 400, headers: corsHeaders });
        }
        const existing = await getKeyByEmail(email);
        if (existing) {
          return Response.json({
            error: "Email already registered",
            tier: existing.data.tier,
          }, { status: 409, headers: corsHeaders });
        }
        const key = await createApiKey(name, "free", email);
        await log("info", `New free signup: ${email}`, { name });
        return Response.json({ key, tier: "free", limit: TIER_LIMITS.free }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname === "/api/keys/provision" && req.method === "POST") {
      const adminSecret = req.headers.get("x-admin-secret");
      if (adminSecret !== ADMIN_SECRET) {
        return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
      }
      try {
        const body = await req.json();
        const { name, email, tier } = body;
        if (!email || !tier) {
          return Response.json({ error: "email and tier required" }, { status: 400, headers: corsHeaders });
        }
        const existing = await getKeyByEmail(email);
        if (existing) {
          await upgradeKey(email, tier as Tier);
          await log("info", `Upgraded ${email} to ${tier}`, { name });
          return Response.json({
            key: existing.key,
            tier,
            limit: TIER_LIMITS[tier],
            upgraded: true,
          }, { headers: corsHeaders });
        }
        const key = await createApiKey(name || email, tier as Tier, email);
        await log("info", `Provisioned ${tier} key for ${email}`, { name });
        return Response.json({ key, tier, limit: TIER_LIMITS[tier], upgraded: false }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname === "/api/keys/usage" && req.method === "GET") {
      const key = url.searchParams.get("key") || req.headers.get("x-api-key");
      if (!key) {
        return Response.json({ error: "key required" }, { status: 400, headers: corsHeaders });
      }
      const usage = await getKeyUsage(key);
      if (!usage) {
        return Response.json({ error: "Invalid key" }, { status: 404, headers: corsHeaders });
      }
      return Response.json(usage, { headers: corsHeaders });
    }

    if (url.pathname === "/api/pricing") {
      return Response.json({
        tiers: Object.entries(TIER_LIMITS).map(([tier, limit]) => ({
          tier,
          price: TIER_PRICES[tier],
          requestsPerMonth: limit,
        })),
      }, { headers: corsHeaders });
    }

    // MCP endpoint
    if (url.pathname === "/mcp") {
      const apiKey = req.headers.get("x-api-key") || url.searchParams.get("api_key");

      let authResult: { valid: boolean; error?: string; tier?: string; name?: string } = { valid: false };
      let isDiscoveryRequest = false;

      if (req.method === "POST" && !apiKey) {
        try {
          const cloned = req.clone();
          const body = await cloned.json();
          const method = body?.method;
          if (method === "initialize" || method === "tools/list" || method === "notifications/initialized") {
            isDiscoveryRequest = true;
            authResult = { valid: true, tier: "discovery", name: "scanner" };
          }
        } catch {}
      }

      if (!isDiscoveryRequest) {
        authResult = await validateApiKey(apiKey);
      }

      if (!authResult.valid) {
        return Response.json(
          {
            jsonrpc: "2.0",
            error: { code: -32001, message: authResult.error },
            id: null,
          },
          { status: 401 }
        );
      }

      const sessionId = req.headers.get("mcp-session-id");

      if (sessionId && transports[sessionId]) {
        const { transport } = transports[sessionId];

        if (req.method === "POST") {
          try {
            const cloned = req.clone();
            const body = await cloned.json();
            if (body?.method === "tools/call") {
              if (!apiKey) {
                return Response.json(
                  { jsonrpc: "2.0", error: { code: -32001, message: "API key required for tool calls. Get a free key at https://govcon.ezbizservices.com" }, id: body?.id || null },
                  { status: 401 }
                );
              }
              await recordUsage(apiKey);
            }
          } catch {}
        }

        return transport.handleRequest(req);
      }

      if (req.method === "POST") {
        try {
          const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid: string) => {
              transports[sid] = { transport, apiKey: apiKey || "" };
              log("info", `New MCP session: ${sid}`, {
                tier: authResult.tier,
                name: authResult.name,
              });
            },
            onsessionclosed: (sid: string) => {
              delete transports[sid];
              log("info", `Session closed: ${sid}`);
            },
            enableJsonResponse: true,
          });

          const mcpServer = createMcpServer(authResult.tier || "free");
          await mcpServer.connect(transport);

          if (apiKey) await recordUsage(apiKey);

          return transport.handleRequest(req);
        } catch (err: any) {
          await log("error", `MCP init error: ${err.message}`, { stack: err.stack });
          return Response.json(
            {
              jsonrpc: "2.0",
              error: { code: -32603, message: "Internal server error" },
              id: null,
            },
            { status: 500 }
          );
        }
      }

      return Response.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad request: send a POST with initialize to start a session.",
          },
          id: null,
        },
        { status: 400 }
      );
    }

    // Static files
    if (url.pathname.startsWith("/static/") || url.pathname.startsWith("/.well-known/")) {
      const staticRes = await serveStatic(url.pathname);
      if (staticRes) return staticRes;
    }

    // Pages
    const PAGE_ROUTES: Record<string, string> = {
      "/": "index.html",
      "/docs": "docs.html",
      "/signup": "signup.html",
      "/pricing": "pricing.html",
      // {{EXTRA_ROUTES}}
    };

    const pageName = PAGE_ROUTES[url.pathname];
    if (pageName) {
      try {
        const html = await loadPage(pageName);
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      } catch (err: any) {
        await log("error", `Page load error: ${pageName} - ${err.message}`);
        return new Response("Page not found", { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`MCP Government Contracting Intelligence server running on port ${PORT}`);

process.on("SIGINT", async () => {
  console.log("Shutting down...");
  for (const sid in transports) {
    try {
      await transports[sid].transport.close();
    } catch {}
    delete transports[sid];
  }
  process.exit(0);
});
