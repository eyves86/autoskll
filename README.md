# autoskll

一个自适应的项目流程编排技能：拿到需求先**判断**（走哪条路线、跑到多深），然后**只跑需要的段**，
并把该段交给对应的专业插件技能；本机没装那个插件时走最小人工版，不编造不存在的规则。

覆盖六段：架构 / 开发 / 审计 / 文档 / 界面 / 验证。

## 装

**通用装法（任何宿主，不需要脚本）**：这个仓库的根目录就是技能本体 —— `SKILL.md` 在最外层，符合 Agent Skill 的通用规范。把整个目录放进你宿主的 skills 目录、目录名叫 `autoskll` 就行：

```bash
git clone https://github.com/eyves86/autoskll ~/.claude/skills/autoskll    # Claude Code
git clone https://github.com/eyves86/autoskll ~/.qoder/skills/autoskll     # Qoder
git clone https://github.com/eyves86/autoskll ~/.qoder-cn/skills/autoskll  # Qoder 国内版
```

技能名取自 `SKILL.md` frontmatter 的 `name: autoskll`，目录名必须一致，否则宿主加载不到。装完重开会话即可在技能列表里看到它，不用重启 IDE。

**Qoder 脚本装法**（省掉手拷，并且是唯一会注册常驻 hook 的路径；需要 node，Windows 上 node 不在 PATH 就用绝对路径调它）：

```bash
git clone https://github.com/eyves86/autoskll && cd autoskll
node install.js                 # 技能模式：等价于上面的手拷
node install.js --plugin        # 插件模式：再注册常驻 hook，每个会话自动挂载
node install.js --uninstall     # 撤干净（注册表改前先备份成 .bak-autoskll）
```

PowerShell 同理（`node install.js`）。`--plugin` 模式必须**重启 Qoder**（插件清单和 MCP 列表只在启动时读取）。

| 形态 | 落点 | 效果 |
|---|---|---|
| 技能 | `~/.qoder/skills/autoskll/SKILL.md` | 点名或命中触发词才挂载，不占常驻 token |
| 插件 | `~/.qoder/plugins/cache/local/autoskll/1.0.0/` | 安装时生成 `skills/autoskll/SKILL.md` + `.qoder-plugin/plugin.json`，并在 `plugins/installed_plugins_v2.json` 与 `settings.json` 的 `enabledPlugins` 里注册 `autoskll@local` |

## 用

**① 点名调用**（推荐，零常驻成本）

```
autoskll 帮我把这个模块重构成按租户分表，顺便更新文档
```

也可以直接说「走全流程 / 帮我搞定 / 开发+审计+文档 / 审计一下这个仓库 / 补 API 文档」，
命中 `description` 里的触发词就会挂载。

**② 常驻自动挂载**（每个会话都不用点名）

`node install.js --plugin` 会把整包放进插件缓存、生成下面这份 hook 清单并注册插件。**别手改 `settings.json` 加 `hooks` 键** —— 本机实测那里面只有 `mcpServers / enabledPlugins / providers`，常驻 hook 一律走插件清单（taste-skill、ponytail、superpowers 都是这么装的），`install.js` 生成的就是这个形态：

```json
// <插件目录>/hooks/qoder-hooks.json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ {
          "type": "command",
          "command": "<node 绝对路径>",
          "args": ["<插件目录绝对路径>/hooks/autoskll-inject.js"],
          "name": "autoskll-inject", "timeout": 10
      } ] }
    ]
  }
}
```

- 两条都是**绝对路径**：command 必须指向真实存在的 node（Windows 上 node 常常不在 PATH，`install.js` 默认取当前运行它的 node，也可 `--node` 指定），脚本路径同理。
- `install.js` 会往 `installed_plugins_v2.json` 和 `enabledPlugins` 各写一条 `autoskll@local`，改前都留 `.bak-autoskll` 备份；手改这两处同样要重启 Qoder。
- hook 只塞 198 字符（≈60 token）的指路牌，正文 4857 字符（≈1.5k token）只在真挂载时吃 —— 别把正文搬进 hook，那会变成每轮固定开销。
- 脚本必须读完 stdin 并留兜底定时器，否则宿主等不到流结束会卡死整个会话；已在实现里处理，改动时别删。
- 只关注入不卸载：建空文件 `~/.qoder/autoskll-off`（或 `~/.qoder-cn/autoskll-off`、`~/.claude/autoskll-off`）。

## 它是怎么判断的

`SKILL.md` 第 0 步是这个技能的核心，三段逻辑：

1. **三个客观信号定路线** —— 用户动词（想干什么）、目标物在仓库里的状态（存在 / 要换结构 / 只缺文档）、
   变更半径（几个文件、动不动接口和数据结构、是否跨模块）。路线可以叠加；信号冲突时按「只读优先」排：
   审计 > 文档 > 界面 > 重构 > 新建。
2. **S / M / L 三档定深度** —— 判据是可数的：文件数、是否改公开接口或表结构、是否加依赖、是否跨服务或涉及迁移与鉴权。
   S 档只改 diff + 跑验证，架构段与书面计划直接跳；L 档才做完整建模和全仓审计。
   判不准取低档并说明理由，不默认高档。
3. **只在不可逆时分叉问用户** —— 删数据、改线上接口、迁移库、破坏性变更公开 API 才停下来问；
   其余按判出的档位做完，交付时写明「按 X 档做的，要更深说一声」。

外加两条防跑偏：开场必须输出一行判断结论（给用户校验的锚点）；跑到一半发现判错要**停下来重判并说明代价**，
不许默默扩大范围。

## 依赖是可选的

技能会先检查当前会话可用技能列表，装了才点名，没装走最小版。下列插件能提升对应段的质量，缺任何一个都能跑完：

| 段 | 可选技能 |
|---|---|
| 架构 | `architecture-visualization:*`、`postgresql-database-engineering` |
| 开发 | `ponytail`、`superpowers:*`、`product-design:prd`；文档查询类 MCP（如 Context7） |
| 审计 | `ponytail-review` / `ponytail-audit`、`analyze-code`、`quality-guardian:*`、`cc-documentation-quality` |
| 文档 | `generating-documentation`、`better-harness:init`、`Presentations:pptx` |
| 界面 | `taste-skill:*`、`frontend-design`、`design-review:*` |

## 许可

MIT，见 `LICENSE`。
