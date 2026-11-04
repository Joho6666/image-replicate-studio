# 图片复刻 Studio 设计（2026-11-03）

目标：把"抖音案例 → moodboard → 结构化提示词 → 批量出图 → 固定模特换脸 → 对比挑图 → 导出"做成本地 GUI，并配一个 skill，让以后的图片复刻不用每次手搭。

## 技术
零依赖 Node（>=20，原生 fetch/FormData）+ 原生 HTML/JS，端口 3400，`启动图片复刻.bat` 启动。

## 模块
| 文件 | 职责 |
|---|---|
| `server.mjs` | HTTP 接口 + 静态页面 + 项目文件访问 |
| `lib/config.mjs` | 路径、读 `.env.local`：生图中转站地址和 key、TikHub key、ffmpeg 路径（模板见 `.env.example`） |
| `lib/queue.mjs` | 并发上限 3 的任务队列 + 429/5xx 重试 |
| `lib/relay.mjs` | JOHO 中转站生图：无参考图走 `/images/generations`，有参考图走 `/images/edits` |
| `lib/douyin.mjs` | TikHub 抓抖音图文原图/文案，视频则下载后每 6 秒截帧 |
| `lib/prompt.mjs` | 表单 → 英文提示词（验证过的配方），moodboard / 固定模特 / 换脸引导语 |
| `lib/post.mjs` | ffmpeg 后期（调色+噪点）、裁剪、截帧、九宫格/六宫格拼图 |
| `lib/store.mjs` | 项目存储（内存缓存为准，写回 `project.json`） |

## 数据
`data/projects/<id>/`：`project.json`、`refs/<作品id>/`（案例图）、`refs/upload/`、`faces/`、`outputs/`、`exports/<时间>/`。
所有文件路径在 project.json 里存成相对项目目录的路径。

## 界面
案例（抓链接、勾 moodboard ≤3）/ 模特（上传或从出图裁脸）/ 出图（表单+预设+预览可手改、模型、张数、后期开关）/ 画廊（打星、和案例原图对比、换脸、设为模特、勾选导出）。

## 出错
审核拦截显示原因和改词建议；429 自动排队重试；TikHub/下载失败显示具体原因；单张失败不影响同批其它张。

## 验收
`node --test` 覆盖提示词拼装与队列；浏览器跑通：抓案例 → 出 1 张 → 换脸 → 导出。
