# 私教工作室排课系统 · 架构速览

> 给新来的小伙伴：这张文档帮你 10 分钟上手整个项目。看完还不清楚直接问我，别硬啃 🙈

---

## 一、整体架构：请求进来都经历了啥？

### 技术栈（都是老熟人）

| 层面 | 技术选型 | 说明 |
|------|----------|------|
| 运行时 | Node.js ≥ 16 | 配合 TypeScript 5.3 |
| Web 框架 | Express 4.18 | 轻量够用，中间件生态全 |
| 语言 | TypeScript | 别用 any，求求了 |
| ORM | TypeORM 0.3 | 实体类 + QueryBuilder 混着用 |
| 数据库 | MySQL 5.7 / 8.0 | 线上 8.0，本地 5.7 也行 |
| 鉴权 | JWT (jsonwebtoken) | 会员/教练双角色，分别登录 |
| 密码加密 | bcryptjs | 加盐 8 轮 |
| 日期处理 | dayjs | 体积小，用起来和 moment 差不多 |

### 目录分层（从上到下）

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 1  HTTP Request                                        │
│  ↓ cors / express.json() 解析 body                            │
│  ↓ responseMiddleware（给 res 注入 jsonSuccess/jsonFail）     │
├──────────────────────────────────────────────────────────────┤
│  Layer 2  Routes                                              │
│  member.routes.ts / course.routes.ts / coach.routes.ts        │
│  ↓ 绑 authMiddleware(['member'|'coach']) 做鉴权+角色校验       │
├──────────────────────────────────────────────────────────────┤
│  Layer 3  Controllers（只做接参 + 转发 + 组装返回）           │
│  member.controller.ts  (6个接口)                              │
│  course.controller.ts  (9个接口，最薄的一层，只调 service)     │
│  coach.controller.ts   (12个接口)                             │
├──────────────────────────────────────────────────────────────┤
│  Layer 4  Services（核心业务逻辑，全在这里！）                 │
│  ├─ ScheduleService     公共校验：教练时间冲突/请假            │
│  ├─ MemberHoursService  课时原子加减（悲观锁 + SQL原子 UPDATE）│
│  ├─ BookingService      约课/取消/查我的预约（全事务）         │
│  └─ WaitlistService     候补加入/取消/查候补/自动递补          │
├──────────────────────────────────────────────────────────────┤
│  Layer 5  Entities (TypeORM)  ←→  MySQL 8 张表               │
│  Member / Coach / Course / Schedule / Booking /              │
│  CourseRecord / CoachLeave / Waitlist                        │
└──────────────────────────────────────────────────────────────┘
```

### 一次约课请求的完整路径（带事务边界）

```
HTTP POST /api/v1/course/book
   │
   ▼
cors + json() 解析
   │
   ▼
authMiddleware(['member']) → 校验 JWT、role=member、注入 req.user
   │
   ▼
course.controller.ts bookCourse() → 拿 body.schedule_id + req.user.id
   │
   ▼
BookingService.bookCourse()
   │
   ├─ AppDataSource.transaction(async manager => {   ← 【事务开启】
   │
   │   1. ScheduleService.findScheduleWithRelations()
   │     └─ SELECT ... LEFT JOIN course + coach
   │
   │   2. 一堆校验：状态/时间/重复约/教练请假/私教冲突
   │
   │   3. 【团课满员】抛 80001 错误 → controller 正常走 errorHandler 返回给前端
   │            前端弹"是否进候补？" → 用户确认后调 /waitlist/join
   │
   │   4. 【正常约课】
   │        ├─ manager.save(booking) → 先插 booking 拿 id
   │        ├─ MemberHoursService.deduct()
   │        │     └─ 悲观锁会员行 + SQL 原子 SET remaining = remaining - ?
   │        ├─ schedule 计数 SQL +1
   │        └─ 满员 → schedule.status = 'full'
   │
   └─ })  ← 【事务提交/回滚】
   │
   ▼
controller → res.jsonSuccess(booking_id, deducted_hours, remaining_hours)
   │
   ▼
