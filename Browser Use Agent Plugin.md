# browser-use Agent Plugin

## V1 最终开发与评审规范

**文档状态：Frozen Development & Review Baseline**
**Plugin 名称：`browser-use`**
**目标 Plugin 版本：1.0.0**
**Agent Plugins Specification：1.0.0**
**Browser Use Runtime 基线：0.13.10**
**Python：3.12**
**MCP Transport：stdio**
**日期基线：2026-09-08**

---

# 1. 项目定义

`browser-use` 是一个符合 Agent Plugins v1 的 Browser Use 适配插件。

它不实现 Browser Runtime，不 fork Browser Use，不实现自己的 CDP 层，也不提供第二套 Browser Agent。

其唯一目的：

> 将 Browser Use 官方 CLI / MCP Runtime 以标准 Agent Plugin 的形式提供给 Agent Host。

最终链路固定为：

```text
Agent
  │
  ▼
Agent Plugin Host
  │
  ▼
browser-use Plugin
  │
  ├── plugin.json
  ├── mcp.json
  └── skills/browser-use/SKILL.md
  │
  ▼
MCP stdio
  │
  ▼
uvx --python 3.12 browser-use@PIN --cli-mcp
  │
  ▼
Browser Use Official MCP
  │
  ├── browser_exec
  └── browser_screenshot
  │
  ▼
Browser Harness
  │
  ▼
CDP
  │
  ▼
External Chrome / Chromium
```

---

# 2. 核心原则

本项目必须长期遵守四条 ownership：

```text
Browser Use
→ owns browser automation

browser-use Plugin
→ owns packaging + usage guidance

Agent Host
→ owns trust + authorization + process isolation

Agent
→ owns reasoning + browser task strategy
```

任何实现如果破坏上述边界，都应视为架构偏离。

---

# 3. 上游优先原则

Browser Use 官方已经提供：

```text
Browser Use CLI
Browser Harness
CDP integration
Chrome connection
Browser lifecycle
Tabs
Accessibility helpers
DOM/JS
Input
Screenshot
MCP server
```

因此本项目禁止重新实现上述能力。

Browser Use 官方当前 Plugin repository 中 `browser-use` 目录主要包含：

```text
browser-use/
├── .claude-plugin/
├── .mcp.json
└── README.md
```

其当前官方 MCP 配置核心就是：

```json
{
  "browser-use": {
    "command": "uvx",
    "args": [
      "--python",
      "3.12",
      "browser-use@latest",
      "--cli-mcp"
    ]
  }
}
```

本项目应把这条官方运行链标准化成 Agent Plugins v1，而不是重新设计。

---

# 4. Agent Plugins 标准基线

Agent Plugins 当前 Published Specification 为 1.0.0。

Plugin 根目录必须包含：

```text
plugin.json
```

Skills 固定从：

```text
skills/<skill>/SKILL.md
```

发现。

MCP 配置固定从：

```text
mcp.json
```

加载。

`mcp.json` 的 stdio server 支持：

```text
type
command
args
env
cwd
```

`${PLUGIN_ROOT}` 和 `${PLUGIN_DATA}` 只能在规范允许的 runtime configuration 字段展开；Client 还必须给 stdio subprocess 提供独立的 `PLUGIN_ROOT` 和持久可写的 `PLUGIN_DATA`。

Plugin 名称：

```text
browser-use
```

符合规范要求的：

```text
a-z
0-9
-
.
```

命名限制。

---

# 5. 项目 Scope

## 5.1 V1 包含

```text
Agent Plugins v1 packaging
Browser Use official CLI
Browser Use official MCP
Browser Use official Skill strategy
stdio MCP
local Chrome / Chromium
existing logged-in browser sessions
Browser Use runtime pinning
PLUGIN_DATA containment
telemetry disable
runtime authorization
runtime isolation
timeout
result bounds
single-task execution
failure recovery
upstream provenance
upstream compatibility testing
```

## 5.2 V1 明确不包含

```text
BrowserTargetRegistry
ExternalBrowserTarget
ExternalBrowserTargetLease
BrowserRouter
BrowserProvider abstraction

Native browser
Playwright
agent-browser
Browserbase abstraction

自研 CDP
自研 Browser Harness
自研 Browser MCP

browser_click
browser_fill
browser_scroll
等二次封装工具

Browser Use Agent reasoning loop

默认 Browser Use Cloud
默认 recordings
Domain Skills
persistent self-modifying browser helpers
```

---

# 6. 最终代码仓库结构

推荐 repository 也直接命名：

```text
browser-use
```

项目结构：

```text
browser-use/
│
├── plugin.json
├── mcp.json
│
├── upstream.lock.json
│
├── skills/
│   └── browser-use/
│       ├── SKILL.md
│       └── references/
│           └── troubleshooting.md
│
├── tests/
│   ├── manifest/
│   ├── mcp/
│   ├── browser/
│   ├── security/
│   └── upstream/
│
├── scripts/
│   ├── verify-upstream.mjs
│   └── verify-runtime-contract.mjs
│
├── README.md
├── CHANGELOG.md
├── LICENSE
└── THIRD_PARTY_NOTICES.md
```

运行时核心仍只有：

```text
plugin.json
mcp.json
SKILL.md
```

`upstream.lock.json` 是 provenance / development artifact，不定义新的 Agent Plugin runtime semantic。

---

# 7. plugin.json

