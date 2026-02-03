import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
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
  // 优先使用 COZE_WORKSPACE_PATH 环境变量
  if (process.env.COZE_WORKSPACE_PATH) {
    return process.env.COZE_WORKSPACE_PATH;
  }
  // 降级到 process.cwd()
  return process.cwd();
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
    // 返回默认表头
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

    // 清理响应，移除可能的Markdown代码块标记
    let content = response.content.trim();
    content = content.replace(/^```json\s*\n?/i, '');
    content = content.replace(/\n?```\s*$/i, '');
    content = content.trim();

    const extractedData = JSON.parse(content);
    extractedData['序号'] = recordIndex + 1;

    return extractedData;
  } catch (error) {
    console.error('LLM提取信息失败:', error);
    throw new Error('信息提取失败');
  }
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
  
  // 始终使用固定文件名
  const outputExcelPath = path.join(outputDir, `个人信息提取结果.xlsx`);
  
  // 获取临时目录（优先使用环境变量中的临时目录）
  let tempDir = process.env.APP_TEMP_DIR;
  if (!tempDir) {
    tempDir = path.join(getProjectRoot(), 'temp');
  }
  
  if (!fs.existsSync(tempDir)) {
    try {
      fs.mkdirSync(tempDir, { recursive: true });
    } catch (error) {
      console.error('创建临时目录失败:', error);
      throw new Error(`无法创建临时目录: ${tempDir}`);
    }
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
      console.error('Excel生成错误:', stderr);
      throw new Error(`Excel生成失败: ${stderr}`);
    }

    const result = JSON.parse(stdout);
    
    try {
      fs.unlinkSync(tempJsonPath);
    } catch (err) {
      console.warn('清理临时文件失败:', err);
    }

    return result;
  } catch (error) {
    try {
      if (fs.existsSync(tempJsonPath)) {
        fs.unlinkSync(tempJsonPath);
      }
    } catch (err) {
      console.warn('清理临时文件失败:', err);
    }
    throw error;
  }
}

/**
 * 生成JSON文件
 */
function generateJsonFile(extractedData: any[], outputDir: string): string {
  // 始终使用固定文件名
  const outputJsonPath = path.join(outputDir, `个人信息提取结果.json`);
  
  fs.writeFileSync(outputJsonPath, JSON.stringify(extractedData, null, 2), 'utf-8');
  
  return outputJsonPath;
}

/**
 * POST请求处理
 */
