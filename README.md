# 招聘报名信息提取系统

基于 Next.js + PaddleOCR + LLM 的智能信息提取系统，支持从多种文档格式中自动抽取招聘报名信息，并按照自定义模板生成结构化数据。

## 📋 功能特性

### 核心功能
- 🚀 **多格式支持**：支持 PDF、JPEG、JPG、PNG、TIFF、TIF、BMP 文件
- 🤖 **智能识别**：使用 PaddleOCR-VL 进行高精度文字识别
- 🎯 **精准提取**：基于 LLM 的智能信息抽取，支持自定义模板
- ✅ **数据校验**：自动校验提取数据的真实性和完整性
- 🎨 **可视化标记**：用不同颜色标记数据校验状态
- 📊 **多格式输出**：同时生成 Excel 和 JSON 格式结果
- 👥 **多用户隔离**：每个用户拥有独立的数据空间
- 🔒 **自定义 Token**：支持用户配置自己的 OCR API Token
- 💾 **智能缓存**：文件解析结果缓存，避免重复识别
- 🔄 **继续上传**：支持向已有任务追加新文件

### 高级功能
- ⚡ **后台任务处理**：超过5个文件自动提交到后台任务队列
- 🎖️ **任务优先级**：支持高/普通/低三级优先级，高优先级任务优先处理
- 📦 **分块上传**：支持大文件分块上传，绕过4MB请求体大小限制
- 📡 **SSE 实时推送**：使用 Server-Sent Events 实时推送处理进度
- 🌊 **流式输出**：LLM 响应采用流式输出，提升用户体验
- 🛡️ **任务恢复**：后台处理器崩溃后自动恢复卡住的任务
- ⏱️ **超时保护**：为 OCR 识别（120秒）和 LLM 提取（180秒）添加超时保护
- 📊 **任务管理**：完整的任务列表、详情查看、批量操作功能

## 🛠️ 技术栈

### 前端
- **框架**：Next.js 16 (App Router)
- **UI 库**：React 19 + TypeScript 5
- **组件库**：shadcn/ui (基于 Radix UI)
- **样式方案**：Tailwind CSS 4
- **状态管理**：React Hooks

### 后端
- **API 框架**：Next.js API Routes
- **Python 脚本**：
  - `paddleocr.py`：PaddleOCR-VL 调用
  - `llm_extract.py`：豆包 LLM 信息提取
  - `excel_filler.py`：Excel 文件生成
  - `get_template_headers.py`：读取 Excel 模板表头
- **后台处理**：Node.js 常驻进程（`background-processor.js`）

### 集成服务
- **OCR 服务**：PaddleOCR-VL API（百度飞桨）
- **LLM 服务**：豆包大语言模型（方舟）
- **存储**：文件系统 + localStorage

### 核心技术
- **实时通信**：Server-Sent Events (SSE)
- **流式处理**：ReadableStream + Generator
- **并发控制**：最大并发数 5
- **任务队列**：基于文件系统的优先级队列
- **缓存策略**：MD5 哈希 + 文件系统

## 🚀 快速开始

### 环境要求

- **Node.js**：24+
- **Python**：3.8+（推荐 Python 3.10+）
- **包管理器**：pnpm（推荐）或 npm
- **Python 包管理器**：pip3

### 安装依赖

```bash
# 安装 Node.js 依赖
pnpm install

# 安装 Python 依赖（自动安装）
pip3 install -r requirements.txt
```

**Python 依赖说明：**
- `openpyxl`：用于处理 Excel 文件
- `requests`：用于 HTTP 请求
- `Pillow`：用于图片处理

> 💡 **提示**：构建和启动脚本会自动安装 Python 依赖，无需手动操作。

### 启动开发服务器

```bash
# 启动开发环境（端口 5000）
pnpm dev

# 构建生产版本
pnpm build

# 启动生产环境
pnpm start
```

访问 http://localhost:5000 即可使用。

### 启动后台处理器

系统会自动启动后台处理器，无需手动操作。如需手动启动：