正式 V1 推荐：

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "browser-use",
  "version": "1.0.0",
  "description": "Agent Plugins adapter for the official Browser Use CLI browser runtime.",
  "author": {
    "name": "<ACTUAL_PLUGIN_PUBLISHER>"
  },
  "license": "<PLUGIN_LICENSE>",
  "keywords": [
    "browser",
    "browser-use",
    "automation",
    "cdp",
    "mcp"
  ]
}
```

如果已经存在正式 repository/homepage，可增加：

```json
{
  "homepage": "<PLUGIN_HOMEPAGE>",
  "repository": "<PLUGIN_REPOSITORY>"
}
```

不得填写虚构地址。

---

# 8. Plugin provenance

虽然 Plugin 名称为：

```text
browser-use
```

但它不是当前 Browser Use 官方 `.claude-plugin` package 的原样发行。

因此 metadata 和 README 必须明确：

```text
Runtime upstream:
Browser Use

Portable Agent Plugin adapter maintainer:
<ACTUAL_PLUGIN_PUBLISHER>
```

不得暗示：

> 本 Plugin 是 Browser Use 官方团队发布的 Agent Plugins 包。

除非未来确实由 Browser Use 官方接管发行。

---

# 9. plugin.json 禁止字段

Agent Plugins v1 manifest 是 closed schema。

不要增加：

```json
{
  "runtime": {},
  "permissions": {},
  "dependencies": {},
  "browser": {},
  "installer": {},
  "mcp": {}
}
```

Client-specific 信息只有确实需要时才能进入：

```text
extensions
```

当前 V1 不需要 `extensions`。

---

# 10. Browser Use Runtime 基线

当前 Browser Use 主仓库：

```text
browser-use == 0.13.10
Python >=3.11,<4
browser-harness == 0.1.13
cdp-use == 1.4.5
mcp == 2.1.1
```

V1 固定：

```text
Python 3.12
Browser Use 0.13.10
```

---

# 11. mcp.json

正式 V1：

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "browser-use": {
      "type": "stdio",
      "command": "uvx",
      "args": [
        "--python",
        "3.12",
        "browser-use@0.13.10",
        "--cli-mcp"
      ],
      "env": {
        "BH_HOME": "${PLUGIN_DATA}/browser-harness",
        "BH_AGENT_WORKSPACE": "${PLUGIN_DATA}/agent-workspace",
        "BH_TAB_MARKER": "0",
        "BH_DOMAIN_SKILLS": "0",
        "BH_RECORD": "0",
        "BH_TELEMETRY": "false",
        "BROWSER_HARNESS_TELEMETRY": "false",
        "ANONYMIZED_TELEMETRY": "false"
      },
      "cwd": "${PLUGIN_DATA}"
    }
  }
}
```

---

# 12. 为什么使用 `uvx`

这是 Browser Use 官方 Plugin 当前使用的运行方式。

因此：

```text
Browser Use Python Runtime
Browser Use dependencies
Browser Harness
```

都不需要进入 Plugin package。

Plugin 只是声明：

```text
uvx
→ Browser Use
→ --cli-mcp
```

---

# 13. 为什么不能使用 `@latest`

官方示例当前使用：

```text
browser-use@latest
```

但正式 PluginRevision 必须 reproducible。

否则：

```text
Plugin 1.0.0
今天安装
→ Browser Use A

Plugin 1.0.0
未来安装
→ Browser Use B
```

造成：

```text
same PluginRevision
!=
same Runtime
```

因此 V1 必须：

```text
browser-use@0.13.10
```

CI 必须直接禁止：

```text
@latest
```

---

# 14. Runtime 升级模型

Browser Use runtime 升级必须发布新的 PluginRevision。

例如：

```text
browser-use Plugin 1.0.0
→ Browser Use 0.13.10

browser-use Plugin 1.1.0
→ Browser Use 0.14.x
```

不得静默修改现有 PluginRevision 中的 runtime pin。

---

# 15. upstream.lock.json

必须记录实际经过评审的 upstream identity。

当前推荐基线：

```json
{
  "agentPlugins": {
    "specVersion": "1.0.0"
  },
  "browserUse": {
    "package": "browser-use",
    "version": "0.13.10",
    "pyprojectBlobSha": "5c79c94fef1d1ee831ce85333975cc4288e2b126"
  },
  "browserHarness": {
    "version": "0.1.13"
  },
  "officialPlugin": {
    "repository": "browser-use/plugins",
    "path": "browser-use/.mcp.json",
    "blobSha": "fcaab79089bb4c3a54766e519454d029befc95bc"
  },
  "officialSkill": {
    "repository": "browser-use/browser-use",
    "path": "skills/browser-use/SKILL.md",
    "blobSha": "d47beef3bcdf7ea42275442bb1fdaaf87f9185ed"
  }
}
```

当前 Browser Use pyproject blob SHA 为 `5c79c94...`。

官方 Plugin `.mcp.json` 当前 blob SHA 为 `fcaab790...`。

官方 Browser Use Skill 当前 blob SHA 为 `d47beef3...`。

这些值在 Browser Use 升级评审时一起更新。

---

# 16. upstream.lock 的作用

它回答：

```text
Plugin 参考了哪版 Browser Use？

参考了哪版官方 Plugin？

Skill 是从哪版 upstream 同步的？

Runtime pin 和 source provenance 是否对应？
```

它不参与：

```text
Agent Plugins component discovery
MCP runtime discovery
Skill discovery
```

---

# 17. Browser Harness 数据隔离

Browser Harness 当前支持：

```text
BH_HOME
BROWSER_HARNESS_HOME
BH_CONFIG_DIR
BH_RUNTIME_DIR
BH_TMP_DIR
BH_AGENT_WORKSPACE
```

