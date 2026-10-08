#!/usr/bin/env node
/**
 * autoskll 常驻注入（可选）
 * 作用：在每个会话的每次提问前，往上下文里塞一小段「指路牌」，让宿主自动挂载 autoskll 技能，
 *       用户不必每次点名。只放指针，不放技能正文 —— 正文只在真正调用技能时才吃 token。
 *
 * 安装（Qoder CLI，用户级）：在 ~/.qoder/settings.json 里加
 *   "hooks": {
 *     "UserPromptSubmit": [
 *       { "hooks": [ { "type": "command",
 *           "command": "node",
 *           "args": ["<绝对路径>/hooks/autoskll-inject.js"],
 *           "timeout": 10 } ] }
 *     ]
 *   }
 * 其他宿主（Claude Code 等）用同一个脚本，事件名同样是 UserPromptSubmit。
 *
 * 关掉：新建空文件 ~/.qoder/autoskll-off（或 ~/.claude/autoskll-off）。
 *
 * 两个实现细节，改动时别删：
 *  1. 必须把 stdin 读完并监听 end，否则宿主等不到流结束会卡住会话。
 *  2. 兜底定时器（这里 800ms）保证任何异常下都会退出，hook 挂掉比不注入更糟。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const BLOCK = [
  'AUTOSKLL ROUTER —— 本轮若属于以下任一类，先用 Skill 工具加载用户级技能 autoskll，再按它的判断结果干活：',
  '加功能/改行为、重构或升级改版、审计或技术债评审、写或更新文档、界面/UI 优化。',
  '不属于这些（纯问答、单条命令、闲聊）就跳过，不要挂。',
  '关掉本注入：新建空文件 ~/.qoder/autoskll-off 或 ~/.claude/autoskll-off。',
].join('\n');

const off = ['.qoder', '.claude']
  .map((d) => path.join(os.homedir(), d, 'autoskll-off'))
  .some((p) => fs.existsSync(p));

let payload = {};
if (!off) {
  payload = {
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: BLOCK },
  };
}

let done = false;
function emit() {
  if (done) return;
  done = true;
  try {
    process.stdout.write(JSON.stringify(payload));
  } catch (e) {
    /* 宿主已经不读输出了，hook 里无可补救动作 */
  }
  process.exit(0);
}

process.stdin.on('data', () => {});
process.stdin.on('end', emit);
process.stdin.on('error', emit);
setTimeout(emit, 800);
