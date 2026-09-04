/** 一次性诊断：查看某个 DSH session.jsonl.zstd 解压后的真实结构。
 * 用法：npx electron tools/diag-harness.js <文件路径> */
const { app } = require('electron')
const { readFileSync } = require('fs')
const { decompress } = require('fzstd')

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function decompressZstd(buf) {
  const starts = []
  let idx = buf.indexOf(ZSTD_MAGIC)
  while (idx !== -1) {
    starts.push(idx)
    idx = buf.indexOf(ZSTD_MAGIC, idx + 1)
  }
  if (starts.length <= 1) return Buffer.from(decompress(new Uint8Array(buf))).toString('utf8')
  let text = ''
  let failed = 0
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : buf.length
    try {
      text += Buffer.from(decompress(new Uint8Array(buf.subarray(starts[i], end)))).toString('utf8')
    } catch {
      failed++
    }
  }
  return { text, failed, frames: starts.length }
}

app.whenReady().then(() => {
  const file = process.argv[2]
  const buf = readFileSync(file)
  const out = decompressZstd(buf)
  const text = typeof out === 'string' ? out : out.text
  console.log('[diag] file =', file)
  console.log('[diag] frames =', typeof out === 'string' ? 1 : out.frames, 'failed =', typeof out === 'string' ? 0 : out.failed)
  console.log('[diag] textLength =', text.length)
  const lines = text.split('\n').filter((l) => l.trim())
  console.log('[diag] nonEmptyLines =', lines.length)
  console.log('[diag] firstLine =', lines[0]?.slice(0, 500))
  console.log('[diag] secondLine =', lines[1]?.slice(0, 500))
  console.log('[diag] hasSessionType =', text.includes('"type":"session"') || text.includes('"type": "session"'))
  console.log('[diag] sampleTypes =', [...new Set(lines.map((l) => { try { const o = JSON.parse(l); return o.type } catch { return 'NOT_JSON' } }).slice(0, 30))].join(','))
  app.exit(0)
})