默认路径如果不覆盖，会落到用户自己的 Browser Harness config area。

所以 Plugin 必须：

```text
BH_HOME=${PLUGIN_DATA}/browser-harness
```

---

# 18. PLUGIN_DATA 目录

运行后预期：

```text
PLUGIN_DATA/
│
├── browser-harness/
│   ├── runtime/
│   ├── tmp/
│   └── configuration/runtime state
│
└── agent-workspace/
```

原则：

```text
PLUGIN_ROOT
→ immutable package

PLUGIN_DATA
→ mutable plugin runtime state
```

Agent Plugins 规范要求 `PLUGIN_DATA` 为每个 installed plugin instance 独立、可写、Client-managed，并在更新间保持。

---

# 19. Telemetry 必须默认关闭

这是 P0。

Browser Harness 当前 telemetry 是 opt-out。

Telemetry 实现可以发送：

```text
runtime/version information
command/action information
task
output
steps
duration
errors
```

并发送到 PostHog endpoint。

虽然实现有 redaction/filtering，但对于：

```text
用户真实 Chrome
登录后的 SaaS
企业后台
个人账号
```

生产 Plugin 不应默认依赖上游 telemetry policy。

因此显式：

```text
BH_TELEMETRY=false
BROWSER_HARNESS_TELEMETRY=false
ANONYMIZED_TELEMETRY=false
```

---

# 20. Recordings 默认关闭

设置：

```text
BH_RECORD=0
```

Browser recording 可能捕获：

```text
个人页面
消息
账号内容
表单
内部系统
企业数据
```

因此 V1 不自动录制。

Recording 后续若启用：

```text
必须 explicit user opt-in
```

不得仅因为任务较复杂而自动录制。

---

# 21. Domain Skills 默认关闭

设置：

```text
BH_DOMAIN_SKILLS=0
```

当前 Browser Use upstream Skill 支持动态网站特定 Domain Skills。

V1 默认关闭，减少：

```text
动态执行来源
额外网站策略
额外审核面
跨任务持久状态
```

后续如要开放单独评审。

---

# 22. Tab Marker 默认关闭

设置：

```text
BH_TAB_MARKER=0
```

Browser Use upstream 当前会通过 marker 帮助标记 Agent attached tab，并明确支持关闭该 marker。

商业产品默认不应该修改用户 Chrome Tab title。

---

# 23. Browser Use MCP Tool surface

当前官方 `--cli-mcp` 提供两个工具：

```text
browser_exec
browser_screenshot
```

`browser_exec` 的 namespace 中预加载 Browser Harness helpers，并跨调用保持 Python namespace。其实现最终执行：

```python
exec(code, ns)
```

Plugin 不得重新包装这些工具。

---

# 24. browser_exec 安全定义

这是整个 Security Review 最重要的事实。

`browser_exec` 不是：

```text
browser click API
```

它实际上是：

```text
Python execution
+
Browser Harness
+
CDP access
```

所以权限模型必须认为：

```text
browser_exec
=
local code execution
```

---

# 25. Host 权限要求

Host 至少应区分：

```text
browser.observe
browser.interact
browser.debug
local.code-execution
```

推荐映射：

```text
browser_screenshot
→ browser.observe
```

```text
browser_exec
→ browser.interact
 + browser.debug
 + local.code-execution
```

没有：

```text
local.code-execution
```

就不能调用：

```text
browser_exec
```

---

# 26. 一个必须接受的限制

因为 `browser_exec` 接收的是任意 Python：

```python
{
  "code": "..."
}
```

Host 无法可靠地从 MCP tool schema 判断里面是不是：

```text
普通 click

还是

删除账户

还是

发送付款

还是

读取本地文件
```

因此使用官方 Browser Use CLI MCP 的代价是：

> Host 无法实现严格的“每个 Browser primitive 单独权限审批”。

V1 接受这一事实。

如果未来产品要求：

```text
click permission
upload permission
payment permission
delete permission
```

精细到每个 Browser action，则必须设计 restricted wrapper。

那是另一套架构，不属于本 Plugin。

---

# 27. Skill 不是 Sandbox

SKILL.md 可以告诉 Agent：

```text
不要访问本机敏感文件
不要执行无关 subprocess
不要扫描 filesystem
```

但这些只是 behavioral instructions。

因为：

```text
browser_exec = exec(Python)
```

所以：

> Skill 不是 security boundary。

真正 security boundary 必须由 Host 提供。

---

# 28. Host Environment Sanitization

这是第二个 P0。

Agent Plugins v1 对 stdio MCP 的 `env` 是配置环境 overlay，但 Client 自己决定 subprocess 的 base environment。

因此不能假设：

```text
mcp.json.env
```

会自动隐藏 Host secrets。

Host 必须建立 sanitized base environment。

推荐：

```text
Host environment
      ↓
allowlist / sanitation
      ↓
Plugin mcp.json env
      ↓
PLUGIN_ROOT + PLUGIN_DATA
      ↓
browser-use
```

---

# 29. 禁止默认继承的 Secret

例如：

```text
OPENAI_API_KEY
ANTHROPIC_API_KEY
GOOGLE_API_KEY
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
GITHUB_TOKEN
DATABASE_URL

internal service tokens
model provider credentials
MCP credentials
application session secrets
```

除非确实是 Browser Use 当前任务明确需要且经过专门 capability flow。

普通 Browser Use runtime 不需要这些 Host secrets。

---

# 30. OS 权限事实

即使环境变量被清洗：

```text
browser_exec
```

仍然运行在本机 Python process 中。

如果 Host 不提供 OS sandbox，它仍然拥有运行用户本身拥有的 filesystem/process 权限。

