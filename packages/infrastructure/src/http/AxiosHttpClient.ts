import { type AxiosInstance, type AxiosRequestConfig } from "axios";
import z from "zod";
import { createPageableResponseSchema } from "./pagedSearch";
import { type PageableParams, type PageableResponse } from "./pagination";

export type HttpEndpointResolver = (base: string, ...segments: (number | string)[]) => string;

export function resolveHttpEndpoint(base: string, ...segments: (number | string)[]): string {
  const normalizedBase = base.replace(/^\/+|\/+$/g, "");
  const normalizedSegments = segments.map(segment => String(segment).replace(/^\/+|\/+$/g, "")).filter(Boolean);

  return `/${[normalizedBase, ...normalizedSegments].filter(Boolean).join("/")}`;
}

export function parseHttpResponse<TSchema extends z.ZodTypeAny>(schema: TSchema, data: unknown): z.infer<TSchema> {
  return schema.parse(data);
}

export abstract class AxiosHttpClient {
  constructor(
    private readonly base: string,
    private readonly client: AxiosInstance,
    private readonly resolveEndpoint: HttpEndpointResolver = resolveHttpEndpoint,
  ) {}

  protected httpGet<TSchema extends z.ZodTypeAny = z.ZodUnknown>(schema?: TSchema) {
    return async (url: string, config?: AxiosRequestConfig): Promise<z.infer<TSchema>> => {
      const data = await this.doGet(url, config);
      return parseHttpResponse(schema ?? z.unknown(), data) as z.infer<TSchema>;
    };
  }

  protected httpGetBlob() {
    return async (url: string, config?: AxiosRequestConfig): Promise<Blob> => {
      const response = await this.client.get<Blob>(this.resolveEndpoint(this.base, url), {
        ...config,
        responseType: "blob",
      });
      return response.data;
    };
  }

  protected httpGetPageable<TSchema extends z.ZodTypeAny = z.ZodUnknown>(schema?: TSchema) {
    return async (
      url: string,
      pageable: PageableParams,
      config?: AxiosRequestConfig,
    ): Promise<PageableResponse<z.infer<TSchema>>> => {
      const response = await this.doGetPageable(url, pageable, config);
      return parseHttpResponse(createPageableResponseSchema(schema ?? z.unknown()), response) as PageableResponse<
        z.infer<TSchema>
      >;
    };
  }

  protected httpPost<TSchema extends z.ZodTypeAny = z.ZodUnknown>(schema?: TSchema) {
    return async (url: string, data?: unknown, config?: AxiosRequestConfig): Promise<z.infer<TSchema>> => {
      const responseData = await this.doPost(url, data, config);
      return parseHttpResponse(schema ?? z.unknown(), responseData) as z.infer<TSchema>;
    };
  }

  protected httpPut<TSchema extends z.ZodTypeAny = z.ZodUnknown>(schema?: TSchema) {
    return async (url: string, data?: unknown, config?: AxiosRequestConfig): Promise<z.infer<TSchema>> => {
      const responseData = await this.doPut(url, data, config);
      return parseHttpResponse(schema ?? z.unknown(), responseData) as z.infer<TSchema>;
    };
  }

  protected httpPatch<TSchema extends z.ZodTypeAny = z.ZodUnknown>(schema?: TSchema) {
    return async (url: string, data?: unknown, config?: AxiosRequestConfig): Promise<z.infer<TSchema>> => {
      const responseData = await this.doPatch(url, data, config);
      return parseHttpResponse(schema ?? z.unknown(), responseData) as z.infer<TSchema>;
    };
  }

  protected httpDelete<TSchema extends z.ZodTypeAny = z.ZodUnknown>(schema?: TSchema) {
    return async (url: string, config?: AxiosRequestConfig): Promise<z.infer<TSchema>> => {
      const responseData = await this.doDelete(url, config);
      return parseHttpResponse(schema ?? z.unknown(), responseData) as z.infer<TSchema>;
    };
  }

  private async doGet<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get<T>(this.resolveEndpoint(this.base, url), config);
    return response.data;
  }

  private async doGetPageable<T>(
    url: string,
    pageable: PageableParams,
    config?: AxiosRequestConfig,
  ): Promise<PageableResponse<T>> {
    const response = await this.client.get<PageableResponse<T>>(this.resolveEndpoint(this.base, url), {
      ...config,
      params: {
        ...pageable,
        ...config?.params,
      },
    });
    return response.data;
  }

  private async doPost<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.post<T>(this.resolveEndpoint(this.base, url), data, config);
    return response.data;
  }

  private async doPut<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.put<T>(this.resolveEndpoint(this.base, url), data, config);
    return response.data;
  }

  private async doPatch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.patch<T>(this.resolveEndpoint(this.base, url), data, config);
    return response.data;
  }

  private async doDelete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete<T>(this.resolveEndpoint(this.base, url), config);
    return response.data;
  }
}
