<!-- SPDX-License-Identifier: MPL-2.0 -->
# AGENTS.md · 小黑屋

每次开工必读的**最小规则集**。细节与历史决策见 [AI_README.md](AI_README.md)，发布见 [docs/RELEASING.md](docs/RELEASING.md)。

> 本文件的定位是「每次都必须遵守的条目」。
> 新增规则前先自问：这条是每次都要守，还是只在特定任务里用？
> 后者写进 AI_README.md，不要往这里堆——这里越长，被读到的概率越低。
> **本文件与 AI_README.md 冲突时，以本文件为准。**

---

## 0. 开工前三十秒

1. `git status` + `git log -5`，确认已有进度，**不要重写已经做完的东西**
2. 读一遍 AI_README.md 的「技术、许可与存档边界」与「验证要求」两节
3. 需求有歧义时，先给方案再动手；不要按自己的理解自由发挥

---

## 1. 红线（违反即视为未完成）

### 存档

- **普通模式 `localStorage.gameState` 与 `adr.saveSlots.v1` 的原始字节不得改变**
- Rogue 只使用 `rogueSlot0/1/2`、`rogueIndex`、`rogueBlueprints`、`roguePreferences`
- 存档版本保持 **v3**，不改顶层结构；新字段一律挂在 `save.flags` 下，读档时补默认值
- 坏档保留原样，不得静默删除或覆盖；恢复只替换当前旅程

### 隔离

- Rogue 不初始化普通模式的 `Engine` / `Room` / `StateManager`
- 入口分流只改既有启动位置，不动原作引擎逻辑
- 不编辑 `android/app/src/main/assets/game/`（生成物，由 `prepare-android-assets.py` 产出）

### 玩法

- **只在有效行动时推进回合**；禁止用 `setTimeout` / `setInterval` 驱动生产、战斗、时间或离线收益
- 查看、设置、切页、返回、暂停**不推进回合**
- 所有数值来自 `rogue.num.js`，业务代码里不许出现魔法数字
- 所有面向玩家的中文来自 `lang/zh.js`，逻辑文件里不许出现中文字面量；缺 key 返回 `!!key!!`

### 内容链路

九区 → 地牢 → 图纸 → 飞船通关 → 通关后深渊，**这条链路必须始终在合法操作与正常资源下可通**。

---

## 2. 允许改的路径

```
script/rogue/**            ✓
script/rogue/lang/zh.js    ✓
css/rogue.css              ✓
index.html                 ✓（只允许加 script / link 标签）
android/web/**             ✓（主页、多存档）
scripts/test-*.mjs         ✓
docs/**、*.md              ✓
```

除此之外一律先问。**尤其：`script/engine.js`、`world.js`、`room.js`、`path.js`、`events.js`、`state_manager.js` 不得改动。**

---

## 3. 代码约定

- 原生 JavaScript + 现有 jQuery 1.10；**无构建、无 npm 运行依赖、无 ES Module、无 TypeScript、无 `import/export`**
- `var`、4 空格缩进、分号；每个函数一行 JSDoc 说明用途
- 新文件头加 `SPDX-License-Identifier: MPL-2.0`
- 目标 WebView 80 / Android 6.0+，完全离线，无网络权限
- 一次改动只做一件事；**不要顺手"优化"无关代码**

---

## 4. 每次改完必须跑

```bash
node scripts/test-rogue.mjs
node scripts/test-rogue-issues.mjs
node scripts/test-rogue-storage.mjs
```

按钮或布局有改动，再加跑对应的 UI 测试（先执行 `python scripts/prepare-android-assets.py`）。

**把每份输出的最后几行贴回来。全绿才算完成，红了不许说"已完成"。**

---

## 5. 改数值的专用流程

1. 只改 `rogue.num.js` 或 `content/` 下的表
2. `node scripts/test-rogue.mjs --playthrough`
3. 记录三个数：**总回合 / 地牢回合占比 / 终局库存**
4. 对照下表，越界就回滚本次改动

| 指标 | 合格区间 |
|---|---|
| 通关总回合 | 2500 – 3500 |
| 地牢回合占比 | ≥ 15% |
| 终局铁库存 | < 400 |
| 终局水库存 | < 800 |
| 全流程点击次数 | < 1500 |

**一次只改一项，改完立刻测。** 多项同改会互相掩盖问题。

---

## 6. 改 UI 的专用流程

- 先对契约：标题固定居中、底部返回与导航、主要按钮 ≥ 44×44px、无横向溢出、不遮日志与操作区
- 五个宽度都测：`320×512`、`360×740`、`412×915`、`740×360`（横屏）、`1440×900`
- 日间与夜间主题各一遍
- 截图只能说明布局，**不能称为手机实拍**

---

## 7. 报告要求

- 区分「已实现」「已验证」「未验证」，不要写成同一件事
- 模型层通关（`Rogue.state.act`）与真实按钮通关**分开报告**，不能混为一谈
- 没连真机就明确写「未做 Android 真机验证」
- 不把计划描述成完成；失败就说失败，并说明试过什么

---

## 8. 遇到这些停下来说明

1. 要修改存档顶层结构或版本号
2. 要动普通模式任何一个字节
3. 要引入第三方库、构建步骤或网络依赖
4. 需求与 AI_README.md 中已确认的规则冲突
5. 同一个测试连续三次修不好

停下来时给出：**卡在哪 / 试过什么 / 需要什么决定**，三句话以内。

---

## 9. 最常见的四种跑偏（提前自查）

| 跑偏 | 表现 | 正确做法 |
|---|---|---|
| 改太多 | 顺手重构 `world.js`、给 `gameState` 加字段 | 只改 §2 白名单里的文件 |
| 编数值 | 自己设计火等级、伤害公式 | 一切数值进 `rogue.num.js`，先给表再实现 |
| 写半成品 | 留下一堆 `// TODO` 和省略号 | 每个文件都要能直接运行 |
| 假装验证 | 没跑测试就写"已通过" | 贴测试输出的最后几行 |

---

## 10. 索引

| 想知道什么 | 看哪里 |
|---|---|
| 世界观、历史决策、已确认规则 | `AI_README.md` |
| 玩法细节、命令清单、测试范围 | `docs/ROGUELIKE.md` |
| 发布与签名流程 | `docs/RELEASING.md` |
| 当前版本与变更 | `CHANGELOG.md` |
