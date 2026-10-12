# dsh-tavily-cxykyw

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-tavily-cxykyw"><img src="https://img.shields.io/npm/v/dsh-tavily-cxykyw" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/dsh-tavily-cxykyw"><img src="https://img.shields.io/npm/dm/dsh-tavily-cxykyw" alt="npm downloads"></a>
  <a href="https://github.com/cxykyw/dsh-web-search-tavily/blob/main/LICENSE"><img src="https://img.shields.io/github/license/cxykyw/dsh-web-search-tavily" alt="License"></a>
</p>

[English](README.md) | [中文](README.zh.md)

基于 [Tavily](https://tavily.com) 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 搜索 Provider，挂在 web 能力接缝 `ctx.web` 上。

它把内置的 `web_search` 工具从官方「模型请求式」搜索通道切到 Tavily 的专用搜索接口：**搜索不消耗模型 token**，结果来自真正的搜索索引，而不是一次附带检索的辅助模型调用。

已按 DSH `0.2.0-rc.2` 验证。

> 包名说明：npm 上的 `dsh-web-search-tavily` 属于另一位作者（mubibai），本插件以 **`dsh-tavily-cxykyw`** 发布；GitHub 仓库仍为 `cxykyw/dsh-web-search-tavily`。

## 它做了什么

- 在 `ctx.web` 上注册固定 id 为 **`tavily`** 的搜索 provider；
- 把 Tavily 响应映射为 DSH 标准化的 `WebSearchResult`：`results[].url/title/content` → `sources[].url/title/snippet`，Tavily 的 `answer` 作为结果 `content`；
- **每次搜索都重新解析密钥**，顺序为：字面量 `apiKey` → 凭据服务（`~/.dsh/.credentials.yaml`）→ 启动环境 / `process.env`；
- `available()` 只做本地廉价检查（有没有 key、baseURL 合法不合法），不发网络请求；缺密钥时在搜索阶段报 `WEB_PROVIDER_CREDENTIAL_MISSING`；
- 结果条数最终由接缝按 `request.maxResults` 截断，与其他 provider 行为一致。

## 安装

```sh
dsh plugin --profile web add dsh-tavily-cxykyw
```

如果 profile 是 pnpm workspace 根（默认的 `~/.dsh/profiles/web` 就是），必须指定根：

```sh
dsh plugin --profile web add dsh-tavily-cxykyw -w
```

包内 `cordis.patch.yml` 声明了 `dsh.bundle.patch`，所以加入依赖时会同时把它注册成 profile bundle：自动插入 provider 行，并把 `web.searchProvider` 指向 `tavily`。装完需**重启 `dsh web`**——bundle 变化不会热更新。

从源码安装（不走 npm）：

```sh
git clone https://github.com/cxykyw/dsh-web-search-tavily.git
dsh plugin --profile web add link:/绝对路径/dsh-web-search-tavily -w
```

## 配置 API Key

到 [app.tavily.com](https://app.tavily.com) 申请（有免费额度）。以下三种方式**任选一种**：

**1. 凭据文件（推荐，天然在仓库之外）：**

```yaml
# ~/.dsh/.credentials.yaml
TAVILY_API_KEY: tvly-xxxxxxxxxxxxxxxx
```

**2. 环境变量**（给启动 DSH 的进程）：

```sh
TAVILY_API_KEY=tvly-xxxxxxxxxxxxxxxx dsh web
```

**3. 写在自己的 profile patch 里**（能跑，但密钥会落在明文配置里，优先用 1 或 2）：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: web-search-tavily
  config:
    apiKey: tvly-xxxxxxxxxxxxxxxx
```

> **千万不要把 API Key 提交进仓库。** 本仓库、仓库里的 `cordis.patch.yml`、以及发布到 npm 的压缩包中**不含任何密钥**，也没有默认密钥：插件只在搜索时从你本机读取。`.gitignore` 已排除 `.env*`、`.npmrc`、`*.local.yml`。

## 配置项

在插入的 `web-search-tavily` 行上配置：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `apiKey` | — | 字面量 Tavily API Key。更推荐 `apiKeyEnv` + 凭据/环境变量。 |
| `apiKeyEnv` | `TAVILY_API_KEY` | 从哪个凭据引用 / 环境变量解析密钥。 |
| `baseURL` | `https://api.tavily.com` | Tavily API 地址（需要走代理时可改）。 |
| `searchDepth` | `basic` | `basic`（快，1 积分）或 `advanced`（更深抓取，更费积分）。 |
| `maxResults` | `8` | 每次请求条数，1–20；单次调用的 `maxResults` 仍然优先。 |

只改深度和条数的例子：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: web-search-tavily
  config:
    searchDepth: advanced
    maxResults: 5
```

## 切换 Provider

bundle 补丁已经帮你钉住：

```yaml
- id: web
  config:
    searchProvider: tavily
    fetchProvider: http
```

想退回官方 DeepSeek 搜索，把 `searchProvider` 改成 `deepseek-official`；只有在 `deepseek-official` 是**唯一可用** provider 时才可以直接删掉这行——两个都可用且不指定时，接缝会以 `WEB_PROVIDER_AMBIGUOUS` 失败关闭。

> 从「手工 insert」升级过来？请删掉你自己 patch 里的那段 `insert`，只保留上面这种 `- id: web-search-tavily` 的配置覆盖，否则同一个行 id 会被插入两次。

## 说明与限制

- 没有 Web 设置页：DSH `0.2` 无法挂载本插件的 settings 段，只能通过 profile patch 配置。
- 抓取（`fetch`）不受影响，仍走 `@deepseek-ai/dsh-web-fetch-http`。
- Tavily 搜索结果不含发布日期，因此 `sources[].publishedAt` 不会赋值。

## 卸载

```sh
dsh plugin --profile web remove dsh-tavily-cxykyw -w
```

## License

MIT © cxykyw
