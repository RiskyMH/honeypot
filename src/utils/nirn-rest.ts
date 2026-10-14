import {
    DiscordAPIError,
    HTTPError,
    REST,
    parseResponse,
    type InternalRequest,
    type RequestData,
    type ResponseLike,
    type RESTOptions,
    type RouteLike,
} from "@discordjs/rest";

/**
 * Options for {@link NirnRest} / {@link createRest}.
 */
export interface NirnRestOptions extends Partial<RESTOptions> {
    /**
     * Base URL of the nirn-proxy instance, e.g. `http://nirn-proxy:8080`.
     * Falls back to the `NIRN_PROXY_URL` environment variable when omitted.
     * When neither is set, no proxy is used (see {@link createRest}).
     */
    proxyUrl?: string | null;
}

/** Same normalization as upstream: number -> exponential backoff, function -> as returned (`null` = give up). */
function normalizeBackoff(
    retryBackoff: RESTOptions["retryBackoff"],
    route: string,
    statusCode: number | null,
    retryCount: number,
    body: unknown,
): number | null {
    if (typeof retryBackoff === "number") return Math.max(0, retryBackoff) * 2 ** retryCount;
    return retryBackoff(route, statusCode, retryCount, body);
}

/**
 * Drop-in replacement for `REST` from `@discordjs/rest` that sends traffic
 * through a [nirn-proxy](https://github.com/davfsa/nirn-proxy) instance instead
 * of discord directly.
 *
 * It extends `REST`, so it satisfies the `rest: REST` parameter that
 * `@discordjs/core/http-only`'s `API` (and `Client`) expect — no call-site type
 * changes needed. Request building (auth headers, query, reason, files, …),
 * `cdn`, and `setToken` are all inherited; only the transport is overridden to
 * point at the proxy. Ratelimit queueing is nirn-proxy's job — this class does
 * none of that — but retryable failures (network errors, 429s, 5xx, proxy 408s)
 * are retried per the `retries` / `retryBackoff` options.
 *
 * Error semantics match `@discordjs/rest` so existing
 * `instanceof DiscordAPIError` checks keep working.
 */
export class NirnRest extends REST {
    readonly proxyUrl: string;

    constructor(token: string, proxyUrl: string, options: Partial<RESTOptions> = {}) {
        super({
            ...options,

            // nirn is transparent: discord.com/api/v10/<route> -> <proxy>/api/v10/<route>
            api: `${proxyUrl.replace(/\/+$/, "")}/api`,
            // we never create local handlers/hashes, don't bother sweeping
            handlerSweepInterval: 0,
            hashSweepInterval: 0,
        });
        this.proxyUrl = proxyUrl.replace(/\/+$/, "");
        this.setToken(token);
    }

    override async queueRequest(request: InternalRequest): Promise<ResponseLike> {
        // `resolveRequest` is TS-private upstream but a normal method at runtime
        const { resolveRequest } = this as unknown as {
            resolveRequest(req: InternalRequest): Promise<{ url: string; fetchOptions: never }>;
        };
        const { url, fetchOptions } = await resolveRequest.call(this, request);
        const method = (fetchOptions as { method?: string }).method ?? request.method;

        let attempt = 0;
        for (;;) {
            let res: ResponseLike;
            try {
                res = await this.options.makeRequest(url, { ...(fetchOptions as object), signal: request.signal } as never);
            } catch (error) {
                // network failure / abort: retry per `retries` + `retryBackoff` (`statusCode: null`)
                if (attempt < this.options.retries) {
                    const backoff = normalizeBackoff(this.options.retryBackoff, request.fullRoute, null, attempt, request.body);
                    if (backoff === null) throw error;
                    if (backoff > 0) await Bun.sleep(backoff);
                    attempt++;
                    continue;
                }
                throw error;
            }

            if (res.ok) return res;

            // retryable: 429s (proxy only returns them in edge cases), 5xx,
            // and proxy-specific 408s (discord slow / request aborted).
            // exhausted retries (or `null` backoff) fall through to the error shaping below.
            if (
                (res.status === 429 || (res.status >= 500 && res.status < 600) || res.status === 408) &&
                attempt < this.options.retries
            ) {
                const backoff = normalizeBackoff(this.options.retryBackoff, request.fullRoute, res.status, attempt, request.body);
                if (backoff !== null) {
                    if (backoff > 0) await Bun.sleep(backoff);
                    attempt++;
                    continue;
                }
            }

            const data = (await parseResponse(res).catch(() => null)) as Record<string, unknown> | null;
            const isDiscordError = data !== null && typeof data === "object" && "code" in data;
            if (isDiscordError) {
                throw new DiscordAPIError(data as never, data["code"] as number, res.status, method, url, request);
            }
            throw new HTTPError(res.status, res.statusText, method, url, request);
        }
    }
}

/**
 * Create a `REST` instance that routes through nirn-proxy when `NIRN_PROXY_URL`
 * (or `options.proxyUrl`) is set, and behaves like a plain `REST` otherwise.
 * The return type is `REST`, so it plugs straight into `new API(rest)` /
 * `new Client({ rest, ... })`.
 */
export function createRest(token: string, options: NirnRestOptions = {}): REST {
    const { proxyUrl, ...restOptions } = options;
    const resolved = proxyUrl ?? process.env.NIRN_PROXY_URL ?? null;
    if (resolved) return new NirnRest(token, resolved, restOptions);
    return new REST(restOptions).setToken(token);
}

export type { RequestData, RouteLike };
