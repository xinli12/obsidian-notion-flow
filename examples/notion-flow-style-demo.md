# Style sampler · 样式样张

> Run **Change note style…** (切换样式配色…) and arrow through the palettes and looks — this page re-skins live, `Esc` restores. Nothing here changes when you switch; only how it is drawn. / 运行「切换样式配色…」，用方向键浏览各套配色与版式；按 Esc 还原。切换只改变显示，Markdown 不变。

Body text with **bold**, *italic*, [[notion-flow-demo|an internal link]], [an external link](https://obsidian.md), `inline code` and ==a default highlight==. 正文示例：**加粗**、*斜体*、`行内代码`、==默认高亮==。

<span style="color:var(--nf-gray, #7c7b77)">Gray 灰</span> · <span style="color:var(--nf-red, #b5554d)">Red 红</span> · <span style="color:var(--nf-orange, #b87333)">Orange 橙</span> · <span style="color:var(--nf-yellow, #a9822f)">Yellow 黄</span> · <span style="color:var(--nf-green, #4e8060)">Green 绿</span> · <span style="color:var(--nf-cyan, #43868c)">Cyan 青</span> · <span style="color:var(--nf-blue, #4a7ca6)">Blue 蓝</span> · <span style="color:var(--nf-purple, #7f62a3)">Purple 紫</span> · <span style="color:var(--nf-pink, #a85480)">Pink 粉</span>

<mark style="background:rgba(var(--nf-gray-rgb, 124,123,119), 0.18);color:inherit">Gray 灰</mark> <mark style="background:rgba(var(--nf-red-rgb, 181,85,77), 0.18);color:inherit">Red 红</mark> <mark style="background:rgba(var(--nf-orange-rgb, 184,115,51), 0.18);color:inherit">Orange 橙</mark> <mark style="background:rgba(var(--nf-yellow-rgb, 169,130,47), 0.2);color:inherit">Yellow 黄</mark> <mark style="background:rgba(var(--nf-green-rgb, 78,128,96), 0.18);color:inherit">Green 绿</mark> <mark style="background:rgba(var(--nf-cyan-rgb, 67,134,140), 0.18);color:inherit">Cyan 青</mark> <mark style="background:rgba(var(--nf-blue-rgb, 74,124,166), 0.18);color:inherit">Blue 蓝</mark> <mark style="background:rgba(var(--nf-purple-rgb, 127,98,163), 0.18);color:inherit">Purple 紫</mark> <mark style="background:rgba(var(--nf-pink-rgb, 168,84,128), 0.18);color:inherit">Pink 粉</mark>

> [!tip] Tip · 提示
> A callout of the palette's tip hue. 标注会随配色方案换色，随版式换造型。

## Heading 2 · 二级标题

### Heading 3 · 三级标题

#### Heading 4 · 四级标题

## Lists · 列表

- Bullet · 圆点
	- Second level · 第二层
		- Third level · 第三层
- Back to the first level · 回到第一层

1. Numbered · 编号
	1. Nested · 嵌套
2. Second step · 第二步

- [ ] To-do · 待办
- [x] Done · 已完成

## Quote · 引用

> A good palette lets the structure speak instead of every element shouting. 好的配色让结构自己说话。

- A list item with a quote under it · 列表中的引用
  > Quotes inside lists keep their look. 列表里的引用保持同样的造型。

---

## Tables · 表格

| Task · 任务 | Owner · 负责人 | Status · 状态 |
| :--- | :--- | :---: |
| Outline | Alex | <span class="nf-cell-green">Ready</span> |
| Review | Mei | <span class="nf-cell-yellow">In progress</span> |
| Publish | Sam | <span class="nf-cell-red">Not started</span> |

| <span class="nf-tbl-blue"></span>Quarter · 季度 | Revenue · 收入 | Growth · 增长 |
| --- | ---: | ---: |
| Q1 | 120 | 8% |
| Q2 | 146 | 21% |
| Q3 | 171 | 17% |

## Callouts · 标注

> [!note] Note · 笔记
> The everyday callout. 最常用的标注。

> [!warning] Warning · 警告
> Check this before you publish. 发布前请检查。

> [!danger] Danger · 危险
> This cannot be undone. 此操作无法撤销。

> [!success] Success · 成功
> Every check passed. 全部检查通过。

> [!example] Example · 示例
> `/tip` inserts a tip callout. 输入 `/提示` 插入提示标注。

> [!quote] Quote · 引用
> Simplicity is the ultimate sophistication. 大道至简。

> [!question]- A foldable question · 可折叠
> Hidden until you open it. 展开后才可见。

> [!note|nf-pink] Any type in any color · 任意类型任意颜色
> Stored as `|nf-pink` after the type. 颜色以 `|nf-pink` 写在类型之后。

> [!tip] Nested · 嵌套
> Outer text. 外层文字。
> > [!warning] Inner · 内层
> > Inner text. 内层文字。

> [!info] A title-only callout · 只有标题

## Toggles · 折叠块

> [!nf-toggle]+ An open toggle · 展开的折叠块
> Content with <span style="color:var(--nf-purple, #7f62a3)">purple text</span>. 内容里的<span style="color:var(--nf-purple, #7f62a3)">紫色文字</span>。

> [!nf-toggle]- A closed toggle · 收起的折叠块
> Hidden content. 隐藏的内容。

## Columns · 分栏

> [!nf-cols]
> > [!nf-col]
> > **Left · 左栏** with a <mark style="background:rgba(var(--nf-green-rgb, 78,128,96), 0.18);color:inherit">green highlight</mark>.
>
> > [!nf-col]
> > **Right · 右栏** with a <mark style="background:rgba(var(--nf-purple-rgb, 127,98,163), 0.18);color:inherit">purple highlight</mark>.

## Code · 代码

A sentence with `inline code` in it. 句中的 `行内代码`。

```ts
// reading time · 阅读时长
export function readingTime(text: string, wpm = 220) {
  const words = text.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / wpm));
}
```

## Block color and callout icons · 块颜色与标注图标

A paragraph on a blue background. 蓝色背景的段落。 <span class="nf-blk-blue"></span>

> [!tip|nfi-rocket] A callout with its own icon · 自定义图标
> Picked with **Icon…** on the callout's icon menu. 在标注图标菜单的「图标…」中选择。
