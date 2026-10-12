/**
 * @module dsh-tavily-cxykyw
 * 
 * A Tavily-backed WebSearchProvider for the DSH web capability seam (ctx.web).
 * 
 * This plugin registers a search provider that uses Tavily's search API,
 * which is a dedicated search endpoint (unlike DeepSeek's model-call approach).
 * 
 * Tavily API: POST https://api.tavily.com/search
 * Request: { api_key, query, search_depth?, include_answer?, max_results?, ... }
 * Response: { answer?, query, results: [{ title, url, content, score, ... }] }
 * 
 * Repository: https://github.com/cxykyw/dsh-web-search-tavily
 * No credentials are stored in this file: the API key is resolved per search
 * from the literal config, the credentials service, or the environment.
 */

import z from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import { WebError } from '@deepseek-ai/dsh-web';

/** Stable id this provider registers under. */
const TAVILY_PROVIDER_ID = 'tavily';

/** Default Tavily API endpoint. */
const TAVILY_DEFAULT_BASE_URL = 'https://api.tavily.com';

/** Default search depth: 'basic' is faster, 'advanced' is more thorough. */
const TAVILY_DEFAULT_SEARCH_DEPTH = 'basic';

/** Default max results to request from Tavily. */
const TAVILY_DEFAULT_MAX_RESULTS = 8;

/** Attribution header sent on every request. */
const USER_AGENT = 'deepseek-harness-tavily/0.1.0';

/**
 * Map Tavily API response to DSH's normalized WebSearchResult format.
 * 
 * @param {object} data - The parsed Tavily API response.
 * @returns {import('@deepseek-ai/dsh-web').WebSearchResult}
 */
function mapTavilyResponse(data) {
  const sources = [];
  const seen = new Set();

  if (Array.isArray(data.results)) {
    for (const result of data.results) {
      if (!result.url || seen.has(result.url)) continue;
      seen.add(result.url);

      sources.push({
        url: result.url,
        ...(result.title ? { title: result.title } : {}),
        ...(result.content ? { snippet: result.content } : {}),
        // Tavily doesn't provide published date in search results
      });
    }
  }

  return {
    // Include Tavily's AI-generated answer as content if available
    ...(data.answer ? { content: data.answer } : {}),
    sources,
    truncated: false,
  };
}

/**
 * The Tavily-backed search provider.
 * 
 * Implements the WebSearchProvider interface:
 * - id: string
 * - available(): boolean (cheap local check, no network calls)
 * - search(request, signal?): Promise<WebSearchResult>
 */
class TavilySearchProvider {
  #resolveOptions;

  id = TAVILY_PROVIDER_ID;

  /**
   * @param {() => object} resolveOptions - Thunk that returns current options.
   */
  constructor(resolveOptions) {
    this.#resolveOptions = resolveOptions;
  }