export async function POST(request: NextRequest) {
  let taskId: string | null = null;
  let taskMetadata: TaskMetadata | null = null;
  let userId: string = '';

  try {
    const formData = await request.formData();
    
    // 获取用户ID（必填）
    userId = formData.get('user_id') as string;
    if (!userId) {
      return NextResponse.json(
        { success: false, message: '缺少用户ID' },
        { status: 400 }
      );
    }

    // 获取OCR Token和API URL（必填）
    const ocrToken = formData.get('ocr_token') as string;
    if (!ocrToken) {
      return NextResponse.json(
        { success: false, message: '缺少OCR API Token' },
        { status: 400 }
      );
    }
    
    const ocrApiUrl = formData.get('ocr_api_url') as string;
    if (!ocrApiUrl) {
      return NextResponse.json(
        { success: false, message: '缺少OCR API URL' },
        { status: 400 }
      );
    }
    
    // 获取上传的文件
    const uploadedFiles = formData.getAll('pdf_files') as File[];
    
    if (!uploadedFiles || uploadedFiles.length === 0) {
      return NextResponse.json(
        { success: false, message: '请至少上传一个文件' },
        { status: 400 }
      );
    }

    // 获取任务ID（如果是继续上传）
    const existingTaskId = formData.get('task_id') as string | null;
    
    // 获取任务名称
    const taskName = formData.get('task_name') as string || '招聘信息提取任务';

    if (existingTaskId) {
      // 继续上传到现有任务
      taskId = existingTaskId;
      taskMetadata = readTaskMetadata(taskId, userId);
      
      if (!taskMetadata) {
        return NextResponse.json(
          { success: false, message: '任务不存在' },
          { status: 404 }
        );
      }

      // 更新任务状态
      taskMetadata.status = 'processing';
      saveTaskMetadata(taskId, userId, taskMetadata);
    } else {
      // 创建新任务
      taskId = generateTaskId();
      const sessionId = generateSessionId();
      
      // 创建任务目录
      const taskDir = createTaskDirectory(taskId, userId);
      
      // 初始化任务元数据
      taskMetadata = {
        id: taskId,
        user_id: userId,
        name: taskName,
        created_at: new Date().toISOString(),
        status: 'processing',
        session_id: sessionId,
        upload_files: [],
      };
      saveTaskMetadata(taskId, userId, taskMetadata);
    }

    // 获取任务目录
    const uploadsDir = getTaskUploadsDirectory(taskId, userId);
    const resultsDir = getTaskResultsDirectory(taskId, userId);

    // 获取模板配置
    const useDefaultTemplate = formData.get('use_default_template') === 'true';
    const templateFile = formData.get('template_file') as File | null;

    let templatePath: string | undefined;
    let templateHeaders: string[] = [];

    // 检查是否已有模板（继续上传时优先使用）
    const existingTemplate = taskMetadata.upload_files.find(f => f.type === 'template');
    
    // 模板选择逻辑（按优先级）
    if (templateFile) {
      // 优先级1: 用户上传了新模板
      // 先删除旧的模板文件和记录（如果存在）
      const oldTemplateIndex = taskMetadata.upload_files.findIndex(f => f.type === 'template');
      if (oldTemplateIndex !== -1) {
        const oldTemplate = taskMetadata.upload_files[oldTemplateIndex];
        const oldTemplatePath = path.join(uploadsDir, oldTemplate.saved_name!);
        // 删除旧模板的物理文件
        try {
          if (fs.existsSync(oldTemplatePath)) {
            fs.unlinkSync(oldTemplatePath);
            console.log('已删除旧模板文件:', oldTemplate.saved_name);
          }
        } catch (err) {
          console.warn('删除旧模板文件失败:', err);
        }
        // 从记录中移除旧模板
        taskMetadata.upload_files.splice(oldTemplateIndex, 1);
      }
      
      // 保存新模板
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

      // 记录上传的模板文件（替换，而非添加）
      taskMetadata.upload_files.push({
        name: templateFile.name,
        saved_name: templateFileName,
        size: templateFile.size,
        type: 'template'
      });
    } else if (existingTemplate) {
      // 优先级2: 使用任务中已有的模板（继续上传时）
      const existingTemplatePath = path.join(uploadsDir, existingTemplate.saved_name!);
      const templateResult = await readTemplateHeaders(existingTemplatePath);
      if (!templateResult.success) {
        throw new Error('读取现有模板失败');
      }
      templateHeaders = templateResult.headers;
      templatePath = existingTemplatePath;
    } else if (useDefaultTemplate) {
      // 优先级3: 使用默认模板
      templateHeaders = (await getDefaultTemplateHeaders()).headers;
      templatePath = path.join(getProjectRoot(), 'assets', '个人信息提取结果-模板.xlsx');
    } else {
      throw new Error('请选择使用默认模板或上传自定义模板');
    }

    // 处理每个PDF文件
    const extractedData: any[] = [];
    
    // 如果是继续上传，读取现有的records
    const isContinueUpload = existingTaskId !== null;
    let allRecords: any[] = [];
    
    if (isContinueUpload && taskMetadata.records && taskMetadata.records.length > 0) {
      // 使用现有记录作为基础
      allRecords = [...taskMetadata.records];
    }
    
    // 计算PDF文件的起始序号（如果是继续上传，从已有记录数开始）
    const startIndex = allRecords.length;
    
    // 计算模板哈希（用于缓存）
    const templateHash = calculateTemplateHash(templatePath);
    
    // 追踪是否有新的解析（用于判断是否需要重新生成结果文件）
    let hasNewParsing = false;
    
    for (let i = 0; i < uploadedFiles.length; i++) {
      const uploadedFile = uploadedFiles[i];
      const uploadedFileName = `${startIndex + i + 1}_${uploadedFile.name}`;
      const uploadedFilePath = path.join(uploadsDir, uploadedFileName);
      const buffer = Buffer.from(await uploadedFile.arrayBuffer());
      fs.writeFileSync(uploadedFilePath, buffer);

      // 记录上传的文件
      taskMetadata.upload_files.push({
        name: uploadedFile.name,
        size: uploadedFile.size,
        type: 'file'
      });

      // 保存文件信息到元数据，文件名中包含序号用于标识
      taskMetadata.upload_files[taskMetadata.upload_files.length - 1].saved_name = uploadedFileName;

      try {
        // 计算文件哈希
        const fileHash = await calculateBufferHash(buffer);
        
        // 检查是否已经解析过（文件+模板组合）
        const parsedRecord = isFileParsed(userId, fileHash, templateHash);
        
        let extractedRecord;
        
        if (parsedRecord) {
          // 从缓存读取
          console.log(`文件 ${uploadedFile.name} 已解析过，使用缓存数据`);
          extractedRecord = parsedRecord;
        } else {
          // 执行OCR和LLM提取
          const ocrResult = await performOCR(uploadedFilePath, ocrToken, ocrApiUrl);
          
          if (!ocrResult.success) {
            throw new Error(`文件 ${uploadedFile.name} OCR识别失败: ${ocrResult.message}`);
          }

          extractedRecord = await extractRecruitmentInfo(
            ocrResult.full_text,
            templateHeaders,
            startIndex + i
          );
          
          // 保存解析记录到缓存
          saveParsedRecord(userId, fileHash, templateHash, extractedRecord);
          
          // 标记有新的解析
          hasNewParsing = true;
        }

        extractedData.push(extractedRecord);
        allRecords.push(extractedRecord);
      } catch (ocrError) {
        // 单个文件识别失败，继续处理其他文件
        console.error(`文件 ${uploadedFile.name} 处理失败:`, ocrError);
        throw ocrError;
      }
      // 注意：上传的文件不删除，保留在任务目录中供后续查看
    }

    // 生成Excel文件和JSON文件
    // 始终重新生成结果文件，确保结果文件与records一致
    // 缓存的作用是避免重复OCR/LLM调用，结果文件生成很快
    let excelResult: any;
    let jsonOutputPath: string;
    
    // 只要有文件上传，就重新生成结果文件（不管是否命中缓存）
    if (uploadedFiles.length > 0) {
      excelResult = await generateExcel(
        allRecords,
        templatePath,
        resultsDir
      );

      if (!excelResult.success) {
        throw new Error(excelResult.message);
      }

      jsonOutputPath = generateJsonFile(
        allRecords,
        resultsDir
      );
    } else {
      // 没有新文件上传（理论上不会走到这里，因为前面已经检查了）
      jsonOutputPath = path.join(resultsDir, taskMetadata.result_files?.json || '个人信息提取结果.json');
    }

    // 更新任务元数据
    taskMetadata.status = 'completed';
    taskMetadata.records = allRecords;  // 保存所有记录
    taskMetadata.records_count = allRecords.length;
    taskMetadata.validation_summary = excelResult.validation_summary;
    taskMetadata.result_files = {
      excel: path.basename(excelResult.output_path),
      json: path.basename(jsonOutputPath)
    };
    taskMetadata.message = excelResult.message;
    saveTaskMetadata(taskId, userId, taskMetadata);

    return NextResponse.json({
      success: true,
      task_id: taskId,
      message: excelResult.message,
      excel_file: path.basename(excelResult.output_path),
      json_file: path.basename(jsonOutputPath),
      records_count: taskMetadata.records_count,
      validation_summary: excelResult.validation_summary,
    });

  } catch (error) {
    console.error('处理错误:', error);
    
    // 更新任务状态为失败
    if (taskId && taskMetadata && userId) {
      taskMetadata.status = 'failed';
      taskMetadata.message = error instanceof Error ? error.message : '处理过程中发生错误';
      saveTaskMetadata(taskId, userId, taskMetadata);
    }

    const message = error instanceof Error ? error.message : '处理过程中发生错误';
    return NextResponse.json(
      { success: false, message, task_id: taskId },
      { status: 500 }
    );
  }
}
