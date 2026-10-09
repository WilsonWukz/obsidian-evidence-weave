# EvidenceWeave · 原生关系图谱轻量增强

**v0.4.1 / candidate, native Graph View only.**

EvidenceWeave 不创建新图谱页面，不替换 Obsidian 的节点、连线、物理布局、拖拽、平移、缩放和原生配色。它只给 Obsidian 自带的 Graph View 添加一条学术关系短句和同一画布上的 PDF 阅读窗。仍然独立于 Cloudflare / Obsidian MCP / Zotero Cloud。

## 操作

| 操作 | 行为 |
| --- | --- |
| 悬停论文节点 | 原生高亮连接；有**真实两端关系**的连线显示方向短句；有 PDF 才在节点附近显示阅读器 |
| 单击节点 | 锁定**阅读焦点**，原生节点仍可随物理布局运动；移开鼠标不换论文 |
| 单击空白画布 | 解除锁定，恢复原生悬停 |
| 放大/缩小及平移图谱 | 原生图谱照常交互；浮动 PDF 的位置和**整块尺寸**随图谱相同的相机参数变换 |
| **按住 PDF 标题栏并拖动** | 在同一原生图谱画布上自由移动 PDF；松开后保留位置，图谱缩放/平移时仍一起变换；不会拖动节点或改变 PDF 大小 |
| 拖动 PDF 任意四角 | 只调整 PDF 的基础宽/高，默认记住尺寸；不会拖动原生图谱 |
| 在 PDF 内滚动 | 阅读 PDF 正文，避免双层滚动区域；不会误触发图谱缩放 |
| 点击关系短句 | 内联编辑 `label_from_source` / `label_from_target`，或 M00 的独立短句字段；回车保存，Esc 取消 |
| 输入中文时按回车选词 | 不会触发保存，支持 IME composition |
| Cmd/Ctrl+点击节点 | 沿用 Obsidian 原生打开笔记行为 |
| 悬停 PDF 中心后阅读 | 保持原 PDF DOM 和阅读滚动位置；其他笔记刷新不会重载同一个 PDF |
| PDF↗ | 在外部浏览器打开完整来源；远程 PDF 可以尝试 `↻` 一次性载入完整文档到内存 |

**默认 PDF 宽 495px、高 810px**（相对于 v0.3 的 330×450 即 1.5×、1.8×）。原 v0.3 默认值会迁移；已经自定义过的尺寸予以保留。缩放后的尺寸不会被强行缩回视口，以保持同一世界画布的逻辑。

## 边上的文字与学术证据分开存储

长篇学术证据继续留在 `INSES/M00-关系总览.md` 的原行，未核验的原文不能替换为简写。该行下方可以有两个单行字段：

```markdown
- [[P21-Dense-X-Retrieval#^R-P21-01|P21 · Dense X Retrieval]]：INSES §2.2...详细证据与限定。 状态：有限关系已审；整合待验收。
  - **图谱正向短句**：提供细粒度检索背景
  - **图谱反向短句**：被 INSES 作为粒度研究背景引用
  - **图谱短句审核**：用户修改待复核
```

从 C00 悬停时使用“正向短句”；从 P21 悬停时使用“反向短句”。两者可以不同。点击缺失短句的关系连线时，会出现轻量“＋短句”，由用户填写；**插件不会自动从长篇证据硬截一段或伪造摘要**。短句变更只写这些专用字段，旧“详细证据”和其学术审查状态不变，新的短句独立标为待复核。

如果使用独立关系笔记，保留 `summary_from_source` / `summary_from_target` 作为详细说明，新增：

```yaml
label_from_source: "在该问题上提供相关背景"
label_from_target: "被中心论文作为背景引用"
label_review_status: unverified
```

