import { NextRequest } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { LLMClient, Config } from 'coze-coding-dev-sdk';
import {
  generateTaskId,
  generateSessionId,
  createTaskDirectory,
  saveTaskMetadata,
  readTaskMetadata,
  getTaskUploadsDirectory,
  getTaskResultsDirectory,
  calculateBufferHash,
  calculateTemplateHash,
  isFileParsed,
  saveParsedRecord,
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
 * 处理单个文件的函数
 */
async function processSingleFile(
  file: File,
  uploadsDir: string,
  userId: string,
  taskId: string,
  ocrToken: string,
  ocrApiUrl: string,
  templateHeaders: string[],
  templatePath: string | undefined,
  recordIndex: number,
  taskMetadata: TaskMetadata,
  onProgress: (log: ProgressLog) => void
): Promise<{ record: any; fileName: string }> {
  const startTime = Date.now();
  const fileName = file.name;

  // 步骤1: 保存文件
  onProgress({
    step: 'upload',
    message: `正在上传文件: ${fileName}`,
    fileName,
    timestamp: Date.now(),
  });

  const savedName = `${Date.now()}_${file.name}`;
  const filePath = path.join(uploadsDir, savedName);
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  // 步骤2: 检查缓存
  onProgress({
    step: 'cache',
    message: `检查文件缓存: ${fileName}`,
    fileName,
    timestamp: Date.now(),
  });

  const fileHash = calculateBufferHash(buffer);
  const templateHash = calculateTemplateHash(templatePath);
  const cacheKey = `${fileHash}_${templateHash}`;

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
    // 步骤3: OCR识别
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

    // 步骤4: 信息提取
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

  return { record: extractedRecord, fileName };
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
      success: true,
      headers: [
        "序号", "报名序号", "招聘单位", "岗位名称", "姓名", "身份证号码",
        "手机联系方式", "邮箱", "性别", "出生年月民族", "籍贯", "政治面貌",
        "集体户口", "户籍所在地", "详细居住地", "硕士毕业学校", "是否全日制",
        "学历学位双证齐全", "专业", "毕业时间", "本科毕业学校", "专业", "毕业时间",
        "大专毕业学校", "专业", "毕业时间", "高中毕业学校", "是否退役士兵",
        "立功情况", "社会工作者职称", "备注（其他证书）"
      ],
      header_row: 1
    };
  }

  return await readTemplateHeaders(defaultTemplatePath);
}

/**
 * 使用LLM提取招聘信息
 */