  /**
   * Cheap local usability check. Must not make network calls.
   * Checks if we have an API key configured and a valid base URL.
   */
  available() {
    const options = this.#resolveOptions();
    const hasApiKey = (options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined;
    const hasValidUrl = URL.canParse(options.baseURL);
    return hasApiKey && hasValidUrl;
  }

  /**
   * Execute a search via Tavily API.
   * 
   * @param {import('@deepseek-ai/dsh-web').WebSearchRequest} request
   * @param {AbortSignal} [signal]
   * @returns {Promise<import('@deepseek-ai/dsh-web').WebSearchResult>}
   */
  async search(request, signal) {
    const options = this.#resolveOptions();
    const apiKey = await this.#apiKey(options, signal);
    throwIfSearchAborted(signal);

    const endpoint = `${options.baseURL}/search`;
    const body = {
      api_key: apiKey,
      query: request.query,
      search_depth: options.searchDepth,
      include_answer: true,
      include_raw_content: false,
      max_results: request.maxResults ?? options.maxResults,
    };

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...(signal !== undefined ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) {
        throw searchAborted(signal, error);
      }
      throw new WebError(
        `Tavily search request failed: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error }
      );
    }

    if (!response.ok) {
      let message = `Tavily API error (HTTP ${response.status})`;
      try {
        const parsed = await response.json();
        const detail = parsed.error?.message ?? parsed.message ?? parsed.detail;
        if (detail !== undefined && detail.length > 0) {
          message = typeof detail === 'string' ? detail : JSON.stringify(detail);
        }
      } catch {
        // Ignore parse errors for error response
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR');
    }

    try {
      const data = await response.json();
      return mapTavilyResponse(data);
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) {
        throw searchAborted(signal, error);
      }
      if (error instanceof WebError) throw error;
      throw new WebError(
        `Tavily returned an unprocessable response body: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error }
      );
    }
  }

  /**
   * Resolve the API key for one operation.
   * 
   * @param {object} options
   * @param {AbortSignal} [signal]
   * @returns {Promise<string>}
   */
  async #apiKey(options, signal) {
    throwIfSearchAborted(signal);

    // Prefer literal API key if provided
    if (options.apiKey !== undefined && options.apiKey.length > 0) {
      return options.apiKey;
    }

    // Otherwise resolve via credentials or environment
    let resolved;
    try {
      resolved = await abortable(
        options.resolveApiKey?.() ?? Promise.resolve(undefined),
        signal
      );
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) {
        throw searchAborted(signal, error);
      }
      throw new WebError(
        `Tavily search credential resolution failed: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error }
      );
    }

    if (resolved !== undefined && resolved.length > 0) {
      return resolved;
    }

    throw new WebError(
      `Tavily search has no API key for "${options.apiKeyEnv ?? 'TAVILY_API_KEY'}"; ` +
      `set the TAVILY_API_KEY environment variable, or configure apiKey in the provider config`,
      'WEB_PROVIDER_CREDENTIAL_MISSING'
    );
  }
}

// ─── Helper functions ────────────────────────────────────────────────────────

/**
 * Race an async operation against caller cancellation.
 */
function abortable(operation, signal) {
  if (signal === undefined) return operation;
  if (signal.aborted) return Promise.reject(searchAborted(signal));

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(searchAborted(signal));
    signal.addEventListener('abort', onAbort, { once: true });

    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(new Error(String(error).replace(/^Error: /u, ''), { cause: error }));
      }
    );
  });
}

/** Throw if the caller already aborted. */
function throwIfSearchAborted(signal) {
  if (signal?.aborted === true) throw searchAborted(signal);
}

/** Build the provider's stable cancellation error. */
function searchAborted(signal, fallback) {
  return new WebError(
    'Tavily search aborted',
    'WEB_ABORTED',
    { cause: signal?.aborted === true ? signal.reason : fallback }
  );
}

/** Check if an error is a fetch/AbortSignal abort. */
function isAbortError(error) {
  return error instanceof DOMException && error.name === 'AbortError';
}

// ─── Cordis plugin exports ───────────────────────────────────────────────────

/** Plugin name for cordis loader. */
export const name = 'web-search-tavily';

/** Inject into the web seam. */
export const inject = ['web'];

/** Default environment variable name for the API key. */
const DEFAULT_API_KEY_ENV = 'TAVILY_API_KEY';

/** Settings namespace for the Tavily provider. */
const WEB_SEARCH_TAVILY_SETTINGS_NAMESPACE = 'web-search-tavily';

/**
 * Zod schema for the provider config.
 * This defines what fields can be configured via settings.
 */
export const Config = z.object({
  /** Literal API key (optional, prefer apiKeyEnv). */
  apiKey: z.string().role('secret'),
  /** Environment variable or credential reference for the API key. */
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  /** Tavily API base URL. */
  baseURL: z.string().default(TAVILY_DEFAULT_BASE_URL),
  /** Search depth: 'basic' is faster, 'advanced' is more thorough. */
  searchDepth: z.union(['basic', 'advanced']).default(TAVILY_DEFAULT_SEARCH_DEPTH),
  /** Default max results to request. */
  maxResults: z.natural().min(1).max(20).default(TAVILY_DEFAULT_MAX_RESULTS),
});

/**
 * Resolve options from config and environment.
 * This is called per-operation to pick up config changes.
 */
function resolveOptions(ctx, config) {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV);
  const literalApiKey = config.apiKey?.length > 0 ? config.apiKey : undefined;

  return {
    ...(literalApiKey !== undefined ? { apiKey: literalApiKey } : {}),
    resolveApiKey: async () => {
      // Try to resolve from credentials seam first
      const credentials = ctx.get('credentials');
      if (credentials !== undefined) {
        try {
          const resolved = await credentials.resolve(apiKeyEnv);
          if (resolved?.value?.length > 0) return resolved.value;
        } catch {
          // Credential resolution failed, fall through to environment
        }
      }

      // Fall back to environment variable
      const env = launchEnvironmentOf(ctx);
      const envValue = env.get(apiKeyEnv)?.value;
      if (envValue?.length > 0) return envValue;

      // Also check process.env directly as a last resort
      const processEnvValue = process.env[apiKeyEnv];
      if (processEnvValue?.length > 0) return processEnvValue;

      return undefined;
    },
    apiKeyEnv,
    baseURL: config.baseURL ?? TAVILY_DEFAULT_BASE_URL,
    searchDepth: config.searchDepth ?? TAVILY_DEFAULT_SEARCH_DEPTH,
    maxResults: config.maxResults ?? TAVILY_DEFAULT_MAX_RESULTS,
  };
}

/**
 * Register the Tavily search provider with ctx.web.
 * 
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config
 */
export function apply(ctx, config) {
  // Register the provider (settings section installation skipped — dsh 0.2 incompatible)
  const provider = new TavilySearchProvider(() => resolveOptions(ctx, config));
  ctx.web.registerSearchProvider(provider);
}

// Default export for cordis plugin loader
export default {
  name,
  inject,
  apply,
  Config,
};
