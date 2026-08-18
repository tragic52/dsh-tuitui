import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

/** 允许机器人读取的根目录列表（防止任意文件读取） */
function allowedRoots() {
  const roots = [];

  const userProfile = process.env.USERPROFILE;
  if (userProfile) {
    roots.push(join(userProfile, 'Desktop'), join(userProfile, 'Downloads'));
  }

  const extra = process.env.TUITUI_BOT_ALLOW_DIRS;
  if (extra) {
    for (const dir of extra.split(';')) {
      const trimmed = dir.trim();
      if (trimmed) roots.push(trimmed);
    }
  }
  return roots;
}

// 允许的扩展名（创建文件时限制类型）
const ALLOWED_CREATE_EXTENSIONS = new Set([
  '.md', '.mdx', '.txt', '.log',
  '.json', '.jsonc', '.csv', '.tsv',
  '.yaml', '.yml', '.toml', '.ini', '.conf', '.cfg',
  '.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx',
  '.py', '.sh', '.bat', '.ps1',
  '.html', '.htm', '.css', '.xml',
  '.svg', '.graphql', '.sql',
]);

/** 仅匹配文件指令：/send <路径>、/file <路径>（也支持"发文件""发送文件"前缀） */
const SEND_FILE_PATTERN = /^\s*(?:\/(?:send|file)|(?:发 | 发送) 文件)\s+(\S+.*?)\s*$/i;

export function matchSendFileCommand(text) {
  const match = SEND_FILE_PATTERN.exec(text);
  return match ? match[1].trim() : null;
}

/**
 * 校验路径在白名单根目录内，返回规范化绝对路径；非法返回 null。
 */
export function resolveAllowedPath(input) {
  if (typeof input !== 'string' || input.length === 0) return null;

  const abs = isAbsolute(input) ? normalize(input) : resolve(process.cwd(), input);

  const roots = allowedRoots();
  if (roots.length === 0) return abs; // 无限制时允许任何路径

  for (const root of roots) {
    const rootAbs = resolve(root);
    const rel = relative(rootAbs, abs);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..'))) {
      return abs;
    }
  }
  return null;
}

export async function isReadableFile(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

/** 解析 AI 回复中的 [FILE]<路径> 标记（发送已有文件）。 */
export function extractFileMarker(text) {
  const match = /^\s*\[FILE\]\s*(\S+.*?)\s*$/m.exec(text);
  return match ? match[1].trim() : null;
}

/**
 * 解析 AI 回复中的 [CREATEFILE]<路径> ... [FILE_DONE] 标记（创建并发送新文件）。
 */
export function extractCreateFileMarker(text) {
  const match = /\[CREATEFILE][ \t]*(\S+.*?)[ \t]*\r?\n([\s\S]*?)\r?\n\s*\[FILE_DONE]/m.exec(text);
  if (!match) return null;

  const filePath = match[1].trim();
  const content = match[2].replace(/^\r?\n+/, '').replace(/\r?\n+$/, '');
  return { path: filePath, content };
}

/**
 * 创建文件（白名单路径 + 扩展名限制），随后发送。
 */
export async function createAndSendFile({ bot, to, path: inputPath, content }) {
  const filePath = resolveAllowedPath(inputPath);
  if (!filePath) {
    return {
      ok: false,
      message: '无权写入该路径，仅允许桌面、下载目录及 TUITUI_BOT_ALLOW_DIRS 配置的目录',
    };
  }

  const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  if (!ALLOWED_CREATE_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      message: `不支持创建该文件类型 (.${extension.replace('.', '')})，允许：${[...ALLOWED_CREATE_EXTENSIONS].join(' ')}`,
    };
  }

  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');
  } catch (error) {
    return { ok: false, message: `文件写入失败：${error?.message ?? error}` };
  }

  try {
    await bot.sendFile(to, filePath);
    return { ok: true, message: `文件已创建并发送：\n${filePath}` };
  } catch (error) {
    return { ok: false, message: `文件已创建但发送失败：${error?.message ?? error}` };
  }
}

/**
 * 根据用户输入解析并发送本地文件。
 */
export async function sendLocalFile({ bot, to, input }) {
  const cleaned = matchSendFileCommand(input);
  if (!cleaned) return { ok: false, message: '未识别的文件指令' };

  const filePath = resolveAllowedPath(cleaned);
  if (!filePath) {
    return {
      ok: false,
      message: '无权访问该路径，仅允许桌面、下载目录及 TUITUI_BOT_ALLOW_DIRS 配置的目录',
    };
  }
  if (!(await isReadableFile(filePath))) {
    return { ok: false, message: `文件不存在或不是文件：${cleaned}` };
  }

  try {
    await bot.sendFile(to, filePath);
    return { ok: true, message: `文件已发送：${filePath}` };
  } catch (error) {
    return { ok: false, message: `文件发送失败：${error?.message ?? error}` };
  }
}
