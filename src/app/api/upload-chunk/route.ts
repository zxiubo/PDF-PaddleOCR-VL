import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user-manager';
import {
  getFileMetadata,
  initFileUpload,
  saveChunk,
  generateFileId,
} from '@/lib/chunk-upload-manager';

/**
 * 文件块上传API
 * POST /api/upload-chunk
 *
 * 请求参数（FormData）:
 * - file_id: 文件唯一标识（可选，首次上传时自动生成）
 * - chunk_index: 块序号（从0开始）
 * - total_chunks: 总块数
 * - chunk: 文件块数据（Buffer）
 * - original_name: 原始文件名
 * - user_id: 用户ID（可选，从localStorage读取）
 *
 * 返回:
 * - success: 是否成功
 * - file_id: 文件ID
 * - chunk_index: 已上传的块序号
 * - uploaded_chunks: 已上传的块列表
 * - total_chunks: 总块数
 * - message: 消息
 */
export async function POST(request: NextRequest) {
  try {
    // 解析FormData
    const formData = await request.formData();
    const file_id = formData.get('file_id') as string;
    const chunk_index = parseInt(formData.get('chunk_index') as string);
    const total_chunks = parseInt(formData.get('total_chunks') as string);
    const chunk = formData.get('chunk') as File;
    const original_name = formData.get('original_name') as string;
    const user_id = formData.get('user_id') as string;

    // 参数验证
    if (isNaN(chunk_index) || chunk_index < 0) {
      return NextResponse.json(
        { success: false, message: '无效的块序号' },
        { status: 400 }
      );
    }

    if (isNaN(total_chunks) || total_chunks <= 0) {
      return NextResponse.json(
        { success: false, message: '无效的总块数' },
        { status: 400 }
      );
    }

    if (!chunk) {
      return NextResponse.json(
        { success: false, message: '缺少文件块数据' },
        { status: 400 }
      );
    }

    if (!original_name) {
      return NextResponse.json(
        { success: false, message: '缺少原始文件名' },
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

    // 生成或使用现有的文件ID
    const fileId = file_id || generateFileId();

    // 如果是第一个块或者文件ID是新生成的，初始化文件上传
    const isNewFile = chunk_index === 0;
    const isNewFileId = !file_id; // 前端没有传入file_id，说明是新生成的
    
    if (isNewFile || isNewFileId) {
      // 检查文件是否已经存在（避免重复初始化）
      const existingMetadata = getFileMetadata(userId, fileId);
      if (!existingMetadata) {
        initFileUpload(userId, fileId, original_name, total_chunks);
      }
    }

    // 验证文件是否存在
    const metadata = getFileMetadata(userId, fileId);
    if (!metadata) {
      return NextResponse.json(
        { success: false, message: '文件不存在或已过期' },
        { status: 404 }
      );
    }

    // 验证块序号和总块数是否匹配
    if (metadata.total_chunks !== total_chunks) {
      return NextResponse.json(
        { success: false, message: `总块数不匹配: 期望 ${metadata.total_chunks}, 实际 ${total_chunks}` },
        { status: 400 }
      );
    }

    // 读取文件块数据
    const chunkData = Buffer.from(await chunk.arrayBuffer());

    // 保存文件块
    const result = saveChunk(userId, fileId, chunk_index, chunkData);

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: 500 }
      );
    }

    // 返回成功结果
    const updatedMetadata = getFileMetadata(userId, fileId);
    return NextResponse.json({
      success: true,
      file_id: fileId,
      chunk_index: chunk_index,
      uploaded_chunks: updatedMetadata?.uploaded_chunks || [],
      total_chunks: total_chunks,
      message: result.message,
    });
  } catch (error) {
    console.error('上传文件块失败:', error);
    return NextResponse.json(
      { success: false, message: `服务器错误: ${error}` },
      { status: 500 }
    );
  }
}