```bash
# 开发环境
pnpm dev:processor

# 生产环境
pnpm start:processor
```

后台处理器日志位于：`/app/work/logs/bypass/processor.log`

## 📖 使用指南

### 1. 获取 OCR API Token

首次使用前，需要获取百度飞桨的 OCR API Token：

1. 访问 [百度飞桨 AI Studio](https://aistudio.baidu.com/account/accessToken)
2. 登录账号并获取 Access Token
3. 在系统首页点击"设置 Token"按钮
4. 输入 API Token 和 API URL 并保存

> ⚠️ **注意**：Token 和 API URL 仅保存在本地浏览器 localStorage 中，不会上传到服务器，请妥善保管。

### 2. 创建新任务

#### 方式一：实时处理（文件数量 ≤ 5）

1. 在首页点击"新建任务"按钮
2. 上传文档文件（支持多种格式）
3. 选择使用默认模板或上传自定义 Excel 模板
4. 选择任务优先级（仅后台任务生效）
5. 点击"开始提取"按钮
6. 实时查看处理进度和结果

#### 方式二：后台任务（文件数量 > 5）

1. 上传多个文档文件（超过5个）
2. 系统自动检测并提交到后台任务队列
3. 选择任务优先级：
   - 🔴 **高优先级**：立即处理，适合少量紧急文件
   - 🔵 **普通优先级**：正常处理顺序，适合常规任务
   - ⚫ **低优先级**：空闲时处理，适合大批量文件
4. 提交后可关闭页面，任务在后台继续执行
5. 通过"任务管理"页面查看任务进度和结果

### 3. 查看结果

处理完成后，系统会自动生成：
- **Excel 文件**：`result.xlsx` - 包含所有提取的数据，带有颜色标记
- **JSON 文件**：`result.json` - 结构化的 JSON 数据，便于程序处理

#### 数据校验标记

系统会自动校验提取的数据，并使用颜色标记：
- 🟢 **绿色**：数据完整且格式正确
- 🟡 **黄色**：数据可能有问题，需要人工审核
- 🔴 **红色**：数据缺失或格式错误

校验摘要包含：
- ✅ 正常（ok）
- ⚠️ 存疑（warning）
- ❌ 错误（error）

### 4. 继续上传

如需向现有任务添加更多文件：

1. 点击"继续上传"按钮
2. 上传新的文件
3. 提交后数据会追加到已有结果中
4. 新结果会覆盖旧的 Excel 和 JSON 文件

**工作原理**：
- 前端将当前任务ID传递给后端API
- 后端验证任务归属和状态（不能处理正在进行的任务）
- 使用现有任务目录和结果文件进行数据追加
- 任务元数据中的文件列表和记录列表会合并
- 新上传的文件解析后追加到已有Excel和JSON文件中

**限制条件**：
- 任务状态不能是"processing"（正在处理中）
- 任务必须属于当前用户
- 模板和配置可以更改，系统会重新解析

**缓存复用**：
- 系统会检查新文件是否已经被缓存
- 如果已缓存（相同文件+模板组合），直接从缓存读取结果

### 5. 任务管理

点击"任务管理"按钮可查看所有历史任务，支持以下功能：

#### 任务列表
- 查看所有任务的名称、状态、优先级、创建时间
- 查看上传文件列表和下载原始文件
- 查看文件统计和校验统计
- 下载处理结果（Excel 和 JSON）

#### 任务详情（仅后台任务）
- 查看任务状态信息（状态、优先级、进度、执行时间）
- 实时查看处理日志（SSE 推送）
- 下载结果文件

#### 批量操作
- 全选/取消全选任务
- 批量删除选中的任务
- 清空所有任务

### 6. 缓存管理

系统实现了智能缓存机制：

#### 缓存策略
- **缓存标识**：文件 MD5 哈希 + 模板 MD5 哈希
- **缓存命中**：相同文件 + 相同模板 = 使用缓存结果
- **缓存位置**：`temp/cache/{user_id}/` 目录（按用户隔离）

#### 清除缓存
- 点击首页"清除缓存"按钮
- 仅清除当前用户的缓存
- 其他用户的缓存不受影响

## 📁 文件格式支持

| 格式 | 扩展名 | 说明 | 处理方式 |
|------|--------|------|----------|
| PDF | `.pdf` | 支持多页 PDF 文档 | 直接 OCR 识别 |
| JPEG | `.jpg`, `.jpeg` | 标准JPEG格式 | 直接 OCR 识别 |
| PNG | `.png` | PNG格式 | 自动转换为JPEG |
| TIFF | `.tiff`, `.tif` | TIFF格式 | 自动转换为JPEG |
| BMP | `.bmp` | BMP格式 | 自动转换为JPEG |

> 💡 **提示**：PNG、TIFF、TIF、BMP 格式会自动转换为 JPEG 格式后再进行 OCR 识别，以确保最佳的兼容性和性能。

## 📝 自定义模板

### 默认模板

系统提供默认的招聘信息提取模板，包含以下字段：
- 序号、报名序号、招聘单位、岗位名称
- 姓名、身份证号码、手机联系方式、邮箱
- 性别、出生年月民族、籍贯、政治面貌
- 集体户口、户籍所在地、详细居住地
- 硕士/本科/大专/高中毕业学校、专业、毕业时间
- 是否退役士兵、立功情况、社会工作者职称、备注等

### 使用自定义模板

1. 准备 Excel 文件，第一行为表头
2. 在首页选择"上传自定义模板"
3. 上传您的 Excel 模板文件
4. 系统会按照您的模板字段提取数据

### 模板要求

- **文件格式**：Excel (.xlsx 或 .xls)
- **表头**：第一行为字段名称
- **字段数量**：无限制，根据实际需求设置
- **字段顺序**：无要求，系统会自动识别

## 🏗️ 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        前端层 (Next.js)                       │
├─────────────────────────────────────────────────────────────┤
│  - 首页 (文件上传 + 优先级选择)                               │
│  - 任务管理页面 (任务列表 + 详情查看)                           │
│  - 实时进度显示 (SSE)                                         │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                       API 层 (Next.js API Routes)             │
├─────────────────────────────────────────────────────────────┤
│  POST /api/submit-task              - 提交后台任务            │
│  POST /api/process-uploaded-files   - 实时处理（SSE）         │
│  POST /api/upload-chunk             - 分块上传               │
│  GET  /api/tasks                    - 获取任务列表           │
│  GET  /api/tasks/[id]/logs          - 获取任务日志           │
│  GET  /api/tasks/[id]/stream        - SSE 实时推送           │
│  GET  /api/download                 - 文件下载               │
│  DELETE /api/tasks/[id]             - 删除任务               │
└─────────────────────┬───────────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
┌──────────────────────┐  ┌──────────────────────────────┐
│   后台处理器          │  │   Python 脚本                │
│   (Node.js 常驻进程)  │  ├──────────────────────────────┤
│                      │  │  paddleocr.py      - OCR识别   │
│  - 任务队列管理       │  │  llm_extract.py     - LLM提取  │
│  - 优先级调度         │  │  excel_filler.py   - Excel生成│
│  - 并发控制 (max 5)   │  │  get_template_headers.py      │
│  - 任务恢复           │  └──────────────────────────────┘
│  - 超时保护           │
└──────────────────────┘
```

### 处理流程

#### 实时处理（文件数量 ≤ 5）

```
1. 用户上传文件 → 2. 分块上传到临时目录
    ↓
3. 提交到 /api/process-uploaded-files
    ↓
4. 创建任务目录 (tasks/{user_id}/{task_id}/)
    ↓
5. 逐个处理文件：
   - 检查缓存（文件哈希 + 模板哈希）
   - OCR识别（paddleocr.py，120秒超时）
   - LLM提取（llm_extract.py，180秒超时）
   - 保存缓存
    ↓
6. 生成 Excel 和 JSON 文件（excel_filler.py）
    ↓
7. 通过 SSE 实时推送进度到前端
    ↓
8. 完成，返回下载链接
```

#### 后台任务（文件数量 > 5）

```
1. 用户上传文件 → 2. 分块上传到临时目录
    ↓
3. 提交到 /api/submit-task
    ↓
4. 创建任务元数据
    ↓
5. 将任务添加到队列（按优先级分类）：
   - queue/high/pending/
   - queue/normal/pending/
   - queue/low/pending/
    ↓
6. 后台处理器从队列取任务
    ↓
7. 处理文件（同实时处理流程）
    ↓
8. 定期同步任务进度到任务目录
    ↓
9. 完成，用户通过任务管理页面查看
```

### 数据存储结构

```
项目根目录（只读）
├── src/                          # 前端源码
├── scripts/                      # Python 脚本
│   ├── paddleocr.py
│   ├── llm_extract.py
│   ├── excel_filler.py
│   ├── get_template_headers.py
│   └── background-processor.js   # 后台处理器
├── assets/                       # 静态资源
│   └── 个人信息提取结果-模板.xlsx
└── ...

临时目录（可写，按用户隔离）
├── tasks/                        # 任务数据
│   └── {user_id}/                # 用户ID
│       └── {task_id}/            # 任务ID
│           ├── uploads/          # 原始文件
│           │   ├── file1.pdf
│           │   └── file2.pdf
│           ├── results/          # 解析结果
│           │   ├── result.xlsx
│           │   └── result.json
│           └── task.json         # 任务元数据
├── queue/                        # 任务队列
│   ├── high/                     # 高优先级
│   │   ├── pending/
│   │   ├── processing/
│   │   └── completed/
│   ├── normal/                   # 普通优先级
│   │   ├── pending/
│   │   ├── processing/
│   │   └── completed/
│   └── low/                      # 低优先级
│       ├── pending/
│       ├── processing/
│       └── completed/
└── cache/                        # 解析缓存
    └── {user_id}/                # 按用户隔离
        ├── {file_hash}_{template_hash}.json
        └── ...
```

### 任务元数据结构

```typescript
interface TaskMetadata {
  id: string;                      // 任务ID
  user_id: string;                 // 用户ID
  name: string;                    // 任务名称
  created_at: string;              // 创建时间
  started_at?: string;             // 开始时间（后台任务）
  completed_at?: string;           // 完成时间
  elapsed_time?: number;           // 耗时（毫秒）
  status: 'pending' | 'processing' | 'completed' | 'failed';
  priority?: 'low' | 'normal' | 'high';  // 优先级
  is_background: boolean;          // 是否后台任务
  progress: number;                // 进度（0-100）
  
  // 上传文件
  upload_files: {
    name: string;
    saved_name?: string;
    size: number;
    type: 'file' | 'template';
  }[];
  
  // 提取结果
  records?: any[];
  records_count?: number;
  result_files?: {
    excel: string;
    json: string;
  };
  validation_summary?: {
    ok: number;      // 正常
    warning: number; // 存疑
    error: number;   // 错误
  };
  
  message?: string;                 // 状态消息
  error?: string;                   // 错误信息
}
```

## 🔐 多用户隔离

系统支持多用户同时使用，每个用户的数据完全隔离：

### 用户标识
- **自动生成**：首次访问时自动生成唯一用户ID
- **存储位置**：localStorage（`coze_user_id`）
- **有效期**：永久（除非清除浏览器缓存）

### 数据隔离策略
- **任务数据**：`tasks/{user_id}/{task_id}/`
- **队列任务**：队列任务中包含 `user_id` 字段
- **缓存数据**：`cache/{user_id}/`
- **Token 配置**：每个用户的 Token 独立存储

### 安全性
- 不同用户无法访问彼此的数据
- 用户只能删除自己的任务
- Token 仅保存在用户浏览器中

## 🚢 部署指南

### 只读文件系统支持

系统已针对只读文件系统环境（如容器部署）进行了优化：

#### 自动检测机制
- **检测方式**：尝试在项目根目录写入测试文件
- **失败处理**：自动切换到 `/tmp/app-temp` 作为临时目录
- **无需配置**：系统会自动选择合适的目录

#### 检测逻辑
```javascript
function getTempBaseDir(): string {
  const root = getProjectRoot();
  const testDir = path.join(root, 'temp');
  
  try {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    fs.accessSync(testDir, fs.constants.W_OK);
    return testDir;  // 可写，使用项目目录
  } catch (err) {
    return '/tmp/app-temp';  // 只读，使用系统临时目录
  }
}
```

### 环境变量

| 变量名 | 说明 | 默认值 | 用途 |
|--------|------|--------|------|
| `COZE_WORKSPACE_PATH` | 项目根目录 | `process.cwd()` | 用于读取资源文件 |
| `APP_TEMP_DIR` | 临时目录 | 自动检测 | 用于存储运行时数据 |
| `FILE_THRESHOLD` | 后台任务阈值 | `5` | 超过此文件数使用后台任务 |
| `NODE_ENV` | 运行环境 | `development` | 影响日志级别和行为 |

### Docker 部署示例

```dockerfile
FROM node:24-alpine

# 安装 Python
RUN apk add --no-cache python3 py3-pip

# 设置工作目录
WORKDIR /app

# 复制项目文件
COPY . .

# 安装依赖
RUN pnpm install
RUN pip3 install -r requirements.txt

# 暴露端口
EXPOSE 5000

# 启动命令
CMD ["pnpm", "start"]
```

### 生产环境启动

```bash
# 构建项目
pnpm build

# 启动生产服务
pnpm start

# 启动后台处理器
pnpm start:processor
```

### 日志管理

- **前端日志**：浏览器控制台
- **API 日志**：`/app/work/logs/bypass/app.log`
- **后台处理器日志**：`/app/work/logs/bypass/processor.log`
- **开发日志**：`/app/work/logs/bypass/dev.log`

## 🎨 高级特性

### 1. 智能并发控制

- **最大并发数**：5
- **实现方式**：使用 Promise 池 + 计数器
- **优势**：避免资源耗尽，提升稳定性

### 2. 任务恢复机制

后台处理器启动时会自动检测并恢复卡住的任务：

```javascript
function recoverStuckTasks() {
  // 扫描所有优先级目录
  // 找到状态为 processing 但未在处理集合中的任务
  // 将其状态恢复为 pending
  // 重新加入处理队列
}
```

### 3. 超时保护

为长时间运行的操作添加超时保护：

- **OCR 识别**：120秒超时
- **LLM 提取**：180秒超时
- **Excel 生成**：300秒超时

超时后会自动清理临时文件并记录错误。

### 4. 流式输出优化

- **LLM 响应**：使用流式输出，打字机式渲染
- **SSE 推送**：实时推送处理进度
- **优势**：提升用户体验，减少等待焦虑

### 5. 分块上传

- **块大小**：2MB
- **优势**：绕过 Next.js 4MB body size 限制
- **支持**：大文件上传

## 🧪 测试与调试

### 本地调试

```bash
# 启动开发服务器
pnpm dev

# 查看后台处理器日志
tail -f /app/work/logs/bypass/processor.log

# 查看API日志
tail -f /app/work/logs/bypass/app.log
```

### 常见问题

**Q: 文件上传后一直卡住？**  
A: 检查 OCR API Token 是否正确，网络连接是否正常。

**Q: 提取结果不准确？**  
A: 尝试使用自定义模板，明确指定字段名称。

**Q: 后台任务一直显示"处理中"？**  
A: 检查后台处理器是否正常运行，查看 `/app/work/logs/bypass/processor.log`。

**Q: 如何清除所有缓存？**  
A: 删除 `temp/cache/` 目录下的所有文件。

## 📄 许可证

MIT License

## 👥 贡献

欢迎提交 Issue 和 Pull Request！
