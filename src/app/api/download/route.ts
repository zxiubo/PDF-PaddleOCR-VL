import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import {
  getTaskResultsDirectory,
  getTaskUploadsDirectory,
  readTaskMetadata
} from '@/lib/task-manager';

const OUTPUT_DIR = path.join(process.cwd(), 'public', 'outputs');

/**
 * GET请求处理 - 下载文件
 * 支持多种模式：
 * 1. 旧模式：从 public/outputs 下载结果文件
 * 2. 新模式：从任务目录下载结果文件
 * 3. 上传文件模式：从任务目录下载上传的原始文件
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fileType = searchParams.get('file_type');
    const filename = searchParams.get('filename');
    const taskId = searchParams.get('task_id');
    let userId = searchParams.get('user_id');
    const upload = searchParams.get('upload') === 'true'; // 是否为上传的原始文件

    if (!fileType || !filename || !taskId) {
      return NextResponse.json(
        { success: false, message: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 如果没有提供 user_id，尝试从任务元数据中获取
    if (!userId) {
      try {
        const taskMetadata = await readTaskMetadata(taskId);
        if (taskMetadata) {
          userId = taskMetadata.user_id;
        }
      } catch (error) {
        console.error('读取任务元数据失败:', error);
      }
    }

    // 仍然没有 user_id，返回错误
    if (!userId) {
      return NextResponse.json(
        { success: false, message: '无法获取用户ID' },
        { status: 400 }
      );
    }

    let filePath: string;
    let mimeType: string;
    let downloadName: string = filename;

    if (upload) {
      // 下载上传的原始文件
      const uploadsDir = getTaskUploadsDirectory(taskId, userId);
      filePath = path.join(uploadsDir, filename);

      if (!fs.existsSync(filePath)) {
        return NextResponse.json(
          { success: false, message: '文件不存在' },
          { status: 404 }
        );
      }

      // 根据文件类型设置MIME类型
      if (fileType === 'pdf') {
        mimeType = 'application/pdf';
      } else if (fileType === 'template') {
        mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      } else {
        return NextResponse.json(
          { success: false, message: '不支持的文件类型' },
          { status: 400 }
        );
      }

    } else {
      // 下载结果文件
      if (fileType !== 'excel' && fileType !== 'json') {
        return NextResponse.json(
          { success: false, message: '无效的文件类型' },
          { status: 400 }
        );
      }

      const resultsDir = getTaskResultsDirectory(taskId, userId);
      filePath = path.join(resultsDir, filename);

      // 验证文件是否存在
      if (!fs.existsSync(filePath)) {
        return NextResponse.json(
          { success: false, message: '文件不存在' },
          { status: 404 }
        );
      }

      // 验证文件类型
      const fileExtension = path.extname(filename).toLowerCase();
      if ((fileType === 'excel' && fileExtension !== '.xlsx') ||
          (fileType === 'json' && fileExtension !== '.json')) {
        return NextResponse.json(
          { success: false, message: '文件类型不匹配' },
          { status: 400 }
        );
      }

      mimeType = fileType === 'excel' 
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/json';
    }

    // 读取文件
    const fileBuffer = fs.readFileSync(filePath);

    // 返回文件
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(downloadName)}"`,
        'Content-Length': fileBuffer.length.toString(),
      },
    });

  } catch (error) {
    console.error('下载文件错误:', error);
    const message = error instanceof Error ? error.message : '下载过程中发生错误';
    return NextResponse.json(
      { success: false, message },
      { status: 500 }
    );
  }
}