因此 V1 的安全声明必须是：

```text
trusted local code execution
```

而不是：

```text
browser-only sandbox
```

不得向用户或 Security Review 声称 Browser Use CLI 只能操作 Browser。

---

# 31. 企业级进一步隔离

如果未来要求：

```text
browser-only security boundary
```

则建议进一步引入：

```text
restricted process sandbox
filesystem capability sandbox
network restrictions
subprocess restrictions
```

但这不属于 portable Plugin 本身。

属于 Host security runtime。

---

# 32. Runtime lifecycle

推荐状态：

```text
installed
   ↓
starting
   ↓
ready
   ↓
busy
   ↓
ready

starting
   ↓
unavailable

ready/busy
   ↓ abnormal exit
crashed
```

---

# 33. Lazy Start

Plugin install：

```text
validate plugin.json
validate mcp.json
validate SKILL.md
create PLUGIN_DATA
```

不要启动 Chrome。

第一次真正需要：

```text
browser_exec
browser_screenshot
```

时：

```text
start MCP
↓
initialize
↓
tools/list
↓
ready
```

---

# 34. Passive Health Check

Passive health 只允许：

```text
uvx resolvable
MCP process starts
initialize succeeds
tools/list succeeds
expected tools present
```

不得为了健康检查自动：

```text
打开 Chrome
创建 tab
改变页面
```

---

# 35. Active Browser Test

只有：

```text
用户明确执行 Browser task
```

或用户主动点击：

```text
Test Browser
```

时，才允许真正建立 Chrome connection。

---

# 36. MCP process isolation

由于 `browser_exec` 的 Python namespace：

```text
跨 MCP calls 持久
```

因此不得让不同 security principals 并发共享一个 MCP Runtime。

最安全的 V1 Host policy：

```text
一个 MCP process
=
一个逻辑 Browser automation execution context
```

至少必须保证：

```text
不同用户
不同安全 principal
不同独立 Agent work
```

之间不共享同一个 persistent Python namespace。

---

# 37. 推荐 task-boundary recycle

推荐：

```text
Browser Task A
↓
start/reuse dedicated browser-use MCP
↓
执行多个 browser_exec
↓
Task A terminal
↓
stop MCP process
```

下一任务：

```text
Task B
↓
fresh MCP process
```

这样可以清除：

```text
Python globals
临时 objects
上一个任务意外留下的 runtime state
```

Browser Harness daemon / Chrome connection 是否能复用，由 Browser Use 自己负责。

---

# 38. 同一任务内保持 MCP process

一个 Browser workflow 中不要每个 tool call 都重启 MCP。

因为：

```text
browser_exec namespace
```

就是为了支持：

```text
多步程序
变量
函数
中间数据
```

所以：

```text
same logical task
→ same MCP process
```

```text
independent task
→ fresh MCP process preferred
```

---

# 39. Concurrency

V1：

```text
one logical browser task per MCP runtime
```

当前 Browser Use MCP 自己使用 execution lock 串行化 tool calls。

Host 仍必须提供上层 single-flight。

第二个独立任务：

```text
queue
```

或者：

```text
BROWSER_USE_BUSY
```

不能与当前任务交错。

---

# 40. agent_helpers.py 风险

Browser Use upstream Skill 当前允许：

```text
$BH_AGENT_WORKSPACE/agent_helpers.py
```

作为 Agent 自扩展 helper。

对于 coding agent 这是方便能力，但对于商业 Agent Plugin 会产生：

```text
Task A 写 Python
↓
持久到 PLUGIN_DATA
↓
Task B 自动获得 Task A executable state
```

---

# 41. V1 agent_helpers policy

V1 不支持 persistent self-modifying helpers。

Skill 不应鼓励：

```text
修改 agent_helpers.py
```

Host 在新的独立 execution context 启动前应清理或 quarantine：

```text
${PLUGIN_DATA}/agent-workspace/agent_helpers.py
```

及其他未经批准的 executable helper state。

Browser Harness 自身的正式 runtime/config state不受影响。

---

# 42. Skill upstream strategy

Browser Use 官方目前已经维护：

```text
skills/browser-use/SKILL.md
```

其策略包含：

```text
什么时候不用 Browser
new_tab
tab reuse
AX first
DOM/JS fallback
Screenshot fallback
wait_for_load
login policy
remote debugging
CDP
uploads/downloads
iframe
scrolling
```

我们不重新发明 Browser strategy。

---

# 43. Skill 同步模型

```text
Browser Use upstream Skill
        ↓
human reviewed sync
        ↓
portable browser-use Skill
```

本地只允许三类适配：

```text
Portable Agent Skill frontmatter

Host security policy

V1 product scope
```

其他 Browser mechanics 尽量跟 upstream。

---

# 44. V1 Skill 必须增加的 policy

本地 Skill 必须明确：

```text
browser_exec 是高权限 local code execution

普通 Browser task 不访问本地敏感文件

不运行无关 subprocess

不扫描 filesystem

不调用无关 localhost service

不自动使用 Browser Use Cloud

不自动 recording

不持久写 agent_helpers.py

timeout/unknown 后不重放 consequential action
```

---

# 45. Browser Use 调用策略

Agent 优先：

```text
普通 HTTP fetch
```

只有需要：

```text
交互
登录态
JavaScript rendering
真实网页 action
复杂 browser-only workflow
```

才使用 Browser Use。

Browser Use upstream Skill 当前同样要求公共静态信息优先普通 fetch。

---

# 46. Code-as-Action

这是采用 Browser Use CLI 的核心价值。

