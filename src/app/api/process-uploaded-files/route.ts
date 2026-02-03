import { NextRequest } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { LLMClient, Config } from 'coze-coding-dev-sdk';
import { getCurrentUserId } from '@/lib/user-manager';
import {
  getFileMetadata,
  moveFileToTask,
} from '@/lib/chunk-upload-manager';
import {
  generateTaskId,
  createTaskDirectory,
  saveTaskMetadata,
  readTaskMetadata,
  calculateBufferHash,
  calculateTemplateHash,
  isFileParsed,
  saveParsedRecord,
  getTempBaseDir,
  ensureDirectory,
  type TaskMetadata,
} from '@/lib/task-manager';

const execAsync = promisify(exec);

/**
 * 获取项目根目录
 */
function getProjectRoot(): string {
  if (process.env.COZE_WORKSPACE_PATH) {
    return process.env.COZE_WORKSPACE_PATH;
  }
  return process.cwd();
}

/**
 * 进度日志接口
 */
interface ProgressLog {
  step: string;
  message: string;
  fileName?: string;
  elapsedTime?: number;
  task_id?: string;
  timestamp: number;
}

/**
 * 处理单个文件（从已上传的文件路径）
 */
async function processUploadedFile(
  filePath: string,
  fileName: string,
  userId: string,
  taskId: string,
  ocrToken: string,
  ocrApiUrl: string,
  templateHeaders: string[],
  templateHash: string,
  recordIndex: number,
  onProgress: (log: ProgressLog) => void
): Promise<{ record: any }> {
  const startTime = Date.now();

  // 步骤1: 检查缓存
  onProgress({
    step: 'cache',
    message: `检查文件缓存: ${fileName}`,
    fileName,
    timestamp: Date.now(),
  });

  const buffer = fs.readFileSync(filePath);
  const fileHash = calculateBufferHash(buffer);

  let extractedRecord;

  const parsedRecord = isFileParsed(userId, fileHash, templateHash);
  if (parsedRecord) {
    onProgress({
      step: 'cache',
      message: `使用缓存数据: ${fileName}`,
      fileName,
      elapsedTime: Date.now() - startTime,
      timestamp: Date.now(),
    });
    extractedRecord = parsedRecord;
  } else {
    // 步骤2: OCR识别
    const ocrStartTime = Date.now();
    onProgress({
      step: 'ocr',
      message: `正在进行OCR识别: ${fileName}`,
      fileName,
      timestamp: Date.now(),
    });

    const ocrResult = await performOCR(filePath, ocrToken, ocrApiUrl);
    
    if (!ocrResult.success) {
      throw new Error(`文件 ${fileName} OCR识别失败: ${ocrResult.message}`);
    }

    onProgress({
      step: 'ocr',
      message: `OCR识别完成: ${fileName}`,
      fileName,
      elapsedTime: Date.now() - ocrStartTime,
      timestamp: Date.now(),
    });

    // 步骤3: 信息提取
    const extractStartTime = Date.now();
    onProgress({
      step: 'extract',
      message: `正在提取招聘信息: ${fileName}`,
      fileName,
      timestamp: Date.now(),
    });

    extractedRecord = await extractRecruitmentInfo(
      ocrResult.full_text,
      templateHeaders,
      recordIndex
    );

    onProgress({
      step: 'extract',
      message: `信息提取完成: ${fileName}`,
      fileName,
      elapsedTime: Date.now() - extractStartTime,
      timestamp: Date.now(),
    });

    // 保存缓存
    saveParsedRecord(userId, fileHash, templateHash, extractedRecord);
  }

  return { record: extractedRecord };
}

/**
 * 调用Python脚本执行OCR识别
 */
async function performOCR(pdfPath: string, token: string, apiUrl?: string): Promise<any> {
  const scriptPath = path.join(getProjectRoot(), 'scripts', 'pdf_ocr.py');
  
  let command = `python3 ${scriptPath} "${pdfPath}" "${token}"`;
  if (apiUrl) {
    command += ` "${apiUrl}"`;
  }
  
  const { stdout, stderr } = await execAsync(command, {
    cwd: getProjectRoot(),
  });

  if (stderr && !stdout) {
    throw new Error(`OCR识别失败: ${stderr}`);
  }

  return JSON.parse(stdout);
}

/**
 * 读取Excel模板表头
 */
