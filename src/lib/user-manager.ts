/**
 * 用户管理工具
 * 负责生成和存储用户ID，实现多用户数据隔离
 * 同时管理用户的OCR API Token和API URL
 */

const USER_ID_KEY = 'recruitment_user_id';
const USER_TOKEN_KEY = 'recruitment_user_token';
const USER_API_URL_KEY = 'recruitment_user_api_url';

/**
 * 生成随机用户ID
 */
function generateUserId(): string {
  return `user_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * 获取当前用户ID
 * 如果不存在则生成新的并存储
 */
export function getCurrentUserId(): string {
  if (typeof window === 'undefined') {
    return generateUserId();
  }

  let userId = localStorage.getItem(USER_ID_KEY);
  
  if (!userId) {
    userId = generateUserId();
    localStorage.setItem(USER_ID_KEY, userId);
  }
  
  return userId;
}

/**
 * 设置当前用户ID（用于测试或特殊场景）
 */
export function setUserId(userId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_ID_KEY, userId);
}

/**
 * 清除用户ID（重新生成）
 */
export function clearUserId(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(USER_ID_KEY);
}

/**
 * 获取当前用户的OCR API Token
 */
export function getUserToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(USER_TOKEN_KEY);
}

/**
 * 设置当前用户的OCR API Token
 */
export function setUserToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_TOKEN_KEY, token);
}

/**
 * 清除当前用户的OCR API Token
 */
export function clearUserToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(USER_TOKEN_KEY);
}

/**
 * 检查用户是否已设置Token
 */
export function hasUserToken(): boolean {
  return !!getUserToken();
}

/**
 * 获取当前用户的OCR API URL
 */
export function getUserApiUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(USER_API_URL_KEY);
}

/**
 * 设置当前用户的OCR API URL
 */
export function setUserApiUrl(apiUrl: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_API_URL_KEY, apiUrl);
}

/**
 * 清除当前用户的OCR API URL
 */
export function clearUserApiUrl(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(USER_API_URL_KEY);
}

/**
 * 检查用户是否已设置API URL
 */
export function hasUserApiUrl(): boolean {
  return !!getUserApiUrl();
}