优先：

```text
Agent
↓
一个 bounded browser_exec
↓
导航
循环
筛选
提取
聚合
验证
↓
返回结果
```

而不是：

```text
LLM
↓ click
LLM
↓ read
LLM
↓ click
...
```

---

# 47. Page observation strategy

优先：

```text
Accessibility Tree
```

再：

```text
DOM / js
```

再：

```text
Screenshot
```

上游 Skill 目前明确推荐通过：

```text
Accessibility.getFullAXTree
```

寻找 semantic element，并在 Python 中过滤，而不是把数千节点完整输出给模型。

---

# 48. 大数据输出

禁止：

```python
print(cdp("Accessibility.getFullAXTree"))
```

应该：

```python
nodes = cdp("Accessibility.getFullAXTree")["nodes"]

matches = [
    node
    for node in nodes
    if ...
]

print(matches[:20])
```

同理：

```text
HTML
network results
tables
large page text
```

必须先在 Python 内：

```text
filter
dedupe
sort
aggregate
```

再打印。

---

# 49. Screenshot

视觉页面：

```text
Canvas
Chart
Map
WebGL
image-heavy UI
visual placement
```

才使用：

```text
browser_screenshot
```

不要通过 `browser_exec` 自己 base64 screenshot。

当前官方 MCP 已经提供独立 image tool。

推荐默认：

```text
max_dim = 1800
```

---

# 50. Tab policy

一个逻辑任务尽量：

```text
one working tab per site/task
```

创建 tab 之前：

```text
current_tab()
list_tabs()
```

如果已有合适 tab：

```text
switch_tab()
```

第一次任务导航：

```text
new_tab(url)
```

而不是默认直接：

```text
goto_url(url)
```

这是当前 upstream 明确策略。

---

# 51. 用户已有 Tab

Agent 不得随意关闭：

```text
用户原本打开的 tab
```

只关闭：

```text
当前任务明确创建且已不再需要的 tab
```

---

# 52. Background tab

Browser Use 可以对 attached background tab 工作。

因此默认：

```text
不要抢用户 Chrome 前台
```

只有页面 background throttling 导致操作失败时才考虑：

```text
activate_tab()
```

而且必须重新验证。

---

# 53. Login Policy

允许：

```text
已有清晰登录态
已有明确 SSO
```

但遇到：

```text
password
MFA
OTP
security verification
new consent
ambiguous account selection
```

必须停止并请求用户处理。

这是上游 Browser Use Skill 当前的明确策略。

---

# 54. Consequential Action

例如：

```text
Send
Submit
Purchase
Delete
Publish
Account change
```

执行后必须：

```text
verify
```

不能因为：

```text
click_at_xy returned
```

就认为业务效果已经成功。

---

# 55. Timeout

推荐 Host defaults：

```text
browser_exec
300 seconds

browser_screenshot
30 seconds
```

如果产品允许超长 Browser task：

```text
browser_exec maximum
1800 seconds
```

但必须明确 bounded。

---

# 56. Input Bounds

推荐：

```text
browser_exec.code
≤ 128 KiB
```

这已经远高于正常 browser procedure 所需大小。

---

# 57. Output Bounds

推荐：

```text
browser_exec textual output
≤ 1 MiB

browser_screenshot
≤ 16 MiB
```

超出：

```text
BROWSER_USE_RESULT_TOO_LARGE
```

Agent 应重新：

```text
filter
aggregate
summarize
```

不能继续无限输出。

---

# 58. Unknown Outcome

这是可靠性 P0。

例如：

```text
click Submit
↓
网站已经收到
↓
MCP timeout
```

Host 无法确定业务效果。

所以：

```text
timeout
connection loss
MCP crash
Chrome crash
```

发生在可能产生副作用的调用后：

```text
outcome = unknown
```

禁止：

```text
automatic replay
```

---

# 59. Unknown Outcome 恢复

下一步只能：

```text
restart/recover Browser runtime if required
↓
inspect current page/state
↓
determine whether effect occurred
↓
then decide next action
```

不能：

```text
因为没收到 response
→ 再点一次
```

---

# 60. MCP Process Crash

```text
busy
↓
MCP process exits
↓
fail pending call
↓
mark outcome unknown where applicable
↓
runtime = crashed
```

下一次新的 Browser task：

```text
fresh MCP process
↓
initialize
↓
tools/list
```

不 replay 上次 code。

---

# 61. Chrome 生命周期

Plugin 不自行实现：

```text
Chrome launcher
Chrome discovery
CDP endpoint discovery
remote debugging flow
Tab mapping
Browser daemon
```

这些全部交给 Browser Use / Browser Harness。

---

# 62. Local Chrome

Browser Use upstream 当前本地流程可以连接 running Chrome/Chromium；Chrome 不存在时 Harness 可以启动，remote debugging 尚未启用时也有相应授权/诊断流程。

Plugin 只报告相关状态。

不重复实现。

---

# 63. macOS

Browser Use 当前对 macOS remote debugging permission 有专门的 `mac-approve` 流程，并可能需要启动 Browser Use 的宿主进程获得 Accessibility permission。

V1 不把：

```text
mac-approve
```

暴露为普通 Agent MCP tool。

应通过产品 diagnostics / user instruction 流程处理。

---

# 64. Cloud Scope

Browser Use upstream 支持 Cloud。

但 V1 不默认：

```text
注入 BROWSER_USE_API_KEY
启动 remote daemon
切换 Cloud
```

如果 Agent尝试启动 Cloud：

```text
Skill 必须阻止
```

