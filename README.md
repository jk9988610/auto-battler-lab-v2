## 1. 项目定位

- 项目名：`Tavern Auto Battler Lab`
- 根目录：`auto-battler-lab`
- 类型：Web 多人联网自走棋学习项目
- 平台：桌面浏览器优先，移动端后置
- 目标：注册登录 → 大厅 → 8 人房间 → 完整回合 → 战斗结算 → 断线重连 → 阿里云部署

---

## 2. 技术栈推荐

建议全栈 TypeScript，减少语言切换。

| 层 | 推荐 |
|---|---|
| 前端 | Vite + React + TypeScript + Tailwind CSS + Zustand |
| 动画/卡牌 | PixiJS 或 Phaser，前期也可以 DOM/CSS 先做 |
| 后端 | Node.js 20 + NestJS + Socket.IO，或 Colyseus |
| 游戏核心 | 纯 TypeScript 包，服务端权威 |
| 数据库 | PostgreSQL + Prisma |
| 缓存/房间 | Redis |
| 登录 | JWT + Refresh Token，密码用 argon2id |
| 部署 | Docker Compose + Nginx + Certbot |
| 测试 | Vitest + Playwright |
| 工程 | pnpm workspace + Turborepo + ESLint + Prettier |

如果优先快速做出多人房间，推荐 **Colyseus**，它自带房间、状态同步、断线重连思路。  
如果想更通用、更像企业项目，推荐 **NestJS + Socket.IO**。

---

## 3. 文件夹架构

根目录用 kebab-case，不要中文、空格。

```text
auto-battler-lab/
├─ apps/
│  ├─ web/                         # 前端
│  │  ├─ public/
│  │  ├─ src/
│  │  │  ├─ app/                   # 路由、入口、Provider
│  │  │  ├─ pages/                 # LoginPage LobbyPage RoomPage GamePage
│  │  │  ├─ features/
│  │  │  │  ├─ auth/               # 登录注册
│  │  │  │  ├─ lobby/              # 大厅、房间列表
│  │  │  │  ├─ room/               # 8人准备、英雄选择
│  │  │  │  └─ game/               # 商店、棋盘、战斗
│  │  │  ├─ components/            # 通用组件
│  │  │  ├─ net/                   # socket 客户端、REST 封装
│  │  │  ├─ store/                 # Zustand 状态
│  │  │  ├─ assets/                # 占位图、音效
│  │  │  └─ styles/
│  │  └─ package.json
│  └─ server/                      # 后端
│     ├─ src/
│     │  ├─ main.ts
│     │  ├─ modules/
│     │  │  ├─ auth/
│     │  │  ├─ user/
│     │  │  ├─ room/
│     │  │  └─ game/
│     │  ├─ gateways/              # WebSocket 网关
│     │  ├─ db/                    # Prisma
│     │  ├─ redis/
│     │  └─ config/
│     └─ package.json
├─ packages/
│  ├─ shared/                      # 前后端共享 DTO、事件、类型
│  │  └─ src/
│  │     ├─ dto/
│  │     ├─ events/
│  │     └─ types/
│  ├─ game-core/                   # 核心规则，不依赖框架
│  │  └─ src/
│  │     ├─ constants.ts
│  │     ├─ state.ts
│  │     ├─ commands.ts
│  │     ├─ events.ts
│  │     ├─ shop.ts
│  │     ├─ combat.ts
│  │     ├─ rng.ts
│  │     └─ index.ts
│  └─ ui/                          # 可选，共享 UI 组件
├─ prisma/
│  └─ schema.prisma
├─ infra/
│  ├─ nginx/
│  └─ certbot/
├─ docs/
│  ├─ architecture.md
│  ├─ protocol.md
│  └─ roadmap.md
├─ docker-compose.yml
├─ .env.example
├─ package.json
└─ README.md
```

---

## 4. 核心设计原则

### 服务端权威
所有游戏逻辑必须在服务端：

- 买随从
- 卖随从
- 刷新
- 冻结
- 升级
- 上阵
- 三连
- 战斗模拟
- 扣血
- 结算

前端只做两件事：

1. 发送“我想做什么”的命令。
2. 接收服务端状态和事件，播放动画。

不要客户端算战斗结果，否则一改内存就作弊。

### 协议建议
REST 管账号和大厅，WebSocket 管游戏。

REST：

```text
POST /auth/register
POST /auth/login
POST /auth/refresh
GET  /me
GET  /rooms
POST /rooms
POST /rooms/:id/join
```

WebSocket 事件：

```ts
type ClientCommand =
  | { type: "BUY"; shopSlot: number }
  | { type: "SELL"; boardIndex: number }
  | { type: "REFRESH" }
  | { type: "FREEZE"; shopSlot: number }
  | { type: "UPGRADE" }
  | { type: "PLAY_CARD"; handIndex: number; boardIndex: number }
  | { type: "END_TURN" };
```

服务端广播：

```ts
type ServerEvent =
  | { type: "STATE_SYNC"; state: GameState }
  | { type: "COMBAT_LOG"; log: CombatLog }
  | { type: "TURN_START"; turn: number }
  | { type: "GAME_OVER"; ranking: string[] };
```

### 数据库最小表
```text
users
- id
- username
- password_hash
- email
- created_at

refresh_tokens
- id
- user_id
- token_hash
- expires_at

matches
- id
- room_id
- started_at
- ended_at
- winner_user_id

match_players
- match_id
- user_id
- hero_id
- placement
```

---

## 5. 阿里云轻量服务器部署建议

- 系统：Ubuntu 22.04 或 24.04
- 配置：2C2G
- 安全组：只开 `22`、`80`、`443`
- 不要暴露 `5432`、`6379`
- 安装 Docker + Docker Compose
- Nginx 反向代理前端、`/api`、`/socket.io`
- HTTPS 用 Certbot
- 国内服务器绑定域名'https://www.bykc.click'
- 数据库卷持久化，定期 `pg_dump`

Docker Compose 服务大概：

```yaml
services:
  nginx:
    image: nginx:alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./infra/nginx:/etc/nginx/conf.d
      - ./infra/certbot:/etc/letsencrypt
    depends_on: [web, server]

  web:
    build: ./apps/web

  server:
    build: ./apps/server
    env_file: .env
    depends_on: [postgres, redis]

  postgres:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7

volumes:
  pgdata:
```

Nginx WebSocket 关键配置：

```nginx
location /socket.io/ {
    proxy_pass http://server:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

---

## 6. 推荐开发顺序

1. 初始化 monorepo：`pnpm + apps/web + apps/server + packages/game-core`
2. 做注册、登录、JWT、密码哈希
3. 做大厅和房间列表
4. 做 8 人房间、准备、英雄选择
5. 做 `game-core` 回合状态机
6. 做商店：购买、出售、刷新、冻结、升级
7. 做战斗模拟，服务端生成战斗日志
8. 前端播放战斗动画和结算
9. 做断线重连
10. Docker 部署到阿里云
11. 最后再美化 UI、动画、音效

---


素材用：

- 开源图标
- 名字占位图
- 纯色卡牌