async function readTemplateHeaders(templatePath: string): Promise<any> {
  const scriptPath = path.join(getProjectRoot(), 'scripts', 'get_template_headers.py');
  const { stdout, stderr } = await execAsync(`python3 ${scriptPath} "${templatePath}"`, {
    cwd: getProjectRoot(),
  });

  if (stderr && !stdout) {
    throw new Error(`读取模板失败: ${stderr}`);
  }

  return JSON.parse(stdout);
}

/**
 * 获取默认模板表头
 */
async function getDefaultTemplateHeaders(): Promise<any> {
  const defaultTemplatePath = path.join(getProjectRoot(), 'assets', '个人信息提取结果-模板.xlsx');
  if (!fs.existsSync(defaultTemplatePath)) {
    return {
      headers: [
        '姓名', '性别', '出生日期', '民族', '政治面貌', '学历',
        '毕业院校', '专业', '毕业时间', '联系电话', '电子邮箱', '居住地',
        '工作经历', '技能特长', '自我评价'
      ]
    };
  }

  return await readTemplateHeaders(defaultTemplatePath);
}

/**
 * 使用LLM提取招聘信息
 */
async function extractRecruitmentInfo(
  fullText: string,
  templateHeaders: string[],
  recordIndex: number
): Promise<any> {
  const config = new Config();
  const client = new LLMClient(config);

  const headersStr = templateHeaders.join(', ');
  const systemPrompt = `你是一个专业的招聘报名信息提取专家。你的任务是从OCR识别的文本中提取招聘报名信息，并严格按照指定的Excel表头字段名生成JSON数据。

重要规则：
1. 必须严格按照提供的表头字段名生成JSON数据，字段名必须完全匹配（区分大小写）
2. 如果某个字段在文本中找不到对应信息，使用空字符串 "" 作为值
3. "序号"字段自动设置为 ${recordIndex + 1}
4. 确保提取的信息准确、完整
5. 对于日期格式，统一使用 YYYY-MM-DD 格式
6. 对于手机号，确保是11位数字
7. 对于身份证号，确保是18位（最后一位可以是X）
8. 直接返回JSON对象，不要有任何额外说明文字
9. 不要使用Markdown代码块（如 \`\`\`json），只返回纯JSON字符串

表头字段列表：${headersStr}`;

  const userPrompt = `请从以下OCR识别的文本中提取招聘报名信息：

${fullText}

请严格按照表头字段名生成JSON数据，直接返回JSON字符串（不要使用代码块格式）。`;

  try {
    const response = await client.invoke(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      {
        model: 'doubao-seed-1-8-251228',
        temperature: 0.2,
      }
    );

    let content = response.content.trim();
    content = content.replace(/^```json\s*\n?/i, '');
    content = content.replace(/\n?```\s*$/i, '');
    content = content.trim();

    const extractedData = JSON.parse(content);
    extractedData['序号'] = recordIndex + 1;

    // 移除调试字段（full_text, _raw_data）
    const resultData: any = {};
    for (const key in extractedData) {
      if (key !== 'full_text' && key !== '_raw_data') {
        resultData[key] = extractedData[key];
      }
    }

    return resultData;
  } catch (error) {
    console.error('LLM提取失败:', error);
    throw new Error(`信息提取失败: ${error}`);
  }
}

/**
 * 生成Excel文件
 */
async function generateExcelFile(
  records: any[],
  templateHeaders: string[],
  resultsDir: string
): Promise<{ excelFile: string; validationSummary: any }> {
  const scriptPath = path.join(getProjectRoot(), 'scripts', 'excel_filler.py');
  const outputPath = path.join(resultsDir, 'result.xlsx');
  const jsonPath = path.join(resultsDir, 'result.json');

  const inputPath = path.join(resultsDir, 'temp_records.json');
  fs.writeFileSync(inputPath, JSON.stringify(records, null, 2));

  const { stdout, stderr } = await execAsync(
    `python3 ${scriptPath} "${inputPath}" "${outputPath}" --json-output "${jsonPath}"`,
    { cwd: getProjectRoot() }
  );

  if (stderr && !stdout) {
    throw new Error(`生成Excel失败: ${stderr}`);
  }

  fs.unlinkSync(inputPath);

  // 解析返回结果
  const result = JSON.parse(stdout);
  if (!result.success) {
    throw new Error(`生成Excel失败: ${result.message}`);
  }

  return {
    excelFile: 'result.xlsx',
    validationSummary: result.validation_summary || { ok: records.length, warning: 0, error: 0 }
  };
}

