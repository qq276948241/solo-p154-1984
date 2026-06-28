# 私教工作室排课 API 系统

基于 Node.js + Express + TypeScript + TypeORM + MySQL 的 RESTful 排课系统。

---

## 一、技术栈

| 技术 | 版本/说明 |
|---|---|
| Node.js | >= 16 |
| Express | ^4.18.2 |
| TypeScript | ^5.3.3 |
| TypeORM | ^0.3.19 |
| MySQL | 5.7+ / 8.0 |
| JWT | jsonwebtoken |
| 密码加密 | bcryptjs |
| 日期处理 | dayjs |

---

## 二、目录结构

```
project154/
├── src/
│   ├── app.ts                      # 入口文件
│   ├── data-source.ts              # TypeORM 数据源配置
│   ├── constants/
│   │   └── error-code.ts           # 统一错误码定义
│   ├── entities/                   # 数据库实体（7张表）
│   │   ├── Member.ts               # 会员表
│   │   ├── Coach.ts                # 教练表
│   │   ├── Course.ts               # 课程表
│   │   ├── Schedule.ts             # 排课表
│   │   ├── Booking.ts              # 预约表
│   │   ├── CourseRecord.ts         # 课时变动记录表
│   │   └── CoachLeave.ts           # 教练请假表
│   ├── middleware/
│   │   ├── auth.ts                 # JWT 鉴权中间件
│   │   └── response.ts             # 统一响应 & 错误处理中间件
│   ├── controllers/
│   │   ├── member.controller.ts    # 会员模块控制器
│   │   ├── course.controller.ts    # 课程/排课/预约模块控制器
│   │   └── coach.controller.ts     # 教练模块控制器
│   ├── routes/
│   │   ├── member.routes.ts        # 会员路由
│   │   ├── course.routes.ts        # 课程路由
│   │   └── coach.routes.ts         # 教练路由
│   └── utils/
│       ├── app-error.ts            # 自定义业务异常
│       ├── password.ts             # 密码加解密工具
│       └── validate.ts             # 校验工具（手机号等）
├── .env                            # 环境变量配置
├── .env.example
├── tsconfig.json
├── package.json
└── README.md
```

---

## 三、快速开始

### 1. 环境准备

1. **MySQL** 已启动，创建数据库：
   ```sql
   CREATE DATABASE `gym_scheduling`
     DEFAULT CHARACTER SET utf8mb4
     DEFAULT COLLATE utf8mb4_unicode_ci;
   ```

2. 修改 `.env` 文件中的数据库连接信息：
   ```
   DB_HOST=localhost
   DB_PORT=3306
   DB_USERNAME=root
   DB_PASSWORD=your_password
   DB_DATABASE=gym_scheduling
   ```

### 2. 安装依赖

```bash
npm install
```

### 3. 启动开发模式

```bash
npm run dev
```

首次启动会自动创建数据库表（`synchronize: true`）。

### 4. 生产构建 & 运行

```bash
npm run build
npm start
```

### 5. 健康检查

启动后访问：`http://localhost:3000/health`

---

## 四、统一响应格式

所有接口（无论成功或失败）均返回 **HTTP 200** + 统一 JSON 结构：

```json
{
  "code": 0,
  "message": "操作成功",
  "data": { ... },
  "timestamp": 1703800000000
}
```

| 字段 | 说明 |
|---|---|
| `code` | 错误码，`0` 表示成功，非 0 表示失败 |
| `message` | 描述信息 |
| `data` | 返回的数据体，失败时为 `null` |
| `timestamp` | 服务器时间戳（毫秒） |

---

## 五、鉴权方式

除登录/注册接口外，其他接口都需要在 Header 中携带：

```
Authorization: Bearer <token>
```

会员和教练分别登录获取各自的 token，`role` 不同。

---

## 六、错误码说明

### 通用
| code | message |
|---|---|
| 0 | 成功 |
| 10001 | 参数错误 |
| 10002 | 未登录或登录已过期 |
| 10003 | 无权限访问 |
| 10005 | Token 已过期 |
| 10006 | Token 无效 |

