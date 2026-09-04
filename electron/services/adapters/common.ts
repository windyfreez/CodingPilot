/**
 * 采集适配器共用小工具
 */

/** 按相同前缀/后缀裁剪后估算 old→new 的增删行数 */
export function lineDiff(oldStr: string, newStr: string): { add: number; del: number } {
  if (oldStr === newStr) return { add: 0, del: 0 }
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')
  if (!oldStr) return { add: newLines.length, del: 0 }
  if (!newStr) return { add: 0, del: oldLines.length }
  let a = 0
  let b = oldLines.length - 1
  let x = 0
  let y = newLines.length - 1
  while (a <= b && x <= y && oldLines[a] === newLines[x]) {
    a++
    x++
  }
  while (b >= a && y >= x && oldLines[b] === newLines[y]) {
    b--
    y--
  }
  const del = Math.max(b - a + 1, 0)
  const add = Math.max(y - x + 1, 0)
  return { add, del }
}

/** 从 Edit / MultiEdit / str_replace_editor 类参数估算增删行 */
export function diffFromStrings(oldString: string | undefined, newString: string | undefined): { add: number; del: number } {
  if (typeof oldString !== 'string' || typeof newString !== 'string') {
    // 只有新内容（如 Write）时按整文件行数计
    if (typeof newString === 'string') return { add: newString ? newString.split('\n').length : 0, del: 0 }
    return { add: 0, del: 0 }
  }
  return lineDiff(oldString, newString)
}
