import type { Metadata } from 'next';
import { Inspector } from 'react-dev-inspector';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '招聘报名信息提取系统',
    template: '%s | 招聘信息提取',
  },
  description:
    '基于 PaddleOCR + LLM 的智能招聘报名信息提取系统，支持从 PDF、图片等多种文档格式中自动抽取招聘信息，生成结构化的 Excel 和 JSON 数据。支持自定义模板、数据校验、可视化标记，提供后台任务处理和实时进度推送。',
  keywords: [
    '招聘信息提取',
    '报名信息识别',
    'PaddleOCR',
    'OCR 文字识别',
    'LLM 信息抽取',
    'Excel 自动生成',
    '文档处理',
    '智能填表',
    '数据提取',
    '招聘管理',
    'PDF 解析',
    '图片识别',
  ],
  authors: [{ name: '招聘信息提取团队', url: 'https://github.com' }],
  generator: 'Next.js + PaddleOCR + LLM',
  // icons: {
  //   icon: '',
  // },
  openGraph: {
    title: '招聘报名信息提取系统 | 智能文档处理',
    description:
      '使用 PaddleOCR 和 LLM 技术，自动从招聘报名文档中提取关键信息。支持 PDF、图片等多种格式，一键生成 Excel 和 JSON 数据。',
    url: '/',
    siteName: '招聘报名信息提取系统',
    locale: 'zh_CN',
    type: 'website',
    // images: [
    //   {
    //     url: '',
    //     width: 1200,
    //     height: 630,
    //     alt: '招聘报名信息提取系统',
    //   },
    // ],
  },
  // twitter: {
  //   card: 'summary_large_image',
  //   title: 'Recruitment Information Extraction System',
  //   description:
  //     'Automatically extract recruitment information from documents using PaddleOCR and LLM. Generate structured Excel and JSON data.',
  //   // images: [''],
  // },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.NODE_ENV === 'development';

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`antialiased`}>
        {isDev && <Inspector />}
        {children}
      </body>
    </html>
  );
}