除非未来 Plugin 明确扩展产品 scope。

---

# 65. Runtime dependency supply chain

当前：

```text
uvx
→ package registry
→ browser-use@0.13.10
```

意味着第一次使用依赖：

```text
Internet
Python/runtime resolution
package registry availability
```

这是 V1 接受的供应链模型。

---

# 66. 企业版供应链优化

后续 enterprise release 可增强为：

```text
release qualification
↓
预取 Browser Use runtime artifacts
↓
验证 digest/SBOM
↓
使用经过签名/审核的缓存
```

仍然不 fork Browser Use。

只是把：

```text
dynamic runtime resolution
```

提升成：

```text
release-bound runtime bytes
```

---

# 67. Plugin 安装过程

```text
discover plugin directory
↓
validate plugin.json
↓
validate mcp.json
↓
validate SKILL.md
↓
validate upstream.lock
↓
create PLUGIN_DATA
↓
installed
```

安装过程不应该主动打开 Chrome。

---

# 68. 首次 Browser 使用

第一次 Browser task：

```text
ensure uvx
↓
start browser-use MCP
↓
uvx resolves Browser Use runtime
↓
MCP initialize
↓
tools/list
↓
verify contract
↓
invoke Browser tool
```

第一次可能较慢，这是预期。

---

# 69. MCP Contract Validation

Runtime ready 不能只根据：

```text
process alive
```

判断。

必须：

```text
initialize
↓
tools/list
```

并确认：

```text
browser_exec
browser_screenshot
```

均存在。

---

# 70. Real Contract Snapshot

CI 应 snapshot 至少：

```text
tool names
input schema
content type expectations
```

例如：

```text
browser_exec
→ required code:string

browser_screenshot
→ optional full:boolean
→ optional max_dim:integer
→ returns image
```

上游改变其中任何一个，release gate 失败。

---

# 71. Upstream Drift Detection

CI 定期比较：

```text
browser-use/plugins
  browser-use/.mcp.json

browser-use/browser-use
  skills/browser-use/SKILL.md
```

与：

```text
upstream.lock.json
```

如果 SHA 变化：

```text
UPSTREAM_BROWSER_USE_CHANGED
```

只是提示 review。

不得自动修改生产 pin。

---

# 72. Upstream Upgrade Flow

正确：

```text
detect new upstream
↓
human review
↓
update Browser Use version
↓
update upstream.lock
↓
sync Skill
↓
run MCP contract tests
↓
run browser integration tests
↓
run security tests
↓
publish new PluginRevision
```

禁止：

```text
upstream latest
↓
auto publish
```

---

# 73. Logging Policy

允许默认记录：

```text
plugin version
Browser Use runtime version
MCP start/stop
tool name
duration
status
error class
```

禁止默认记录：

```text
browser_exec source code
full stdout
page content
cookies
passwords
form contents
screenshots
user messages
```

这些可能携带敏感信息。

---

# 74. Diagnostics

Raw Browser Use traceback 可以进入：

```text
bounded local diagnostics
```

但不能成为：

```text
durable Product state
analytics event
telemetry payload
```

默认 diagnostics 应有：

```text
size bound
retention bound
redaction
```

---

# 75. Host Error Contract

推荐：

```text
BROWSER_USE_RUNTIME_MISSING
BROWSER_USE_RUNTIME_START_FAILED
BROWSER_USE_MCP_HANDSHAKE_FAILED
BROWSER_USE_TOOL_UNAVAILABLE

BROWSER_USE_BUSY
BROWSER_USE_PERMISSION_DENIED

BROWSER_USE_TIMEOUT
BROWSER_USE_RESULT_TOO_LARGE
BROWSER_USE_RUNTIME_CRASHED
BROWSER_USE_OUTCOME_UNKNOWN

BROWSER_USE_BROWSER_PERMISSION_REQUIRED
```

不要让 Python traceback 成为稳定业务 error API。

---

# 76. Manifest Tests

CI 必须验证：

```text
plugin.json
→ Agent Plugins 1.0.0 schema

mcp.json
→ Agent Plugins 1.0.0 schema
```

并验证：

```text
plugin.json.$schema version
==
mcp.json.$schema version
```

Agent Plugins 规范明确要求两者版本匹配。

---

# 77. Pin Tests

CI：

```text
FAIL if:
@latest
```

并确认：

```text
browser-use@0.13.10
```

与：

```text
upstream.lock.json
```

一致。

---

# 78. Environment Tests

必须验证：

```text
BH_HOME
→ PLUGIN_DATA

BH_AGENT_WORKSPACE
→ PLUGIN_DATA

BH_RECORD
→ 0

BH_DOMAIN_SKILLS
→ 0

BH_TAB_MARKER
→ 0

BH_TELEMETRY
→ false

BROWSER_HARNESS_TELEMETRY
→ false

ANONYMIZED_TELEMETRY
→ false
```

---

# 79. Secret Isolation Tests

向 Host 测试进程注入：

```text
OPENAI_API_KEY=fake-secret
GITHUB_TOKEN=fake-secret
AWS_SECRET_ACCESS_KEY=fake-secret
```

然后从 Browser Use subprocess 检查：

```text
这些值不可见
```

这应该成为 Security CI。

---

# 80. MCP Integration Tests

真正执行：

```text
uvx
--python 3.12
browser-use@0.13.10
--cli-mcp
```

验证：

```text
initialize
tools/list
browser_exec
browser_screenshot
shutdown
```

不能只做 mock MCP test。

---

# 81. Browser Smoke Tests

至少：

