import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user-manager';
import {
  getFileMetadata,
  mergeChunks,
  getFileSize,
} from '@/lib/chunk-upload-manager';

/**
 * 文件上传完成API（合并文件块）
 * POST /api/upload-complete
 *
 * 请求参数（JSON）:
 * - file_id: 文件唯一标识
 * - user_id: 用户ID（可选）
 *
 * 返回:
 * - success: 是否成功
 * - file_id: 文件ID
 * - file_size: 文件大小（字节）
 * - message: 消息
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { file_id, user_id } = body;

    // 参数验证
    if (!file_id) {
      return NextResponse.json(
        { success: false, message: '缺少文件ID' },
        { status: 400 }
      );
    }

    // 获取用户ID
    const userId = user_id || getCurrentUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, message: '用户未登录' },
        { status: 401 }
      );
    }

    // 检查文件是否存在
    const metadata = getFileMetadata(userId, file_id);
    if (!metadata) {
      return NextResponse.json(
        { success: false, message: '文件不存在或已过期' },
        { status: 404 }
      );
    }

    // 合并文件块
    const result = mergeChunks(userId, file_id);

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 400 }
      );
    }

    // 获取文件大小
    const fileSize = getFileSize(userId, file_id);

    return NextResponse.json({
      success: true,
      file_id: file_id,
      file_size: fileSize,
      original_name: metadata.original_name,
      message: result.message,
    });
  } catch (error) {
    console.error('合并文件块失败:', error);
    return NextResponse.json(
      { success: false, message: `服务器错误: ${error}` },
      { status: 500 }
    );
  }
}
