# autoskll

一个自适应的项目流程编排技能：拿到需求先**判断**（走哪条路线、跑到多深），然后**只跑需要的段**，
并把该段交给对应的专业插件技能；本机没装那个插件时走最小人工版，不编造不存在的规则。

覆盖六段：架构 / 开发 / 审计 / 文档 / 界面 / 验证。

## 装

把 `SKILL.md` 所在目录整个复制到宿主的技能目录即可，无依赖、无构建步骤：

```bash
# Qoder（用户级，所有项目可用）
cp -r autoskll ~/.qoder/skills/

# 项目级（只对该仓库生效，可提交进仓库共享给团队）
cp -r autoskll <repo>/.qoder/skills/

# 其他按 Agent Skill 规范读 SKILL.md 的宿主
cp -r autoskll ~/.claude/skills/
```

技能名取自 `SKILL.md` frontmatter 的 `name: autoskll`，目录名请保持一致。新装后通常需要重开会话才会出现在技能列表里。

## 用

**① 点名调用**（推荐，零常驻成本）

```
autoskll 帮我把这个模块重构成按租户分表，顺便更新文档
```

也可以直接说「走全流程 / 帮我搞定 / 开发+审计+文档 / 审计一下这个仓库 / 补 API 文档」，
命中 `description` 里的触发词就会挂载。

**② 常驻自动挂载**（每个会话都不用点名）

用 `hooks/autoskll-inject.js`，它在每次提问前往上下文塞一小段指针（实测 198 字符 ≈ 60 token），由它决定是否挂 `autoskll`。

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["/绝对路径/autoskll/hooks/autoskll-inject.js"],
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

- 脚本必须把 stdin 读完并留一个兜底退出定时器，否则宿主等不到流结束会卡住整个会话 —— 已在实现里处理。
- 关掉：新建空文件 `~/.qoder/autoskll-off` 或 `~/.claude/autoskll-off`。
- 只放指针，不要往 hook 里塞技能正文：正文实测 4857 字符（≈1.5k token），调用时才吃；塞进 hook 就变成每轮固定开销。

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
