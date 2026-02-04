# AGENTS.md

Guidelines for AI agents working in this Recruitment Information Extraction System repository.

## Build/Lint/Type Commands

```bash
# Package management (PNPM v9.0.0+ required)
pnpm install

# Development server (port 5000)
pnpm dev

# Production build
pnpm build

# Production server
pnpm start

# ESLint - check all files
pnpm lint

# TypeScript type checking
pnpm ts-check

# Python dependencies
pip3 install -r requirements.txt
```

**Note:** No test framework is currently configured. Manual testing via UI is required.

## Code Style Guidelines

### TypeScript

- **Target**: ES2017 with strict mode enabled
- **Module**: ESNext with bundler resolution
- **JSX**: Use `react-jsx` transform (no React import needed)
- **Path alias**: Use `@/*` for imports from `src/`

### Imports (Ordered)

```typescript
// 1. External libraries (React, Next.js)
import { NextRequest } from 'next/server';
import { useState } from 'react';

// 2. Third-party packages
import { clsx, type ClassValue } from 'clsx';

// 3. Internal libraries (@/lib, @/components)
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// 4. Relative imports (avoid if possible, use @/* instead)
import { helper } from '../lib/helper';
```

### Naming Conventions

- **Components**: PascalCase (`RecruitmentInfoExtractor`, `AlertDialog`)
- **Functions/Variables**: camelCase (`getCurrentUserId`, `filePath`)
- **Constants**: UPPER_SNAKE_CASE for true constants (`USER_ID_KEY`)
- **Interfaces/Types**: PascalCase with descriptive names (`ProgressLog`, `TaskMetadata`)
- **Files**: kebab-case for utilities (`user-manager.ts`), PascalCase for components (`AlertDialog.tsx`)

### React Components

- Use functional components with hooks
- Prefer `'use client'` directive when needed (Next.js App Router)
- Use shadcn/ui components from `@/components/ui/*`
- Props interface naming: `{ComponentName}Props` (optional, can use inline types)

### Error Handling

```typescript
// Return structured error responses in API routes
return Response.json({
  error: 'DESCRIPTIVE_ERROR_CODE',
  message: 'Human-readable message'
}, { status: 400 });

// Use try/catch for async operations with logging
} catch (error) {
  console.error('Context:', error);
  throw error; // or return error response
}
```

### Comments

- Use Chinese comments for business logic (existing convention)
- Use JSDoc for exported functions
- Document complex algorithms and workarounds

### File Organization

```
src/
├── app/              # Next.js App Router pages
│   ├── api/          # API routes
│   ├── page.tsx      # Main page
│   └── layout.tsx    # Root layout
├── components/
│   └── ui/           # shadcn/ui components
├── lib/              # Utility functions
│   ├── utils.ts      # cn() helper
│   ├── user-manager.ts
│   └── task-manager.ts
```

### Tailwind/Styling

- Use `cn()` utility for conditional class merging
- Follow Tailwind CSS v4 conventions
- Use shadcn/ui component patterns for consistency

### Python Scripts (in `scripts/`)

- Use type hints where practical
- Follow PEP 8 naming: `snake_case` for functions/variables
- Handle file paths with proper error handling
- Use `openpyxl` for Excel operations

## Constraints

- **Package Manager**: Only PNPM is allowed (enforced in preinstall)
- **Node.js**: Compatible with Next.js 16 requirements
- **No tests**: Manual testing required; no test runner configured
- **OCR tokens**: Never commit API tokens; user stores in browser localStorage
- **Multi-user**: Always use `getCurrentUserId()` for data isolation

## Dependencies to Know

- **UI**: shadcn/ui, Radix UI primitives, Tailwind CSS 4
- **Forms**: react-hook-form with zod resolvers
- **State**: React hooks (no external state library)
- **LLM**: coze-coding-dev-sdk for Doubao/Ark integration
- **Excel**: openpyxl (Python)
- **OCR**: PaddleOCR-VL API via HTTP requests
