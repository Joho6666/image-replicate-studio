# 给服务器端 AI 的提示词：为中转站加"异步出图"接口

把下面整段复制给服务器上的 AI 助手（Codex / Claude Code 等）。

---

我的服务器上跑着一个 OpenAI 兼容的 API 中转站（new-api / one-api 类），对外域名是 `https://johozz-api.duckdns.org`，出图走 `/v1/images/generations` 和 `/v1/images/edits`，一张图要 30–60 秒。我的客户端网络会把超过约 6 秒的单个 HTTP 请求强制断开，所以需要在服务器上加一个**异步出图代理**：提交马上返回任务号，客户端再轮询结果，每个请求都在几秒内结束。

**先排查，不要改现有服务**：看清楚中转站是怎么部署的（docker / systemd、监听端口、前面是 nginx 还是 caddy、证书怎么配的），把结论告诉我再动手。现有的 `/v1/...` 接口和行为必须保持不变。

## 要做的服务
一个独立的小服务（Node.js 或 Python，选服务器上现成的运行环境，用 systemd 或 docker 常驻、开机自启），只监听 `127.0.0.1`，由现有反向代理把 `/async/` 前缀转发给它。它在服务器内部把请求转发给中转站本机地址（例如 `http://127.0.0.1:<中转站端口>`），不要绕回公网域名。

## 接口
1. `POST /async/v1/images/generations`
   - 请求体、`Authorization: Bearer <key>` 和 OpenAI 一样，原样转发给中转站的 `/v1/images/generations`。
   - 立刻返回 `202 {"id":"<任务号>","status":"queued"}`，任务号用随机 UUIDv4。
2. `POST /async/v1/images/edits`
   - multipart/form-data（字段 `model`、`prompt`、`n`、`size`、`quality`，以及一个或多个 `image[]` 文件），原样转发（保留 content-type 和 boundary）给 `/v1/images/edits`。
   - 同样立刻返回 202 和任务号。请求体上限 50MB。
3. `GET /async/v1/jobs/<任务号>`
   - 必须带同一个 Bearer key，key 不匹配一律返回 404。只存 key 的 SHA-256，不要存或打印明文 key。
   - 返回 `{"id","status":"queued|running|succeeded|failed","created_at","finished_at","images":[{"url":"/async/v1/jobs/<任务号>/images/0","bytes":<大小>}],"error":{"status":<上游状态码>,"body":<上游返回内容>}}`。
   - **响应里不要放 base64 图片**，保持很小。
4. `GET /async/v1/jobs/<任务号>/images/<序号>`
   - 同样校验 key，返回图片二进制，带正确的 `Content-Type` 和 `Content-Length`。
   - 上游返回 `b64_json` 就解码后存盘；返回 `url` 就由服务器下载后存盘。
5. `GET /async/health`：返回 `{"ok":true,"queued":n,"running":n}`，不需要 key。

## 细节要求
- 转发上游的超时设为 300 秒。上游返回的 HTTP 错误（429、审核拦截 400 等）原样记进 `error`，状态设为 failed，**不要自动重试**。
- 同时向上游并发最多 3 个任务，多的排队（中转站本身也限制约 3 并发）。
- 任务和图片存到磁盘（例如 `/var/lib/async-images/<任务号>/`），服务重启后能查到已完成的任务。完成超过 24 小时的自动清理。
- 日志只记任务号、状态、耗时、上游状态码，不记 key 和提示词全文。
- 反向代理里给 `/async/` 设置 `client_max_body_size 50m`（nginx）或对应配置，读写超时至少 60 秒。不要改证书和其他路由。

## 验收（做完把输出给我）
在服务器上执行：
1. `curl https://johozz-api.duckdns.org/async/health`
2. 用一个真实 key 提交一张 `gpt-image-2.5-flare`、size `1024x1024` 的生成任务，记下任务号。
3. 每 5 秒查一次任务状态，直到 succeeded，下载图片，确认文件是 PNG 或 JPEG。
4. 用错误的 key 查同一个任务号，确认返回 404。
5. 再提交一个带 1 张参考图的 edits 任务，确认也能成功。

最后告诉我：服务装在哪、怎么重启、日志在哪看、改了反向代理哪几行。

---

# 追加：/async/ 没有转发到新服务时（2026-11-04 实测）

从外网访问 `https://johozz-api.duckdns.org/async/health`，返回的是中转站网页前端（`text/html`，标题 "JOHO - AI API Gateway"），而不是 `{"ok":true}`。说明 `/async/` 前缀没有转发到异步服务，被前端的兜底路由接住了。请：

1. 在服务器上直接请求异步服务的本机端口（例如 `curl http://127.0.0.1:<端口>/async/health`），确认服务本身在跑、返回 JSON。
2. 找出 `johozz-api.duckdns.org` 实际由哪个进程处理 443 端口（`ss -ltnp | grep 443`、`docker ps`），确认改的是**真正对外的那层**反向代理（可能是 docker 里的 nginx/caddy，或中转站程序自己直接监听 443），而不是没在用的配置文件。
3. 在那层把 `/async/` 前缀转发给异步服务，并且这条规则要排在前端兜底路由（`/` 或 `try_files ... /index.html`）**之前**。改完重载配置。
4. 从服务器外面验证：`curl -i https://johozz-api.duckdns.org/async/health` 必须返回 `Content-Type: application/json` 和 `{"ok":true,...}`。然后把原文档里的验收步骤 2–5 跑一遍，把输出给我。