### 会员相关
| code | message |
|---|---|
| 20001 | 会员不存在 |
| 20002 | 该手机号已注册 |
| 20003 | 密码错误 |
| 20004 | 账号已被冻结 |
| **20005** | **剩余课时不足** |

### 教练相关
| code | message |
|---|---|
| 30001 | 教练不存在 |
| **30004** | **教练请假中，暂不可约课** |
| 30005 | 教练已离职 |

### 排课/预约相关
| code | message |
|---|---|
| **50002** | **该教练此时间段已被占用（约课冲突）** |
| 50003 | 该课程已满员 |
| 50004 | 该排课已取消 |
| 50006 | 该排课时间已过 |
| 60002 | 您已预约该课程 |
| **60003** | **距开课不足 24 小时，无法取消** |

完整错误码见 `src/constants/error-code.ts`。

---

## 七、接口文档

接口统一前缀：`/api/v1`

### 7.1 会员模块 `/member/*`

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| POST | `/member/register` | 会员注册 | 否 |
| POST | `/member/login` | 会员登录 | 否 |
| GET | `/member/profile` | 获取个人信息 | 会员 |
| PUT | `/member/profile` | 修改个人信息 | 会员 |
| GET | `/member/hours` | 查询剩余课时 | 会员 |
| GET | `/member/records` | 课时变动记录 | 会员 |

**注册请求示例：**
```json
POST /api/v1/member/register
{
  "phone": "13800138000",
  "password": "123456",
  "nickname": "小明"
}
```

**查课时响应：**
```json
{
  "code": 0,
  "message": "操作成功",
  "data": {
    "remaining_hours": 28.5,
    "used_hours": 11.5
  },
  "timestamp": 1703800000000
}
```

---

### 7.2 课程模块 `/course/*`

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| GET | `/course/courses` | 课程列表（团课/私教） | 会员 / 教练 |
| GET | `/course/schedules` | 排课列表（按教练/日期） | 会员 / 教练 |
| POST | `/course/schedules` | 教练创建排课 | 教练 |
| **POST** | **`/course/book`** | **约课（核心接口）** | **会员** |
| **POST** | **`/course/cancel`** | **取消约课（24h 规则）** | **会员** |
| GET | `/course/my-bookings` | 我的预约列表 | 会员 |

#### 约课接口 `/course/book`（重点）

```json
POST /api/v1/course/book
Authorization: Bearer <member-token>
{
  "schedule_id": 1
}
```

**校验逻辑：**
1. 排课是否存在、已取消、已完成、已过期
2. 是否重复预约同一门课
3. 教练是否请假中（返回 30004）
4. 课时是否足够（返回 20005）
5. 私教：教练该时间段是否被占用（返回 50002）
6. 团课：是否已满员（返回 50003）

**成功响应：**
```json
{
  "code": 0,
  "message": "约课成功",
  "data": {
    "booking_id": 101,
    "deducted_hours": 1,
    "remaining_hours": 27.5
  }
}
```

#### 取消约课 `/course/cancel`（重点）

```json
POST /api/v1/course/cancel
Authorization: Bearer <member-token>
{
  "booking_id": 101,
  "reason": "临时有事"
}
```

**退款规则：**
| 距开课时间 | 退款比例 |
|---|---|
| >= 24 小时 | 退 50% 课时 |
| < 24 小时 | 不退课时（返回 60003 当且仅当已签到/已取消时） |

> 说明：< 24h 实际上允许取消操作但不退课时，仅在极端情况才会拦截。

**成功响应（提前 >24h）：**
```json
{
  "code": 0,
  "message": "取消成功",
  "data": {
    "booking_id": 101,
    "refunded_hours": 0.5,
    "hours_before_class": 36.5,
    "message": "已退还0.5课时"
  }
}
```

---

