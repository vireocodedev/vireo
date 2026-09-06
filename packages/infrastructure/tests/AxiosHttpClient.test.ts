import { AxiosHttpClient, resolveHttpEndpoint } from "@/index";
import { type AxiosInstance } from "axios";
import { describe, expect, it, vi } from "vitest";
import z from "zod";

function createClient() {
  const transport = {
    delete: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  } as unknown as AxiosInstance;

  class TestHttpClient extends AxiosHttpClient {
    constructor() {
      super("widgets", transport);
    }

    getWidget = this.httpGet(z.object({ id: z.number() }));
    getWidgets = this.httpGetPageable(z.object({ id: z.number() }));
    getBlob = this.httpGetBlob();
    postWidget = this.httpPost(z.object({ id: z.number() }));
    putWidget = this.httpPut(z.object({ id: z.number() }));
    patchWidget = this.httpPatch(z.object({ id: z.number() }));
    deleteWidget = this.httpDelete(z.object({ deleted: z.boolean() }));
  }

  return { client: new TestHttpClient(), transport };
}

describe("AxiosHttpClient", () => {
  it("uses the injected transport and validates CRUD responses", async () => {
    const { client, transport } = createClient();
    vi.mocked(transport.get).mockResolvedValueOnce({ data: { id: 1 } });
    vi.mocked(transport.post).mockResolvedValueOnce({ data: { id: 2 } });
    vi.mocked(transport.put).mockResolvedValueOnce({ data: { id: 3 } });
    vi.mocked(transport.patch).mockResolvedValueOnce({ data: { id: 4 } });
    vi.mocked(transport.delete).mockResolvedValueOnce({ data: { deleted: true } });

    await expect(client.getWidget("1", { timeout: 500 })).resolves.toEqual({ id: 1 });
    await expect(client.postWidget("", { name: "new" })).resolves.toEqual({ id: 2 });
    await expect(client.putWidget("3", { name: "updated" })).resolves.toEqual({ id: 3 });
    await expect(client.patchWidget("3", { name: "patched" })).resolves.toEqual({ id: 4 });
    await expect(client.deleteWidget("3")).resolves.toEqual({ deleted: true });
    expect(transport.get).toHaveBeenCalledWith("/widgets/1", { timeout: 500 });
    expect(transport.post).toHaveBeenCalledWith("/widgets", { name: "new" }, undefined);
    expect(transport.patch).toHaveBeenCalledWith("/widgets/3", { name: "patched" }, undefined);
  });

  it("merges pageable parameters, handles blobs, and rejects invalid payloads", async () => {
    const { client, transport } = createClient();
    vi.mocked(transport.get)
      .mockResolvedValueOnce({
        data: { content: [{ id: 4 }], number: 1, size: 20, totalElements: 24, totalPages: 2 },
      })
      .mockResolvedValueOnce({ data: new Blob(["pdf"]) })
      .mockResolvedValueOnce({ data: { id: "invalid" } });

    await expect(
      client.getWidgets(
        "search",
        { page: 1, rowsPerPage: 20, sortBy: "id", sortDirection: "asc" },
        {
          params: { locale: "hr" },
        },
      ),
    ).resolves.toMatchObject({ content: [{ id: 4 }], totalPages: 2 });
    await expect(client.getBlob("4/pdf", { signal: undefined })).resolves.toBeInstanceOf(Blob);

    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(client.getWidget("invalid")).rejects.toBeInstanceOf(z.ZodError);
    expect(errorLog).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });
});

describe("resolveHttpEndpoint", () => {
  it("normalizes base and path separators", () => {
    expect(resolveHttpEndpoint("/widgets/", "/12/", "details")).toBe("/widgets/12/details");
    expect(resolveHttpEndpoint("widgets", "")).toBe("/widgets");
  });
});