/**
 * POST /api/process-uploaded-files
 * 处理已上传的文件（同步处理，文件数量<=5）
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      file_ids,
      template_file_id,
      use_default_template = true,
      task_name = '招聘信息提取任务',
      task_id: externalTaskId,
      priority = 'normal',
      user_id: externalUserId,
      ocr_token,
      ocr_api_url,
    } = body;

    // 参数验证
    if (!file_ids || !Array.isArray(file_ids) || file_ids.length === 0) {
      return new Response(
        `data: ${JSON.stringify({ success: false, message: '请至少选择一个文件', step: 'error' })}\n\n`,
        {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        }
      );
    }

    if (!ocr_token || !ocr_api_url) {
      return new Response(
        `data: ${JSON.stringify({ success: false, message: '缺少OCR API配置', step: 'error' })}\n\n`,
        {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        }
      );
    }

    const userId = externalUserId || getCurrentUserId();
    if (!userId) {
      return new Response(
        `data: ${JSON.stringify({ success: false, message: '用户未登录', step: 'error' })}\n\n`,
        {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        }
      );
    }

    // 创建或使用已有任务
    const taskId = externalTaskId || generateTaskId();
    const isNewTask = !externalTaskId;

    let existingTask: TaskMetadata | null = null;

    if (isNewTask) {
      createTaskDirectory(taskId, userId);
    } else {
      // 继续上传，读取已有任务
      existingTask = await readTaskMetadata(taskId);
      if (!existingTask) {
        return new Response(
          `data: ${JSON.stringify({ success: false, message: '任务不存在', step: 'error' })}\n\n`,
          {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            },
          }
        );
      }

      if (existingTask.user_id !== userId) {
        return new Response(
          `data: ${JSON.stringify({ success: false, message: '无权访问该任务', step: 'error' })}\n\n`,
          {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            },
          }
        );
      }

      if (existingTask.status === 'processing') {
        return new Response(
          `data: ${JSON.stringify({ success: false, message: '任务正在处理中，请等待完成', step: 'error' })}\n\n`,
          {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            },
          }
        );
      }
    }

    const taskDir = path.join(getTempBaseDir(), 'tasks', userId, taskId);
    const uploadsDir = path.join(taskDir, 'uploads');
    const resultsDir = path.join(taskDir, 'results');

    // 确保目录存在
    ensureDirectory(uploadsDir);
    ensureDirectory(resultsDir);

    // 移动文件到任务目录
    const savedFiles: Array<{ path: string; name: string }> = [];
    const uploadFiles: any[] = [];

    for (const fileId of file_ids) {
      const fileMetadata = getFileMetadata(userId, fileId);
      if (!fileMetadata) {
        return new Response(
          `data: ${JSON.stringify({ success: false, message: `文件 ${fileId} 不存在或已过期`, step: 'error' })}\n\n`,
          {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            },
          }
        );
      }

      const moveResult = moveFileToTask(userId, fileId, taskId);
      if (!moveResult.success || !moveResult.filePath) {
        return new Response(
          `data: ${JSON.stringify({ success: false, message: `移动文件 ${fileId} 失败`, step: 'error' })}\n\n`,
          {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            },
          }
        );
      }

      savedFiles.push({ path: moveResult.filePath, name: fileMetadata.original_name });
      uploadFiles.push({
        name: fileMetadata.original_name,
        size: fs.statSync(moveResult.filePath).size,
        type: 'file',
      });
    }

    // 处理模板文件
    let templatePath: string | undefined;
    let templateHeaders: string[] = [];

    if (template_file_id) {
      const templateMetadata = getFileMetadata(userId, template_file_id);
      if (templateMetadata) {
        const moveResult = moveFileToTask(userId, template_file_id, taskId, `template_${templateMetadata.original_name}`);
        if (moveResult.success && moveResult.filePath) {
          templatePath = moveResult.filePath;
          uploadFiles.push({
            name: templateMetadata.original_name,
            size: fs.statSync(moveResult.filePath).size,
            type: 'template',
          });

          // 读取模板表头
          const templateData = await readTemplateHeaders(templatePath);
          templateHeaders = templateData.headers || [];
        }
      }
    }

    // 使用默认模板
    if (!templatePath && use_default_template) {
      const defaultTemplate = await getDefaultTemplateHeaders();
      templateHeaders = defaultTemplate.headers || [];
    } else if (!templatePath && !isNewTask && existingTask) {
      // 继续上传，使用任务已有模板
      const existingTemplate = existingTask.upload_files?.find(f => f.type === 'template');
      if (existingTemplate && existingTemplate.saved_name) {
        templatePath = path.join(getTempBaseDir(), 'tasks', userId, taskId, 'uploads', existingTemplate.saved_name);
        if (fs.existsSync(templatePath)) {
          const templateData = await readTemplateHeaders(templatePath);
          templateHeaders = templateData.headers || [];
        }
      }
    }

    // 创建或更新任务元数据
    const taskMetadata: TaskMetadata = isNewTask ? {
      id: taskId,
      user_id: userId,
      name: task_name,
      created_at: new Date().toISOString(),
      status: 'processing',
      upload_files: uploadFiles,
      records: [],
      records_count: 0,
      is_background: false,
      priority: priority,
      message: `正在处理（${file_ids.length}个文件）`,
    } : {
      id: taskId,
      user_id: userId,
      name: task_name,
      created_at: existingTask!.created_at,
      status: 'processing',
      upload_files: [...(existingTask!.upload_files || []), ...uploadFiles],
      records: existingTask!.records || [],
      records_count: existingTask!.records_count || 0,
      is_background: false,
      priority: priority,
      message: `继续处理（${file_ids.length}个新文件）`,
      result_files: existingTask!.result_files,
      validation_summary: existingTask!.validation_summary,
    };

    saveTaskMetadata(taskId, userId, taskMetadata);

    // 返回SSE流
    const encoder = new TextEncoder();
    const templateHash = calculateTemplateHash(templatePath);

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 发送初始化消息
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ task_id: taskId, step: 'init', message: '任务初始化完成' })}\n\n`
            )
          );

          const records: any[] = [];

          // 如果是继续上传，读取任务的已有记录
          let startIndex = 0;
          if (!isNewTask && existingTask && existingTask.records && existingTask.records.length > 0) {
            records.push(...existingTask.records);
            startIndex = existingTask.records.length;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ task_id: taskId, step: 'init', message: `已加载已有记录 ${existingTask.records.length} 条` })}\n\n`
              )
            );
          }

          // 处理每个文件
          for (let i = 0; i < savedFiles.length; i++) {
            const file = savedFiles[i];
            const startTime = Date.now();

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ task_id: taskId, step: 'process', message: `正在处理文件: ${file.name}`, fileName: file.name })}\n\n`
              )
            );

            const result = await processUploadedFile(
              file.path,
              file.name,
              userId,
              taskId,
              ocr_token,
              ocr_api_url,
              templateHeaders,
              templateHash,
              startIndex + i,
              (log) => {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ task_id: taskId, ...log })}\n\n`
                  )
                );
              }
            );

            records.push(result.record);

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ task_id: taskId, step: 'processed', message: `处理完成: ${file.name}`, fileName: file.name, elapsedTime: Date.now() - startTime })}\n\n`
              )
            );
          }

          // 生成Excel
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ task_id: taskId, step: 'excel', message: '正在生成Excel文件' })}\n\n`
            )
          );

          const { excelFile, validationSummary } = await generateExcelFile(records, templateHeaders, resultsDir);
          const jsonFile = 'result.json';  // Excel脚本会同时生成JSON文件

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ task_id: taskId, step: 'excel', message: 'Excel文件生成完成' })}\n\n`
            )
          );

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ task_id: taskId, step: 'json', message: 'JSON文件生成完成' })}\n\n`
            )
          );

          // 更新任务元数据
          taskMetadata.records = records;
          taskMetadata.records_count = records.length;
          taskMetadata.result_files = {
            excel: excelFile,
            json: jsonFile,
          };
          taskMetadata.validation_summary = validationSummary;
          taskMetadata.status = 'completed';
          taskMetadata.message = '处理完成';
          saveTaskMetadata(taskId, userId, taskMetadata);

          // 完成
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ task_id: taskId, step: 'complete', message: '处理完成', excel_file: excelFile, json_file: jsonFile, records_count: records.length, validation_summary: validationSummary })}\n\n`
            )
          );

        } catch (error) {
          console.error('处理失败:', error);
          taskMetadata.status = 'failed';
          taskMetadata.error = error instanceof Error ? error.message : String(error);
          saveTaskMetadata(taskId, userId, taskMetadata);

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ task_id: taskId, step: 'error', message: `处理失败: ${error}` })}\n\n`
            )
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('处理失败:', error);
    return new Response(
      `data: ${JSON.stringify({ success: false, message: `服务器错误: ${error}`, step: 'error' })}\n\n`,
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      }
    );
  }
}