```text
new_tab(example.com)

page_info()

Accessibility.getFullAXTree

click

type

press

scroll

wait_for_load

browser_screenshot
```

---

# 82. Existing Browser Tests

覆盖：

```text
Chrome already running

existing tabs

existing logged-in session

background tab

multiple tabs
```

Agent 不应关闭不是当前任务创建的用户 tab。

---

# 83. Chrome Startup Tests

覆盖：

```text
Chrome not running
```

确认由 Browser Use 正常进入工作状态。

Plugin 本身不能出现自研 Chrome launcher。

---

# 84. Remote Debugging Tests

覆盖：

```text
Chrome running
remote debugging not ready
```

确认 Browser Use 的正式 permission/diagnostic path 可工作。

macOS 单独 qualification。

---

# 85. Security Tests

必须包括：

```text
browser_exec
without local.code-execution
→ DENY

browser_screenshot
with browser.observe
→ ALLOW

browser_exec timeout
→ NO REPLAY

MCP crash after possible mutation
→ UNKNOWN

Host secrets
→ NOT VISIBLE

telemetry
→ DISABLED

recordings
→ DISABLED

persistent helper
→ CLEANED / QUARANTINED

uninstall
→ USER CHROME PROFILE UNTOUCHED
```

---

# 86. Namespace Isolation Tests

Task A：

```python
secret_task_state = "A"
```

结束 Task A。

Task B 使用新的 independent execution context。

验证：

```python
"secret_task_state" not in globals()
```

证明 persistent Python namespace 没有跨安全 context 泄漏。

---

# 87. Concurrency Tests

Task A 正在执行：

```text
browser_exec
```

Task B 请求 Browser。

必须：

```text
queue
```

或：

```text
BROWSER_USE_BUSY
```

禁止：

```text
interleaved Browser state
```

---

# 88. Unknown Outcome Tests

模拟：

```text
browser_exec
↓
网站 mutation 已发生
↓
断开 MCP
```

必须验证：

```text
Host 不再次提交同一个 browser_exec
```

下一步先 inspect state。

---

# 89. Output Budget Tests

模拟：

```text
2 MiB stdout
```

必须：

```text
bounded failure / truncation policy
```

不得无限传给模型。

模拟超大 screenshot，同理。

---

# 90. Review Gate — Architecture

全部必须 YES：

```text
[ ] Plugin 名称为 browser-use
[ ] Browser Runtime 使用官方 Browser Use
[ ] 使用官方 --cli-mcp
[ ] 没有 Browser Use fork
[ ] 没有 Browser Harness fork
[ ] 没有自研 CDP
[ ] 没有 BrowserProvider abstraction
[ ] 没有 BrowserTarget/Lease
[ ] 没有重新包装 browser_exec
[ ] 没有第二 Agent loop
[ ] Browser lifecycle 属于 Browser Use
```

---

# 91. Review Gate — Agent Plugins

```text
[ ] plugin.json 位于 root
[ ] mcp.json 位于 root
[ ] skills/browser-use/SKILL.md 正确
[ ] Agent Plugins version = 1.0.0
[ ] schema version 一致
[ ] 没有非标准 core manifest
[ ] 不依赖 .claude-plugin
[ ] 不依赖 DXT
[ ] 不依赖 Codex-specific package
```

---

# 92. Review Gate — Upstream

```text
[ ] Browser Use runtime 已 pin
[ ] 无 @latest
[ ] upstream.lock.json 存在
[ ] pyproject provenance 已锁
[ ] official Plugin provenance 已锁
[ ] official Skill provenance 已锁
[ ] upstream drift 已检查
[ ] Skill diff 已人工 review
```

---

# 93. Review Gate — Security

```text
[ ] browser_exec 明确归类 local code execution
[ ] Host 有 explicit authorization
[ ] Host base environment sanitized
[ ] Host secrets不可见
[ ] telemetry 默认关闭
[ ] recording 默认关闭
[ ] Domain Skills 默认关闭
[ ] persistent helper 默认禁用
[ ] runtime 不跨 principal 共享
[ ] timeout bounded
[ ] output bounded
[ ] unknown mutation 不 replay
[ ] Security 文档不声称 browser-only sandbox
```

---

# 94. Review Gate — Reliability

```text
[ ] MCP crash 可恢复
[ ] Runtime crash 不 replay
[ ] One logical task per MCP runtime
[ ] Cross-task namespace 已隔离
[ ] Browser action 后 verify
[ ] AX/DOM 大数据先过滤
[ ] Screenshot 不作为默认 observation
[ ] Passive health 不启动 Chrome
```

---

# 95. Review Gate — Supply Chain

```text
[ ] Runtime version fixed
[ ] uvx dependency documented
[ ] 首次网络下载行为 documented
[ ] Browser Use license reviewed
[ ] Browser Harness license reviewed
[ ] THIRD_PARTY_NOTICES present
[ ] Upgrade requires new PluginRevision
```

当前 Browser Use pyproject 声明 MIT license，Browser Harness 当前 package 同样声明 MIT。

---

# 96. Release Acceptance Criteria

V1 只有全部满足才允许发布：

