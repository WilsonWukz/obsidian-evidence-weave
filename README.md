# EvidenceWeave · 轻量原生关系图谱增强

**v0.3.0 experimental — Obsidian native Graph View overlay.**

EvidenceWeave 不创建新页面、不重新布局节点、不改动画布，也不需要 Cloud/MCP/Zotero API。安装并启用后，直接使用 Obsidian 自带的 **关系图谱**（全局图谱或局部图谱）。

## 交互

| 操作 | 效果 |
| --- | --- |
| 鼠标悬停论文节点 | Obsidian **自己**高亮邻接节点和线；EvidenceWeave 只为有学术语义的可见连线叠加一句可编辑说明 |
| 有 PDF 的论文节点 | 原有图谱内部浮出狭长 PDF 窗口，右侧优先，空间不够选左侧；含 +/− 缩放及 PDF 自有滚动条 |
| 没有本地 PDF / 直接 PDF 链接 | **不弹出**空白窗格 |
| 单击节点 | 固定该节点及其关系线、说明和 PDF，移走鼠标仍不变 |
| 单击另一个节点 | 锁定到新节点 |
| **单击图谱空白处** | 取消锁定，回到普通原生悬停模式 |
| 点击关系线上文字 | 出现单行编辑框；`Enter` 保存到其原始 Markdown 关系说明（同步后才传播至 R2），`Esc` 取消当前文字编辑 |
| `Cmd/Ctrl` + 点击节点 | 保留原生 Obsidian 点击打开笔记行为 |

> **先拿测试 Vault 试验。** 输入会修改你本地现有关系概览 Markdown，建议先备份 `INSES/M00-关系总览.md`。任何编辑都会将该关系标记为“用户修改待复核”，不会冒充已核验的学术结论。

## 设计约束

- **零新的 Graph View**：不调用 `registerView`，也不绘制节点、边或排布。全图平移缩放完全由原生图谱负责。
- **只注释真实存在的图边**。R2 关系记录不能凭空创造 Obsidian 的 `[[双链]]`；当前 `C00` 只直接链接 P01–P05，而 `M00-关系总览` 直接链接 P01–P30。插件会在 M00→Pxx 的实际边上复用 M00 描述的 C00→Pxx 关系，并明确保留出处的语义，不伪造 C00→Pxx 原生连线。
- 优先使用已有 `INSES/M00-关系总览.md` 里 `[[Pxx#^R-Pxx-01|...]]：一句说明。 状态：...` 关系，以及 `node_type: relation` 的独立关系笔记。没有可靠语义说明的普通 `[[wikilink]]` **不显示**关系文字。
- PDF 只来自论文笔记 frontmatter 的有效 `pdf_path` / `pdf_url` 或笔记内明确的 `.pdf` HTTPS 链接。只有 `.md` 本身没有 PDF 时不展示浮窗；链接存在但服务器禁止内嵌时，可使用浮窗中的 **↗** 在浏览器查看。
- **写入范围**：只允许当前研究文件夹（默认 `INSES/`）内有既存 relation 记录的源笔记；新文本限制单行 1–400 字，通过 Obsidian `vault.process` 原子保存，检测源文本是否变化，失败不会覆盖，并标记待复核。无自动创建、无网络上传、无批量覆盖、无删除。
- **未公开内部 API 风险**：原生 Graph View 没有官方扩展接口；插件借助 `renderer.nodeLookup`, `renderer.highlightNode`, `renderer.getHighlightNode`, `renderer.onNodeClick`, `renderer.links`, `renderer.panX/panY/scale`。兼容适配集中在 `src/graph-adapter.js`，卸载后还原原有方法。Obsidian 未来升级可能破坏兼容，尤其尚未在用户的 **Obsidian 1.14.4** 环境实际验收。
- 默认无跨会话锁定持久化。不自动影响 Obsidian Sync、Remotely Save 或 MCP，只更改本地笔记，原同步行为不变。

## 安装

1. 解压本次提供的 `evidence-weave-plugin-v0.3.0-native.zip`；将 `evidence-weave/` 放入 `Research-MCP-Test/.obsidian/plugins/`，覆盖测试 Vault 里的旧版本。
2. 完全退出并重新打开 Obsidian，在 **设置 → 第三方插件** 里启用 EvidenceWeave。
3. **打开原生的「关系图谱」**，而不是寻找 EvidenceWeave 新页面。旧版独立工作台入口已移除。
4. 悬停/单击 `INSES/P21-Dense-X-Retrieval`，检查 M00 与 P21 的原生连接是否有文字。P21 本身有 PDF URL 时才出现 PDF 浮窗。
5. 用测试性文字修改一条非关键关系，按 Enter，然后在 `INSES/M00-关系总览.md` 核对被修改的那一行；再通过原有 Remotely Save 同步。

## 构建与测试

Node >=18：

```sh
npm run build
npm test
```

无第三方运行时依赖。运行测试使用合成 Renderer 模拟，不等于真实 Obsidian 客户端验收。

## 设计参考

感谢社区对原生图谱内部接口的探索：
- [Graph Edge Notes](https://github.com/li-zane/obsidian-graph-edge-notes)（沿原生边摆放关系标签）
- [Graph Highlight Lock](https://github.com/ruruoni1/obsidian-graph-highlight-lock)（利用原生 Renderer 的高亮节点）

本仓库实现保留独立的源码结构与改动记录，并未将其他插件代码作为依赖，也不包含私有 Vault 数据或任何凭据。