### 7.3 教练模块 `/coach/*`

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| POST | `/coach/register` | 教练注册 | 否 |
| POST | `/coach/login` | 教练登录 | 否 |
| GET | `/coach/list` | 教练列表 | 会员 / 教练 |
| GET | `/coach/profile` | 教练个人信息 | 教练 |
| PUT | `/coach/profile` | 修改信息 | 教练 |
| GET | `/coach/schedules` | 教练课表 | 教练 |
| **GET** | **`/coach/schedules/today`** | **今日课表 + 签到名单** | **教练** |
| GET | `/coach/schedules/:id/checkins` | 某排课签到详情 | 教练 |
| POST | `/coach/schedules/cancel` | 教练取消排课（全额退款） | 教练 |
| POST | `/coach/checkin` | 为学员签到 | 教练 |
| POST | `/coach/leave` | 提交请假 | 教练 |
| GET | `/coach/leaves` | 请假记录 | 教练 |

#### 今日课表 `/coach/schedules/today`（含签到名单）

```json
{
  "code": 0,
  "data": [
    {
      "id": 1,
      "course_name": "私教增肌课",
      "course_type": "private",
      "start_time": "2024-01-15 10:00:00",
      "end_time": "2024-01-15 11:00:00",
      "booked_count": 1,
      "checkin_list": [
        {
          "booking_id": 101,
          "member_id": 5,
          "member_nickname": "小明",
          "member_phone": "13800138000",
          "is_checked_in": 1,
          "checked_in_at": "2024-01-15 09:58:30"
        }
      ]
    }
  ]
}
```

#### 学员签到 `/coach/checkin`

```json
POST /api/v1/coach/checkin
{
  "booking_id": 101
}
```

#### 教练取消排课 `/coach/schedules/cancel`

教练主动取消排课时，**所有学员全额退款**（与会员取消不同）。

```json
POST /api/v1/coach/schedules/cancel
{
  "schedule_id": 1,
  "reason": "临时有事"
}
```

---

## 八、数据库设计（核心字段）

### `members` 会员表
| 字段 | 说明 |
|---|---|
| `phone` | 手机号（唯一） |
| `remaining_hours` | 剩余课时（小数，支持半节课） |
| `used_hours` | 累计已用课时 |
| `status` | active / frozen / expired |

### `schedules` 排课表
| 字段 | 说明 |
|---|---|
| `coach_id` | 教练ID |
| `course_id` | 课程ID |
| `start_time` / `end_time` | 起止时间 |
| `booked_count` | 已预约人数 |
| `status` | available / full / cancelled / completed |

### `bookings` 预约表
| 字段 | 说明 |
|---|---|
| `member_id + schedule_id` | 联合唯一索引 |
| `deducted_hours` | 扣课时数 |
| `refunded_hours` | 退课时数 |
| `is_checked_in` | 是否已签到 |

### `course_records` 课时变动记录
| 字段 | 说明 |
|---|---|
| `type` | deduct 扣除 / refund 退回 / recharge 充值 / adjust 调整 |
| `hours_change` | 变动数（正/负） |
| `remaining_after` | 变动后余额 |

---

## 九、事务与并发控制

- 约课、取消、签到等操作全部使用 **TypeORM 事务**，防止课时数据不一致
- 约课时对会员行加 **悲观锁**（`pessimistic_write`），避免并发约课导致课时变成负数
- 教练时间冲突通过 **SQL 时间段相交查询** 精确校验，精度到分钟
- 团课人数用 `booked_count` 原子递增，配合 `max_capacity` 判断满员

---

## 十、前端对接建议（uniapp）

1. **登录态管理**：登录后把 token 存到 `uni.setStorageSync('token', xxx)`，请求时统一放到 `header.Authorization`
2. **错误处理**：统一判断 `res.data.code !== 0` 时 `uni.showToast({ title: res.data.message })`，根据不同 code 做跳转（如 10002/10005/10006 跳登录页）
3. **时间选择**：排课建议前端以 30 分钟为最小颗粒度选择时间段，与后端校验逻辑对齐
4. **列表渲染**：`/course/schedules` 返回结构已经展平好教练名、课程名等，直接渲染即可

---

## 十一、后续可扩展功能

- [ ] 微信小程序登录（`wx.login` 换 openid 绑定手机号）
- [ ] 课时充值订单 + 微信支付
- [ ] 会员评价教练
- [ ] 教练课时统计 / 工资结算
- [ ] 系统公告、消息推送
- [ ] 批量排课（复制周课表）