HTTP 200 + { code:0, data:{...} } （**永远 HTTP 200，前端按 code 判断**）
```

> 关键原则：**Controller 只接参数、调 service、返回结果，不写任何业务判断**。校验、事务、状态流转都在 Service 里。

---

## 二、模块划分：三个模块各管啥？怎么互相调？

### 一句话职责

| 模块 | 给谁用的？ | 管什么 | 不管什么 |
|------|-----------|--------|----------|
| 会员模块 `/api/v1/member/*` | 会员（C 端） | 注册/登录、个人资料、剩余课时、课时流水 | 约课/取消（归课程模块管） |
| 课程模块 `/api/v1/course/*` | 会员 + 教练 | 课程列表、排课列表、**约课核心**、**取消+退款**、**候补**、创建排课 | 签到/请假（归教练模块管） |
| 教练模块 `/api/v1/coach/*` | 教练（B 端） | 注册/登录、个人资料、**课表/今日课表**、**签到名单**、签到、取消排课、请假 | 课时、预约（会员自己管） |

### 依赖关系（谁调谁）

```
                        ┌─────────────────────┐
                        │   Controllers       │
                        │  (3 个，按模块拆)    │
                        └──┬──┬──────────┬───┬┘
                           │  │          │   │
              ┌────────────┘  │          │   └────────────┐
              ▼               ▼          ▼                ▼
     ┌────────────────┐   ┌──────────┐   ┌─────────────┐   ┌──────────────┐
     │ MemberHoursSvc │   │BookingSvc│   │WaitlistSvc  │   │ScheduleSvc   │
     │  (课时原子加减) │   │(约/取消) │   │(候补/递补)  │   │(冲突/请假校验)│
     └───────┬────────┘   └────┬─────┘   └──────┬──────┘   └──────┬───────┘
             │  调用           │  调用           │  调用            │  被调
             │                 │                 │                 │
             │                 ▼                 ▼                 ▼
             │           ┌──────────────────────────────────────────────┐
             └─────────▶ │        TypeORM Entity + MySQL                │
                         │ Member/Course/Schedule/Booking/Waitlist/...   │
                         └──────────────────────────────────────────────┘
```

**几个重要的相互调用**：
- `BookingService.cancelBooking()` 取消完后，**必须**调 `WaitlistService.autoFillFromWaitlist(manager, schedule)` 做候补递补 —— 两者共享同一个 `EntityManager`（同一个事务），要么都成要么都回滚。
- `BookingService` 和 `WaitlistService` 动课时时，**必须**走 `MemberHoursService.deduct/refund`，不能直接 `member.remaining_hours = xxx + save()`，不然并发下课时会算错（刚修过的 bug 🥲）。
- 约课/创建排课前，先走 `ScheduleService.checkCoachTimeConflict()` 和 `checkCoachOnLeave()`，这俩是纯查询工具方法，不写数据。

---

## 三、数据模型：8 张表 + 重点说明

### 核心关系图（ER）

```
  members(会员)          coaches(教练)          courses(课程)
       │                    │                      │
       │                    ▼                      ▼
       │              ┌───────────────┐    ┌──────────────┐
       │              │  coach_leaves │    │ course_type: │
       │              │  (请假记录)    │    │  group /     │
       │              └───────────────┘    │  private     │
       │                    │              └──────┬───────┘
       │                    ▼                     │
       │              ┌──────────────────────────┘
       │              ▼
       │       schedules(排课)  ←── 1 个教练 × 1 门课 × 1 个时间段
       │         │        │
       │         │        ├─ booked_count: 已预约人数
       │         │        └─ status: available/full/cancelled/completed
       │         │
       │         │     ┌─────────────┐
       │         ├────▶│  bookings   │  ← 会员预约记录（核心表！看下一节）
       │         │     └──────┬──────┘
       │         │            │
       │         │            └─ 1 booking → N course_records
       │         │
       │         └────▶ waitlists(候补)  ← 团课专属，不与 booking 混表
       │
       ▼
  course_records(课时流水)
    type: deduct(扣)/refund(退)/recharge(充)/adjust(调)
    hours_change: ±x.x
    remaining_after: 变动后的余额
```

### 重点：`bookings` 表为什么这么设计？

这是整个系统**写操作最多**的表，设计上花了点心思：

```sql
CREATE TABLE bookings (
  id              BIGINT PK,
  member_id       BIGINT,      -- 哪个会员
  schedule_id     BIGINT,      -- 哪门排课
  status          ENUM('booked','cancelled','completed','no_show'),
  deducted_hours  DECIMAL(10,1),   -- 下单时扣了多少（固定不变，退款基准）
  refunded_hours  DECIMAL(10,1),   -- 取消时退了多少（可能是 0 或 deducted/2 或全额）
  cancelled_at    DATETIME,        -- 取消时间
  cancel_reason   VARCHAR(255),
  is_checked_in   TINYINT DEFAULT 0,
  checked_in_at   DATETIME,

  UNIQUE KEY uk_member_schedule (member_id, schedule_id)   -- 🔑 联合唯一
);
```

**几个关键设计选择**：

1. **`(member_id, schedule_id)` 联合唯一索引**：一个会员对同一门排课只能有一条有效 booking。之前想过用状态拼索引，后来觉得直接 DB 层唯一最稳，service 里加 `status IN (booked, completed)` 的重复校验。

2. **`deducted_hours` 和 `refunded_hours` 分开存**：
   - `deducted_hours` 是**下单时的快照**，之后不管课程怎么改价都不变，退款就按这个算；
   - `refunded_hours` 是**实际退回去的**，会员取消提前 24h 就存 deducted/2，<24h 存 0，教练取消就存 deducted（全额）。
   - 这样退款对不对，看 booking 表就一目了然，不用翻流水。

3. **状态 4 态**：
   | 状态 | 含义 | 怎么流转到的 |
   |------|------|-------------|
   | `booked` | 已预约、正常上课中 | 约课成功 / 候补递补成功 |
   | `cancelled` | 已取消 | 会员取消 / 教练取消排课 |
   | `completed` | 已完成 | 教练点"完成排课"（TODO，暂时没做） |
   | `no_show` | 爽约没来 | 教练标记（TODO，暂时没做） |

4. **`is_checked_in` 单独一个字段**：不放到 status 里，因为签到和预约完成是两个维度（预约 booked + 已签到 vs 预约 booked + 没签到），互不干涉。

### 为什么 booking 和 waitlist **分开两张表**？

一开始想把候补也塞到 booking 里，加个 `status='waitlist'` 就行。后来踩了坑就分开了：

- booking 的唯一索引是 `(member_id, schedule_id)`，塞候补进去就会和真的 booking 冲突；
- 候补有自己独有的字段：`joined_at`（排队顺序）、`filled_at`、`booking_id`（递补成功后指向真正的 booking），这些放到 booking 里全是 nullable 的 null，看着恶心；
- 候补状态 4 态（`queued / filled / cancelled / expired`）和 booking 状态 4 态完全不同维度，硬塞一起状态流转逻辑会写成一坨。

分开之后逻辑清爽多了：候补的事情全走 `waitlists` 表，递补成功就插一条真正的 `booking`，然后把 waitlist 标记成 `filled` + 记下 `booking_id`。

---

## 四、接口清单（附登录/角色权限）

> 统一前缀：`/api/v1`；所有接口 HTTP 200 返回，`code=0` 成功，非 0 看错误码。
> 角色含义：`member` = 会员登录，`coach` = 教练登录，空 = 不用登录。

### 4.1 会员模块 `/member/*`

| 方法 | 路径 | 说明 | 登录 | 角色 |
|------|------|------|------|------|
| POST | `/member/register` | 会员注册（手机号+密码+昵称） | ❌ | - |
| POST | `/member/login` | 会员登录（手机号+密码，返回 token） | ❌ | - |
| GET | `/member/profile` | 拿自己的资料 | ✅ | member |
| PUT | `/member/profile` | 改资料（昵称/头像） | ✅ | member |
| GET | `/member/hours` | 查剩余课时 + 已用课时 | ✅ | member |
| GET | `/member/records` | 课时变动流水（分页） | ✅ | member |

### 4.2 课程模块 `/course/*`（核心）

| 方法 | 路径 | 说明 | 登录 | 角色 |
|------|------|------|------|------|
| GET | `/course/courses` | 课程列表（可按教练/类型筛） | ✅ | member / coach |
| GET | `/course/schedules` | 排课列表（按教练/日期区间） | ✅ | member / coach |
| POST | `/course/schedules` | 教练创建排课 | ✅ | **coach** |
| **POST** | **`/course/book`** | **约课（团课满员会抛 80001 给前端弹候补）** | ✅ | **member** |
| **POST** | **`/course/cancel`** | **取消约课（24h前退半，<24h不退，自动候补递补）** | ✅ | **member** |
| GET | `/course/my-bookings` | 我的预约（分页，按状态筛） | ✅ | member |
| POST | `/course/waitlist/join` | 加入团课候补队列 | ✅ | member |
| POST | `/course/waitlist/cancel` | 主动退出候补（filled 状态会报 80008，提示去预约列表取消） | ✅ | member |
| GET | `/course/waitlist/my` | 我的候补（含 `queue_position` 排队位置） | ✅ | member |

### 4.3 教练模块 `/coach/*`

| 方法 | 路径 | 说明 | 登录 | 角色 |
|------|------|------|------|------|
| POST | `/coach/register` | 教练注册 | ❌ | - |
| POST | `/coach/login` | 教练登录（返回 token） | ❌ | - |
| GET | `/coach/list` | 教练列表（会员约课页面展示） | ✅ | member / coach |
| GET | `/coach/profile` | 教练个人资料 | ✅ | coach |
| PUT | `/coach/profile` | 改资料（姓名/头像/擅长） | ✅ | coach |
| GET | `/coach/schedules` | 教练课表（可按日期筛） | ✅ | coach |
| **GET** | **`/coach/schedules/today`** | **今日课表 + 每节课的签到名单** | ✅ | **coach** |
| GET | `/coach/schedules/:id/checkins` | 某节课的签到详情 | ✅ | coach |
| POST | `/coach/schedules/cancel` | 教练取消整节排课（**所有学员全额退款**） | ✅ | coach |
| POST | `/coach/checkin` | 给某个会员签到（传 booking_id） | ✅ | coach |
| POST | `/coach/leave` | 提交请假（日期区间+原因） | ✅ | coach |
| GET | `/coach/leaves` | 请假记录 | ✅ | coach |

### 4.4 特殊接口

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| GET | `/health` | 健康检查（看 DB 连没连上） | ❌ |

---

## 五、本地启动 3 步走

### 1. 环境 & 配置

```bash
# 先确认本地有 MySQL 5.7+，建个库
mysql -u root -p
CREATE DATABASE `gym_scheduling` DEFAULT CHARSET utf8mb4;

# 拉代码后
npm install

# 复制一份环境变量
cp .env.example .env    # Windows 用 copy 或者直接手动复制
```

然后改 `.env` 里这几项（就这几项，别改别的）：

| 变量 | 说明 | 示例 |
|------|------|------|
| `PORT` | 服务端口 | 默认 3000，被占用就改别的 |
| `DB_HOST` / `DB_PORT` | MySQL 地址 | 本地就 localhost:3306 |
| `DB_USERNAME` / `DB_PASSWORD` | MySQL 账号密码 | 本地 root / 你的密码 |
| `DB_DATABASE` | 数据库名 | 建议就 `gym_scheduling` |
| `JWT_SECRET` | JWT 加密串 | 随便写点长字符串，线上要复杂点 |
| `JWT_EXPIRES_IN` | Token 有效期 | 默认 7d，别改太短 |
| `CANCEL_REFUND_THRESHOLD_HOURS` | 退款临界小时数 | 默认 24，业务不变就别动 |

### 2. 启动

```bash
# 开发模式（改代码自动重启，ts-node-dev 跑的）
npm run dev

# 或者生产模式（先编译再跑 node）
npm run build && npm start
```

启动成功你会看到：

```
[DB] MySQL 数据库连接成功
[Server] 服务已启动: http://localhost:3000
[Health] 健康检查: http://localhost:3000/health

接口前缀: /api/v1
  - 会员模块: /api/v1/member/*
  - 课程模块: /api/v1/course/*
  - 教练模块: /api/v1/coach/*
```

> 第一次启动会自动建表（`synchronize: true`，只在开发用，**线上一定要关**！）。建完后浏览器打开 `http://localhost:3000/health`，能看到 `db: connected` 就 OK 了。

### 3. 跑一下测试（MySQL 必须开着）

```bash
npx ts-node --transpile-only tests/booking-waitlist.test.ts
```

这个脚本会建一批测试会员/教练/团课，跑完 6 个场景：退款、候补递补、filled 取消提示、队列顺序等。**跑完会往库里留一些测试数据**，介意的话自己跑之前 truncate 一下或者换个测试库。

---

## 六、两个容易踩的坑（老同事血泪经验）

### 🕳️ 坑 1：不要直接 `member.remaining_hours = xxx + save()`

只要是动会员课时的（约课扣、取消退、候补递补扣），**必须**走 `MemberHoursService.deduct(manager, memberId, hours, {...})` / `refund()`。这俩方法内部是：

```sql
SELECT * FROM members WHERE id = ? FOR UPDATE;   -- 悲观锁，防并发
UPDATE members SET remaining_hours = remaining_hours + ?, used_hours = ... WHERE id = ?;
```

直接改对象 save 的话，两个请求同时进来，先查出来的值都是 20，一个 -2 成 18，另一个也 -2 成 18，最后写成 18 —— 少扣了！这个就是最开始的 Bug1，并发课时算错。

### 🕳️ 坑 2：取消预约（`BookingService.cancelBooking`）和候补递补（`autoFillFromWaitlist`）必须同一个事务

取消和递补共享同一个 `EntityManager` 传进去，不能各自开事务。否则：A 取消成功退款了，但候补递补那一步因为课时不够或啥的失败了，排课就永久少一个人，或者 B 被扣了课时但 booking 没插进去 —— 全是脏数据。

---

看完就可以上手写代码啦！有任何问题直接问，别客气 🎉