```text
[ ] Plugin name exactly browser-use

[ ] Agent Plugins 1.0.0 compliant

[ ] Browser Use 0.13.10 pinned

[ ] Python 3.12

[ ] official Browser Use --cli-mcp

[ ] browser_exec discovered

[ ] browser_screenshot discovered

[ ] real MCP contract test passes

[ ] local Chrome/Chromium works

[ ] existing logged-in session works

[ ] Browser Use controls tabs/pages successfully

[ ] AX/DOM inspection works

[ ] click/type/press/scroll works

[ ] screenshot works

[ ] Browser Use telemetry disabled

[ ] recording disabled

[ ] Domain Skills disabled

[ ] Host environment sanitized

[ ] browser_exec requires local.code-execution

[ ] one logical browser task per runtime

[ ] independent tasks do not share Python namespace

[ ] agent_helpers persistent executable state disabled

[ ] timeout bounded

[ ] result sizes bounded

[ ] unknown mutation never automatically replayed

[ ] Plugin uninstall does not delete user Chrome profile

[ ] upstream provenance locked

[ ] upstream Skill reviewed

[ ] security tests pass

[ ] Chrome/OS qualification matrix passes
```

---

# 97. 推荐实施阶段

## Phase 0 — Package

完成：

```text
plugin.json
mcp.json
upstream.lock.json
SKILL.md
README
LICENSE
THIRD_PARTY_NOTICES
```

通过 schema validation。

---

## Phase 1 — MCP Runtime

完成：

```text
uvx resolution
MCP spawn
initialize
tools/list
shutdown
runtime error mapping
```

---

## Phase 2 — Host Security

完成：

```text
environment sanitization
local.code-execution authorization
telemetry disable verification
timeout
input/output bounds
runtime task scoping
namespace recycling
single-flight
```

这是 V1 最关键的工程阶段。

---

## Phase 3 — Browser Qualification

完成：

```text
Chrome connection
Chrome launch
existing Chrome
logged-in session
tabs
AX
DOM
input
navigation
screenshot
```

---

## Phase 4 — Failure Qualification

完成：

```text
runtime unavailable
MCP crash
Chrome crash
timeout
unknown outcome
remote debugging permission
runtime restart
cross-task state isolation
```

---

## Phase 5 — Upstream Automation

完成：

```text
upstream drift detection
runtime contract snapshot
Skill diff
pin consistency
upstream.lock validation
```

---

## Phase 6 — Release

冻结：

```text
Plugin:
browser-use@1.0.0

Agent Plugins:
1.0.0

Browser Use Runtime:
0.13.10

Python:
3.12
```

并生成正式 release evidence。

---

# 98. Known Risks / Accepted Tradeoffs

V1 明确接受：

### Browser Use 主包依赖较重

因为优先复用官方 Runtime，而不是维护 fork。

### 首次运行需要 uvx/runtime resolution

商业发行未来可以预热或绑定经过验证的 runtime artifacts。

### browser_exec 是任意 Python execution

因此必须按 local code execution 授权。

### 无法实现 Browser primitive-level 权限

因为 Host 看到的是 Python code，而不是结构化 click/fill/delete。

### 本地 Browser state 属于 Browser Use

Host 不维护 BrowserTarget 等重复状态。

这些是设计选择，不是未解决 bug。

---

# 99. 如果未来出现这些需求，需要重新做架构评审

只有出现下列需求，才值得偏离当前薄适配架构：

```text
需要 browser-only sandbox

需要 click/fill 等 primitive-level authorization

需要多个 Browser providers

需要多个隔离 Browser sessions 并发

需要 cloud Browser 成为一等产品能力

需要 Browser state 进入 Product durable model

需要限制 Python filesystem/process 能力

需要去除完整 Browser Use dependency
```

届时应新建设计，而不是偷偷扩展 V1。

---

# 100. 最终技术冻结

`browser-use` V1 的最终定义：

```text
                    Agent
                      │
                      ▼
               Agent Plugin Host
                      │
        authorization / isolation
                      │
                      ▼
                 browser-use
        ┌─────────────┼─────────────┐
        │             │             │
  plugin.json     mcp.json      SKILL.md
                      │
                      ▼
                   MCP stdio
                      │
                      ▼
            uvx --python 3.12
                      │
                      ▼
           browser-use@0.13.10
                --cli-mcp
                      │
            ┌─────────┴──────────┐
            ▼                    ▼
      browser_exec       browser_screenshot
            │
            ▼
       Browser Harness
            │
           CDP
            │
            ▼
       Chrome / Chromium
```

---

# 101. 最终架构原则

**原则一**

> Browser Use 官方项目拥有 Browser automation implementation。

**原则二**

> `browser-use` Plugin 只做 Agent Plugins packaging、版本绑定和使用指导。

**原则三**

> Agent Host 必须拥有授权、Secret isolation、process lifecycle、timeout、output bounds 和 security context isolation。

**原则四**

> `browser_exec` 必须始终按本地代码执行能力处理，而不能降级描述成普通 Browser 控制。

**原则五**

> PluginRevision 必须绑定确定的 Browser Use runtime 和 upstream provenance。

**原则六**

> timeout、disconnect、crash 后的 consequential Browser effect 必须按 unknown 处理，绝不自动 replay。

**原则七**

> 不因为未来可能扩展而提前加入 BrowserTarget、Provider、Router 等抽象。

---

# 102. 最终 Review Verdict

满足本规范后，`browser-use` V1 应具备：

```text
极薄 Plugin 实现
高比例 upstream reuse
低 Browser compatibility 维护成本
明确供应链 identity
明确代码执行 security boundary
可复现 PluginRevision
清晰 failure semantics
可自动化 compatibility qualification
```

本项目最终定位：

> **`browser-use` 是 Browser Use 官方 Runtime 的标准 Agent Plugins v1 适配层，而不是新的 Browser automation framework。**

任何 PR 如果开始大量编写：

```text
CDP implementation
Browser driver
Browser tab manager
Browser provider abstraction
Browser action wrappers
```

都应在 Architecture Review 中直接质疑其必要性。
