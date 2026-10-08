#!/usr/bin/env node
/**
 * autoskll 安装器（零依赖，只用 node 标准库）
 *
 *   node install.js              技能模式：把整个技能目录放进 ~/.qoder/skills/，点名才生效，零常驻成本
 *   node install.js --plugin     插件模式：额外注册常驻 hook，每个会话自动挂载（仅 Qoder 需要）
 *   node install.js --uninstall  两种都撤掉
 *
 * 仓库根目录就是技能本体（SKILL.md 在根），所以「任何读 Agent Skill 规范的宿主」都可以不用本脚本：
 * 把整个目录放进宿主的 skills 目录即可 —— ~/.claude/skills/autoskll/、~/.qoder/skills/autoskll/。
 * 脚本只是替 Qoder 用户省掉手拷，并顺手处理 --plugin 那两处注册表。
 *
 * --plugin 需要一个能跑 hook 的 node：默认用运行本脚本的这个 node（process.execPath），
 * 也可 --node /绝对路径/node.exe 指定（Windows 上 node 经常不在 PATH）。
 * 改注册表后必须重开 Qoder：插件清单与 MCP 列表只在启动时读取。
 *
 * 目录约定（照本机已装的 taste-skill / ponytail 抄的，不是猜的）：
 *   技能模式  ~/.qoder/skills/autoskll/SKILL.md            ← 宿主按 <目录>/SKILL.md 加载
 *   插件模式  ~/.qoder/plugins/cache/local/autoskll/<版本>/  ← 安装时现生成 .qoder-plugin/plugin.json，
 *             并把 SKILL.md 复制成 skills/autoskll/SKILL.md（插件清单声明的是 "skills":"./skills/"）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const NAME = 'autoskll';
const VERSION = '1.0.0';
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

const SRC = __dirname;
const SKILL_MD = path.join(SRC, 'SKILL.md');
if (!fs.existsSync(SKILL_MD)) { console.error(`找不到 ${SKILL_MD}，请在仓库根目录里跑本脚本`); process.exit(1); }
// 插件清单里的中文描述直接从 SKILL.md frontmatter 取，避免同一个句子存两份、日后漂移
const SKILL_DESC = (() => {
  const m = /^description:[ \t]*(.+)$/m.exec(fs.readFileSync(SKILL_MD, 'utf8').slice(0, 4000));
  return m ? m[1].trim() : '自适应项目流程总控';
})();
const HOME = os.homedir();
const QODER = ['.qoder', '.qoder-cn'].map((d) => path.join(HOME, d)).find((d) => fs.existsSync(d));
if (!QODER) { console.error('没找到 ~/.qoder 或 ~/.qoder-cn，Qoder 未安装？'); process.exit(1); }

const SKILL_DIR = path.join(QODER, 'skills', NAME);
const LOCAL_ROOT = path.join(QODER, 'plugins', 'cache', 'local', NAME);
const PLUGIN_DIR = path.join(LOCAL_ROOT, VERSION);
const REG = path.join(QODER, 'plugins', 'installed_plugins_v2.json');
const SETTINGS = path.join(QODER, 'settings.json');
const KEY = `${NAME}@local`;

// 注册表与 settings.json 里装着用户全部插件、mcpServers 和 providers（含密钥）。
// 解析失败绝不能"用默认值顶上"再写回去 —— 那等于把别人的配置清空只留自己这一条。
// 所以：文件存在但读不进 = 立即中止，一个字节都不写。
function readJSON(p, label) {
  if (!fs.existsSync(p)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('顶层不是对象');
    return data;
  } catch (e) {
    console.error(`中止：${label} 读不出来（${e.message}）`);
    console.error(`  文件：${p}`);
    console.error('  我没有改动任何文件。请先修好这个 JSON（或从同目录 .bak-autoskll 恢复）再重跑。');
    process.exit(1);
  }
}
// 先备份、写临时文件、再原子替换；序列化结果自己先 parse 一遍，坏数据不出门
function writeJSON(p, data) {
  if (fs.existsSync(p)) fs.copyFileSync(p, `${p}.bak-${NAME}`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const out = JSON.stringify(data, null, 2) + '\n';
  JSON.parse(out);
  fs.writeFileSync(`${p}.tmp`, out);
  fs.renameSync(`${p}.tmp`, p);
}
function copyTree(from, to, skip) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip && skip.includes(e.name)) continue;
    fs.cpSync(path.join(from, e.name), path.join(to, e.name), { recursive: true });
  }
}
const rmrf = (p) => { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); };

if (has('--uninstall')) {
  rmrf(SKILL_DIR);
  rmrf(LOCAL_ROOT);
  // 文件本来就不在就别无中生有地写一个 {} 回去
  if (fs.existsSync(REG)) { const reg = readJSON(REG, '插件注册表'); if (reg.plugins) delete reg.plugins[KEY]; writeJSON(REG, reg); }
  if (fs.existsSync(SETTINGS)) { const st = readJSON(SETTINGS, 'settings.json'); if (st.enabledPlugins) delete st.enabledPlugins[KEY]; writeJSON(SETTINGS, st); }
  console.log(`已卸载 ${NAME}：技能目录 + 插件缓存 + 两处注册表条目（改前的文件留了 .bak-${NAME}）。重开会话生效。`);
  process.exit(0);
}

// --plugin 要改两处用户清单：先读进内存。坏 JSON 必须在动任何文件之前中止，否则会留下「技能装了、插件没注册」的半状态
let PENDING, nodeBin;
if (has('--plugin')) {
  nodeBin = val('--node') || process.execPath;
  if (!fs.existsSync(nodeBin)) { console.error(`node 不存在：${nodeBin}，用 --node 指定绝对路径`); process.exit(1); }
  PENDING = { reg: readJSON(REG, '插件注册表'), st: readJSON(SETTINGS, 'settings.json') };
}

// ① 技能模式：仓库根本身就是技能目录，整包平铺进 <skills>/autoskll/
copyTree(SRC, SKILL_DIR, ['.git', 'install.js']);
console.log(`① 技能已装 → ${SKILL_DIR}`);
console.log(`   用法：会话里输入 ${NAME}，或说「走全流程 / 帮我搞定 / 审计这个仓库 / 补 API 文档」`);

if (!has('--plugin')) {
  console.log(`\n想让每个会话自动挂载：node install.js --plugin`);
  process.exit(0);
}

// ② 插件模式：Qoder 的插件清单要求 skills/<名>/SKILL.md，所以在这里现造版式 + plugin.json
copyTree(SRC, PLUGIN_DIR, ['.git', 'install.js']);
const nested = path.join(PLUGIN_DIR, 'skills', NAME);
fs.mkdirSync(nested, { recursive: true });
fs.copyFileSync(SKILL_MD, path.join(nested, 'SKILL.md'));
writeJSON(path.join(PLUGIN_DIR, '.qoder-plugin', 'plugin.json'), {
  name: NAME, displayName: 'Autoskll', version: VERSION,
  description: 'Adaptive project-flow orchestrator: reads objective signals to pick the route and S/M/L depth, then runs only the needed stages, degrading to a built-in minimal procedure when a plugin skill is absent.',
  descriptionZh: SKILL_DESC,
  author: { name: 'eyves86', url: 'https://github.com/eyves86/autoskll' },
  homepage: 'https://github.com/eyves86/autoskll',
  repository: 'https://github.com/eyves86/autoskll',
  license: 'MIT',
  keywords: ['workflow', 'orchestration', 'architecture', 'code-review', 'documentation', 'planning'],
  skills: './skills/',
  hooks: './hooks/qoder-hooks.json',
});
const hookScript = path.join(PLUGIN_DIR, 'hooks', `${NAME}-inject.js`);
const hooksManifest = path.join(PLUGIN_DIR, 'hooks', 'qoder-hooks.json');
// hook 命令行必须是绝对路径 + 真实存在的 node（本机 node 不在 PATH 的坑，已在注释里写过）
writeJSON(hooksManifest, {
  _comment: `${NAME} Qoder hook：UserPromptSubmit 每轮注入一小段指路牌，让宿主自动挂载本技能。只放指针，技能正文按调用才吃 token。关：建空文件 ${path.join(QODER, `${NAME}-off`)}`,
  hooks: {
    UserPromptSubmit: [{
      hooks: [{
        type: 'command', command: nodeBin, args: [hookScript],
        name: `${NAME}-inject`, timeout: 10,
      }],
    }],
  },
});

const reg = PENDING.reg;
reg.version = reg.version || 2; reg.plugins = reg.plugins || {};
reg.plugins[KEY] = [{
  scope: 'user', installPath: PLUGIN_DIR, version: VERSION,
  installedAt: new Date().toISOString(), lastUpdated: new Date().toISOString(),
  displayName: 'Autoskll',
}];
writeJSON(REG, reg);

const st = PENDING.st;
st.enabledPlugins = st.enabledPlugins || {}; st.enabledPlugins[KEY] = true;
writeJSON(SETTINGS, st);

console.log(`② 插件已注册 → ${PLUGIN_DIR}`);
console.log(`   hook: ${nodeBin} ${hookScript}`);
console.log(`   原注册表备份：${REG}.bak-${NAME} 、 ${SETTINGS}.bak-${NAME}`);
console.log(`   只关注入不卸载：建空文件 ${path.join(QODER, `${NAME}-off`)}`);
console.log(`\n必须重开 Qoder 才生效（插件清单在启动时读）。验证：新会话技能列表里有 ${NAME}，`);
console.log('且不点名直接说「重构 X 并补文档」，它开头会先吐一行「路线 + 档 + 跳了哪些段」。');
