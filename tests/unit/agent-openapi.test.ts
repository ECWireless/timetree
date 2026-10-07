import { describe, expect, it } from "vitest";

import { GET } from "../../src/app/api/agent/v1/openapi.json/route";
import { timeTreeAgentOpenApiDocument } from "../../src/lib/agent/openapi";

describe("agent OpenAPI description", () => {
  it("documents the complete route surface and access-level boundary", () => {
    expect(timeTreeAgentOpenApiDocument).toMatchObject({
      openapi: "3.1.2",
      servers: [{ url: "/api/agent/v1" }],
      security: [{ bearerAuth: [] }],
      paths: {
        "/openapi.json": {
          get: { tags: ["Documentation"], security: [] },
        },
        "/tree": { get: { tags: ["Read"] } },
        "/report": { get: { tags: ["Read"] } },
        "/nodes": {
          post: {
            tags: ["Write"],
            responses: { "403": expect.any(Object) },
          },
        },
        "/nodes/{nodeId}/timer": {
          put: {
            tags: ["Write"],
            responses: { "403": expect.any(Object) },
          },
          delete: {
            tags: ["Write"],
            responses: { "403": expect.any(Object) },
          },
        },
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "ttk_v2",
          },
        },
      },
    });

    const serialized = JSON.stringify(timeTreeAgentOpenApiDocument);
    expect(serialized).toMatch(/read-only keys/i);
    expect(serialized).toContain("insufficient-scope");
    expect(serialized).toContain("Legacy ttk_v1");
    expect(serialized).not.toMatch(/ttk_v[12]\.[0-9a-f]{8}-/);
    expect(serialized).not.toContain("secretHash");
  });

  it("serves the public description as cacheable JSON", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=3600",
    );
    await expect(response.json()).resolves.toEqual(
      timeTreeAgentOpenApiDocument,
    );
  });
});