async function extractRecruitmentInfo(
  ocrText: string,
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

${ocrText}

请严格按照表头字段名生成JSON数据，直接返回JSON字符串（不要使用代码块格式）。`;

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

  return extractedData;
}

/**
 * 生成Excel文件
 */
async function generateExcel(
  extractedData: any[],
  templatePath: string | undefined,
  outputDir: string
): Promise<any> {
  const scriptPath = path.join(getProjectRoot(), 'scripts', 'excel_filler.py');
  
  const outputExcelPath = path.join(outputDir, `个人信息提取结果.xlsx`);
  
  let tempDir = process.env.APP_TEMP_DIR;
  if (!tempDir) {
    tempDir = path.join(getProjectRoot(), 'temp');
  }
  
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const tempJsonPath = path.join(tempDir, `extracted_data_${Date.now()}.json`);
  
  fs.writeFileSync(tempJsonPath, JSON.stringify(extractedData, null, 2), 'utf-8');

  try {
    let command: string;
    
    if (templatePath) {
      command = `python3 ${scriptPath} "${tempJsonPath}" --template "${templatePath}" "${outputExcelPath}"`;
    } else {
      command = `python3 ${scriptPath} "${tempJsonPath}" "${outputExcelPath}"`;
    }

    const { stdout, stderr } = await execAsync(command, {
      cwd: getProjectRoot(),
    });

    if (stderr && !stdout) {
      throw new Error(`Excel生成失败: ${stderr}`);
    }

    return JSON.parse(stdout);
  } finally {
    // 清理临时文件
    if (fs.existsSync(tempJsonPath)) {
      fs.unlinkSync(tempJsonPath);
    }
  }
}

/**
 * 并发控制函数
 */
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  maxConcurrency: number
): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const promise = task().then(result => {
      results.push(result);
    });

    executing.push(promise);

    const cleanup = () => {
      const index = executing.indexOf(promise);
      if (index > -1) {
        executing.splice(index, 1);
      }
    };

    promise.then(cleanup, cleanup);

    if (executing.length >= maxConcurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * POST请求处理 - 流式提取招聘信息
 */
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const formData = await request.formData();
        const userId = formData.get('user_id') as string;
        const uploadedFiles = formData.getAll('pdf_files') as File[];
        const ocrToken = formData.get('ocr_token') as string;
        const ocrApiUrl = formData.get('ocr_api_url') as string;
        const taskId = formData.get('task_id') as string || generateTaskId();
        const taskName = formData.get('task_name') as string || '招聘信息提取任务';
        const templateFile = formData.get('template_file') as File | null;
        const useDefaultTemplate = formData.get('use_default_template') === 'true';

        // 验证参数
        if (!ocrToken || !ocrApiUrl) {
          throw new Error('缺少OCR API配置');
        }

        if (!uploadedFiles || uploadedFiles.length === 0) {
          throw new Error('请至少上传一个文件');
        }

        // 创建任务目录
        createTaskDirectory(taskId, userId);
        const uploadsDir = getTaskUploadsDirectory(taskId, userId);
        const resultsDir = getTaskResultsDirectory(taskId, userId);

        // 发送进度日志的辅助函数
        const sendProgress = (log: ProgressLog) => {
          const data = `data: ${JSON.stringify(log)}\n\n`;
          controller.enqueue(encoder.encode(data));
        };

        // 初始化任务元数据
        sendProgress({
          step: 'init',
          message: '正在初始化任务...',
          task_id: taskId,
          timestamp: Date.now(),
        });

        let taskMetadata = await readTaskMetadata(taskId);
        
        if (!taskMetadata) {
          taskMetadata = {
            id: taskId,
            user_id: userId,
            name: taskName,
            created_at: new Date().toISOString(),
            status: 'processing',
            session_id: generateSessionId(),
            upload_files: [],
            records: [],
            validation_summary: undefined,
            message: '',
          };
        } else {
          taskMetadata.status = 'processing';
        }

        // 处理模板文件
        let templatePath: string | undefined;
        let templateHeaders: string[] = [];

        if (templateFile) {
          sendProgress({
            step: 'template',
            message: '正在读取自定义模板...',
            timestamp: Date.now(),
          });

          const templateFileName = `template_${Date.now()}.xlsx`;
          const templateFilePath = path.join(uploadsDir, templateFileName);
          const buffer = Buffer.from(await templateFile.arrayBuffer());
          fs.writeFileSync(templateFilePath, buffer);
          templatePath = templateFilePath;

          const templateResult = await readTemplateHeaders(templatePath);
          if (!templateResult.success) {
            throw new Error('读取模板表头失败');
          }
          templateHeaders = templateResult.headers;

          taskMetadata.upload_files.push({
            name: templateFile.name,
            saved_name: templateFileName,
            size: templateFile.size,
            type: 'template'
          });
        } else if (useDefaultTemplate || taskMetadata.upload_files.find(f => f.type === 'template')) {
          sendProgress({
            step: 'template',
            message: '正在加载默认模板...',
            timestamp: Date.now(),
          });

          const defaultResult = await getDefaultTemplateHeaders();
          templateHeaders = defaultResult.headers;
        }

        // 并发处理所有文件
        const overallStartTime = Date.now();
        
        sendProgress({
          step: 'process',
          message: `开始处理 ${uploadedFiles.length} 个文件...`,
          timestamp: Date.now(),
        });

        const processTasks = uploadedFiles.map((file, index) => async () => {
          return await processSingleFile(
            file,
            uploadsDir,
            userId,
            taskId,
            ocrToken,
            ocrApiUrl,
            templateHeaders,
            templatePath,
            taskMetadata.records?.length || 0 + index,
            taskMetadata,
            sendProgress
          );
        });

        const results = await runWithConcurrency(processTasks, 5);

        // 更新任务元数据
        results.forEach(({ record, fileName }) => {
          // 检查文件是否已经在列表中，避免重复
          const fileExists = taskMetadata.upload_files.some(
            f => f.name === fileName && f.type === 'file'
          );
          
          if (!fileExists) {
            taskMetadata.upload_files.push({
              name: fileName,
              size: uploadedFiles.find(f => f.name === fileName)?.size || 0,
              type: 'file'
            });
          }
        });

        taskMetadata.records = [...(taskMetadata.records || []), ...results.map(r => r.record)];
        taskMetadata.records_count = taskMetadata.records.length;

        sendProgress({
          step: 'excel',
          message: '正在生成Excel文件...',
          timestamp: Date.now(),
        });

        // 生成Excel
        const excelResult = await generateExcel(
          taskMetadata.records,
          templatePath,
          resultsDir
        );

        // 生成JSON文件
        sendProgress({
          step: 'json',
          message: '正在生成JSON文件...',
          timestamp: Date.now(),
        });

        const jsonPath = path.join(resultsDir, `个人信息提取结果.json`);
        fs.writeFileSync(jsonPath, JSON.stringify(taskMetadata.records, null, 2), 'utf-8');

        // 保存任务元数据
        taskMetadata.status = 'completed';
        taskMetadata.result_files = {
          excel: `个人信息提取结果.xlsx`,
          json: `个人信息提取结果.json`,
        };
        taskMetadata.validation_summary = excelResult.validation_summary || {
          ok: taskMetadata.records.length,
          warning: 0,
          error: 0,
        };
        taskMetadata.message = `处理完成，共提取 ${taskMetadata.records.length} 条记录`;

        await saveTaskMetadata(taskId, userId, taskMetadata);

        // 发送完成消息
        sendProgress({
          step: 'complete',
          message: taskMetadata.message,
          task_id: taskId,
          timestamp: Date.now(),
          elapsedTime: Date.now() - overallStartTime,
        });

        controller.close();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '处理过程中发生错误';
        
        const errorLog: ProgressLog = {
          step: 'error',
          message: errorMessage,
          timestamp: Date.now(),
        };

        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorLog)}\n\n`));
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Transfer-Encoding': 'chunked',
    },
  });
}
