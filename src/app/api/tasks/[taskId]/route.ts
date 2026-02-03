import { NextRequest, NextResponse } from 'next/server';
import { readTaskMetadata, deleteTask, getTaskResultsDirectory } from '@/lib/task-manager';
import path from 'path';
import fs from 'fs';

/**
 * GET - 获取任务详情
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');
    
    if (!userId) {
      return NextResponse.json(
        { success: false, message: '缺少用户ID' },
        { status: 400 }
      );
    }
    
    const metadata = readTaskMetadata(taskId, userId);

    if (!metadata) {
      return NextResponse.json(
        { success: false, message: '任务不存在' },
        { status: 404 }
      );
    }

    // 检查结果文件是否存在
    const resultsDir = getTaskResultsDirectory(taskId, userId);
    const resultFilesExist = metadata.result_files ? {
      excel: fs.existsSync(path.join(resultsDir, metadata.result_files.excel)),
      json: fs.existsSync(path.join(resultsDir, metadata.result_files.json))
    } : undefined;

    return NextResponse.json({
      success: true,
      task: metadata,
      resultFilesExist,
    });
  } catch (error) {
    console.error('获取任务详情失败:', error);
    const message = error instanceof Error ? error.message : '获取任务详情失败';
    return NextResponse.json(
      { success: false, message },
      { status: 500 }
    );
  }
}

/**
 * DELETE - 删除任务
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');
    
    if (!userId) {
      return NextResponse.json(
        { success: false, message: '缺少用户ID' },
        { status: 400 }
      );
    }

    // 检查任务是否存在
    const metadata = readTaskMetadata(taskId, userId);
    if (!metadata) {
      return NextResponse.json(
        { success: false, message: '任务不存在' },
        { status: 404 }
      );
    }

    // 删除任务
    const success = deleteTask(taskId, userId);

    if (!success) {
      throw new Error('删除任务失败');
    }

    return NextResponse.json({
      success: true,
      message: '任务删除成功',
    });
  } catch (error) {
    console.error('删除任务失败:', error);
    const message = error instanceof Error ? error.message : '删除任务失败';
    return NextResponse.json(
      { success: false, message },
      { status: 500 }
    );
  }
}
