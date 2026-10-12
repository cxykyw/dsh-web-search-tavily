# dsh-tavily-cxykyw

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-tavily-cxykyw"><img src="https://img.shields.io/npm/v/dsh-tavily-cxykyw" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/dsh-tavily-cxykyw"><img src="https://img.shields.io/npm/dm/dsh-tavily-cxykyw" alt="npm downloads"></a>
  <a href="https://github.com/cxykyw/dsh-web-search-tavily/blob/main/LICENSE"><img src="https://img.shields.io/github/license/cxykyw/dsh-web-search-tavily" alt="License"></a>
</p>

[English](README.md) | [中文](README.zh.md)

A [Tavily](https://tavily.com)-backed `WebSearchProvider` for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web capability seam (`ctx.web`).

It routes the built-in `web_search` tool to Tavily's dedicated search API instead of the shipped DeepSeek model-based search channel, so **a search costs no model tokens** and the result set comes from a real search engine index rather than an auxiliary model request.

Verified against DSH `0.2.0-rc.2`.

> Package name note: `dsh-web-search-tavily` on npm belongs to another author. This plugin is published as **`dsh-tavily-cxykyw`**; the GitHub repository is still `cxykyw/dsh-web-search-tavily`.

## What it does

- registers a search provider with the stable id **`tavily`** on `ctx.web`;
- maps Tavily's response to DSH's normalized `WebSearchResult` — `results[].url/title/content` become `sources[].url/title/snippet`, and Tavily's optional `answer` becomes the result `content`;
- resolves the API key on **every** search, in this order: literal `apiKey` → credentials service (`~/.dsh/.credentials.yaml`) → launch environment / `process.env`;
- `available()` is a cheap local check (key + base URL present) with no network calls — a missing key surfaces as `WEB_PROVIDER_CREDENTIAL_MISSING` at search time;
- then truncates to `request.maxResults` through the seam, exactly like any other provider.

## Install

```sh
dsh plugin --profile web add dsh-tavily-cxykyw
```

If your DSH profile is a pnpm workspace root (the default `~/.dsh/profiles/web` is), the add must target the workspace root:

```sh
dsh plugin --profile web add dsh-tavily-cxykyw -w
```

The bundled `cordis.patch.yml` declares `dsh.bundle.patch`, so adding the package also registers it as a profile bundle: the provider row is inserted **and** `web.searchProvider` is set to `tavily` for you. Restart `dsh web` afterwards — bundle changes are not hot-reloaded.

From a checkout instead of npm:

```sh
git clone https://github.com/cxykyw/dsh-web-search-tavily.git
dsh plugin --profile web add link:/absolute/path/to/dsh-web-search-tavily -w
```

## Configure the API key

Get a key at [app.tavily.com](https://app.tavily.com) (there is a free tier). Then pick **one** of:

**1. Credentials file (recommended — outside every repository):**

```yaml
# ~/.dsh/.credentials.yaml
TAVILY_API_KEY: tvly-xxxxxxxxxxxxxxxx
```

**2. Environment variable** of the process that launches DSH:

```sh
TAVILY_API_KEY=tvly-xxxxxxxxxxxxxxxx dsh web
```

**3. Literal key in your own profile patch** (works, but keeps the secret in a plain file — prefer 1 or 2):

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: web-search-tavily
  config:
    apiKey: tvly-xxxxxxxxxxxxxxxx
```

> **Never commit an API key.** This repository, its `cordis.patch.yml`, and its published npm tarball contain **no** credentials and no default key: the plugin only ever reads them from your machine at search time. `.gitignore` also excludes `.env*`, `.npmrc`, and `*.local.yml`.

## Options

Configurable on the inserted `web-search-tavily` row:

| Option | Default | Description |
| --- | --- | --- |
| `apiKey` | — | Literal Tavily API key. Prefer `apiKeyEnv` + credentials/env. |
| `apiKeyEnv` | `TAVILY_API_KEY` | Credential reference / environment variable name to resolve the key from. |
| `baseURL` | `https://api.tavily.com` | Tavily API base URL (point it at a proxy if you need one). |
| `searchDepth` | `basic` | `basic` (fast, 1 credit) or `advanced` (deeper crawl, more credits). |
| `maxResults` | `8` | Results requested per search, 1–20. A per-call `maxResults` still wins. |

Example, overriding just the depth and result count:

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: web-search-tavily
  config:
    searchDepth: advanced
    maxResults: 5
```

## Switching providers

The bundle patch already pins the seam:

```yaml
- id: web
  config:
    searchProvider: tavily
    fetchProvider: http
```

To fall back to the official DeepSeek search, set `searchProvider: deepseek-official` (or remove the line only if `deepseek-official` is the single usable provider — with two usable providers and no pin, the seam fails closed with `WEB_PROVIDER_AMBIGUOUS`).

> Upgrading from a hand-inserted copy in your own profile patch? Delete that `insert` block and keep only the `- id: web-search-tavily` config override above, otherwise the row id is inserted twice.

## Notes and limitations

- No Web settings page: DSH `0.2` cannot mount this plugin's settings section, so the provider is configured through the profile patch only.
- `fetch` (page retrieval) is untouched — it stays on `@deepseek-ai/dsh-web-fetch-http`.
- Tavily search results carry no publication date, so `sources[].publishedAt` is not set.

## Uninstall

```sh
dsh plugin --profile web remove dsh-tavily-cxykyw -w
```

## License

MIT © cxykyw
