# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Recruitment Information Extraction System** that uses **Next.js + PaddleOCR + LLM** to automatically extract recruitment/application information from various document formats (PDF, JPEG, PNG, TIFF, BMP) and generate structured Excel and JSON data.

## Development Commands

### Package Management
- **Primary**: PNPM (v9.0.0+ required, enforced via `preinstall` script)
- **Alternative**: npm
- **Python**: pip3 (for Python dependencies in `requirements.txt`)

### Common Development Tasks
```bash
# Start development server (port 5000) with background processor
pnpm dev

# Build production version
pnpm build

# Start production server
pnpm start

# Run ESLint
pnpm lint

# TypeScript type checking
pnpm ts-check

# Install Python dependencies (automatically done by build/dev scripts)
pip3 install -r requirements.txt
```

### Scripts Location
All build/development scripts are in `scripts/` directory:
- `scripts/build.sh` - Production build
- `scripts/dev.sh` - Development server startup
- `scripts/start.sh` - Production server startup
- `scripts/prepare.sh` - Environment preparation

## Architecture Overview

### Core Components
1. **Frontend**: Next.js 16 (App Router) with React 19, TypeScript 5, shadcn/ui, Tailwind CSS 4
2. **Backend APIs**: Next.js API Routes in `src/app/api/`
3. **Processing Pipeline**:
   - `scripts/pdf_ocr.py` - PaddleOCR-VL API integration for text extraction
   - `scripts/llm-extract.js` - LLM-based information extraction using Doubao (Ark) model
   - `scripts/excel_filler.py` - Excel file generation with color-coded validation
   - `scripts/get_template_headers.py` - Template header extraction
4. **Background Processing**: `scripts/background-processor.js` - Node.js daemon for task queue management

### Key Architectural Patterns

#### Multi-User Isolation
- Each user gets a unique ID stored in localStorage (`coze_user_id`)
- Complete data isolation: `temp/tasks/{user_id}/`, `temp/cache/{user_id}/`
- Token configuration stored per user in browser (never sent to server)

#### Processing Flow Decisions
- **≤5 files**: Real-time processing via SSE (Server-Sent Events)
- **>5 files**: Background task submission with priority queue
- **Priority levels**: High/Normal/Low with separate queue directories

#### File System Structure
```
temp/
├── tasks/{user_id}/{task_id}/          # Task-specific data
│   ├── uploads/                        # Original uploaded files
│   ├── results/                        # Generated Excel/JSON files
│   └── task.json                       # Task metadata
├── queue/{priority}/{status}/          # Task queue (pending/processing/completed)
└── cache/{user_id}/                    # MD5(file+template) based cache
```

#### Read-Only Filesystem Support
- Automatic detection of writable directories
- Falls back to `/tmp/app-temp` if project root is read-only
- Designed for containerized deployments (detects `/opt/bytefaas` path)

### External Service Integrations
1. **OCR Service**: PaddleOCR-VL API (Baidu PaddlePaddle) - requires user-provided API token
2. **LLM Service**: Doubao (Ark) large language model
3. **File Formats**: PDF, JPEG, JPG, PNG, TIFF, TIF, BMP (PNG/TIFF/BMP auto-converted to JPEG)

## Important Implementation Details

### Chunked Upload System
- 2MB chunks to bypass Next.js 4MB body size limit
- Implemented in `src/app/api/upload-chunk/route.ts` and `src/app/api/upload-complete/route.ts`

### Caching Strategy
- Cache key: `MD5(file_content) + "_" + MD5(template_content)`
- Location: `temp/cache/{user_id}/{cache_key}.json`
- Prevents duplicate OCR processing for same file+template combinations

### Concurrency Control
- Maximum 5 concurrent operations across the system
- Implemented via Promise pools in processing scripts

### Timeout Protection
- OCR recognition: 120 seconds
- LLM extraction: 180 seconds
- Excel generation: 300 seconds
- Automatic cleanup on timeout

### Task Recovery
- Background processor scans for stuck tasks on startup
- Automatically recovers tasks marked as `processing` but not actively being processed

## Environment Variables
- `COZE_WORKSPACE_PATH`: Project root directory (default: `process.cwd()`)
- `APP_TEMP_DIR`: Temporary directory for runtime data (auto-detected)
- `FILE_THRESHOLD`: Background task threshold (default: 5)
- `NODE_ENV`: Runtime environment

## Python Dependencies
- `openpyxl>=3.1.2`: Excel file handling
- `requests>=2.31.0`: HTTP requests for OCR API
- `Pillow>=10.0.0`: Image format conversion (PNG/TIFF/BMP → JPEG)

## Development Notes

### API Routes Structure
- Real-time processing: `POST /api/process-uploaded-files` (SSE streaming)
- Background tasks: `POST /api/submit-task`
- Task management: `GET /api/tasks`, `GET /api/tasks/[id]/*`
- File download: `GET /api/download`
- Cache management: `POST /api/clear-cache`

### Frontend Components
- Main page: `src/app/page.tsx` (1,480 lines - comprehensive upload/processing UI)
- Task management: `src/app/tasks/page.tsx`
- Uses shadcn/ui components with custom styling

### Error Handling Patterns
- Color-coded validation results in Excel output (green/yellow/red)
- Comprehensive error logging to `logs/bypass/` directory
- User-friendly error messages with recovery suggestions

### Testing Considerations
- No test framework currently configured
- Manual testing via UI with sample documents recommended
- Log files provide detailed debugging information