**严格按真实原生边标注。** `M00 → Pxx` 表示“总览笔记链接了 Pxx”，**不自动等于** `C00 → Pxx` 的学术关系，因此 v0.4 去掉了 v0.3 的 M00 关系语义借用。同一个学术关系也不会自动复制两份到不同边上。为了显示更多 C00→Pxx 的学术关系，需要在 C00 笔记中建立真实 `[[wikilink]]` 或使用已经存在的真实 C00 边；插件不自动改写 Vault 或创造假边。

## PDF 完整阅读与限制

1. 优先使用本地 Vault 已存在的 PDF (`pdf_path` / Obsidian 附件)。阅读器只渲染一次；在修改旁边短句或其他元数据时不重复载入。
2. 只有 HTTP(S) PDF 链接时，使用 Chromium 原生 PDF frame，`loading=eager`，外层不再通过 `style.zoom` 放缩文档，也不再有第二层纵向滚动容器。
3. 若出版社服务器不支持 iframe、HTTP Range 下载或内嵌 PDF 出现后半段空白，用户可点击 `↻`，经 **Obsidian requestUrl** 单次请求全文（**30MB 上限**），校验 PDF 文件头，使用 `blob:` URL 重新阅读。**只保存在当前内存，不写入 Vault、R2 或仓库**；离开 PDF 即释放 blob。
4. 无法保证任何第三方 PDF 服务器都支持内嵌，也不能仅凭 PDF iframe `load` 判断所有页面是否可读；因此始终提供 `↗` 供外部阅读。需要通过 Mac 端具体文件确认最后一页可达。
5. 鼠标在 PDF 页面内滚轮用于翻页；在外侧原生图谱上缩放会**同步缩放 PDF 与整个画布**。这是有意区分的两种手势。

## 安装 / 升级

1. 先备份测试 Vault 的 `.obsidian/plugins/evidence-weave` 及 `INSES/M00-关系总览.md`。
2. 将 `evidence-weave-plugin-v0.4.1-native.zip` 内的 `evidence-weave/` 解压到 `Research-MCP-Test/.obsidian/plugins/` 覆盖旧版。
3. 重新启动 Obsidian，或先禁用再启用 EvidenceWeave。
4. 直接打开 Obsidian **核心插件「关系图谱」**，而非以前的自制工作台。
5. 测试 P01 / P21 等论文节点；先看原生节点是否仍能拖动及释放后受力运动，再检查标签、锁定、**PDF 标题栏平移**、图谱缩放、四角调整大小、长 PDF 滚动和短句写回。

**重要：** 原生 Graph View 的内部 Renderer API 未公开，Obsidian 1.14.4 的真正物理动画、交互和不同出版社 PDF 兼容性，必须在使用者 Mac 上实测。单元测试与 Chromium 模拟只验证我们没有主动改写原生物理控制与相关 DOM 行为；不代表原生实际版本已验收。

## 本地构建与安全界限

```sh
npm run build
npm test
python tests/browser-smoke.py  # 需要 Python Playwright + Chromium，用合成模拟 Renderer
```

- 插件只读取当前 Vault，并仅在用户回车确认后通过 `vault.process` 改写**原有关系短句字段**；单行 1–70 字、版本守卫、失败保留输入草稿。不会写私人研究数据到 GitHub。
- 不生成独立 Graph View，不更改真实 `renderer.nodeLookup[*].x/y`，也不把虚拟边插入图中。点击锁定仅选择当前焦点，卸载还原拦截的方法。
- 前端 overlay 随原生图的相机移动，无额外同步服务、HTTP 代理或自动 PDF 云端上传。
- 研究证据和 AI 生成解释必须独立审核；短句不等于科学事实。

## Acknowledgments

设计参考 [Graph Edge Notes](https://github.com/li-zane/obsidian-graph-edge-notes) 的原生边语义叠加方法、[Graph Highlight Lock](https://github.com/ruruoni1/obsidian-graph-highlight-lock) 的聚焦机制；本仓库独立实现并非复制其源码。
