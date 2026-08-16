// 端到端功能测试：扫描识别 → Git 状态 → 统计聚合
// 通过 Module._resolveFilename 将 'electron' 替换为桩模块，避免依赖真实 Electron 应用上下文
const Module = require('module')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { execFileSync } = require('child_process')

const stubPath = path.join(__dirname, 'electron-stub.js')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request === 'electron') return stubPath
  return origResolve.call(this, request, ...args)
}

const ROOT = path.join(os.tmpdir(), 'lpm-e2e-scanroot')
const results = []
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail ?? '' })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`)
}

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
}

function setupFixtures() {
  fs.rmSync(ROOT, { recursive: true, force: true })
  // 清空测试数据库（os.tmpdir()/lpm-e2e-test），保证每次运行从干净状态开始
  fs.rmSync(path.join(os.tmpdir(), 'lpm-e2e-test'), { recursive: true, force: true })

  // Node 项目（含 Vue/Express 依赖）
  writeFile(
    path.join(ROOT, 'node-app', 'package.json'),
    JSON.stringify({ name: 'my-node-app', version: '1.0.0', dependencies: { vue: '^3', express: '^4' }, devDependencies: { typescript: '^5' } })
  )
  writeFile(path.join(ROOT, 'node-app', 'index.js'), 'console.log("hi")')

  // Java Spring Boot 项目
  writeFile(
    path.join(ROOT, 'java-app', 'pom.xml'),
    '<project><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId></parent></project>'
  )

  // Python FastAPI 项目
  writeFile(
    path.join(ROOT, 'py-app', 'pyproject.toml'),
    '[project]\nname = "py-app"\ndependencies = ["fastapi"]\n'
  )

  // Go 项目
  writeFile(path.join(ROOT, 'go-app', 'go.mod'), 'module example.com/go-app\n\ngo 1.22\n')

  // Git 仓库（初始化并提交）
  const gitDir = path.join(ROOT, 'git-app')
  writeFile(path.join(gitDir, 'README.md'), '# git-app\n')
  execFileSync('git', ['init', '-q'], { cwd: gitDir })
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: gitDir })
  execFileSync('git', ['config', 'user.name', 'tester'], { cwd: gitDir })
  execFileSync('git', ['add', '-A'], { cwd: gitDir })
  execFileSync('git', ['commit', '-q', '-m', 'initial commit'], { cwd: gitDir })
  // 制造脏状态
  fs.writeFileSync(path.join(gitDir, 'dirty.txt'), 'uncommitted change\n')

  // node_modules 中的 package.json 不应被识别为项目
  writeFile(path.join(ROOT, 'node-app', 'node_modules', 'fake-pkg', 'package.json'), '{}')

  console.log('fixtures ready at', ROOT)
}

async function main() {
  setupFixtures()

  const db = require(path.join(__dirname, '..', 'test-build', 'electron', 'db.js'))
  const scanner = require(path.join(__dirname, '..', 'test-build', 'electron', 'services', 'scanner.js'))
  const gitSvc = require(path.join(__dirname, '..', 'test-build', 'electron', 'services', 'git.js'))
  const stats = require(path.join(__dirname, '..', 'test-build', 'electron', 'services', 'stats.js'))

  const events = []
  const emit = (p) => events.push(p)

  // 1. 扫描
  const res = await scanner.scanRoots([ROOT], emit)
  check('scan completes', res.error === null, JSON.stringify(res))
  check('found 5 projects', res.found === 5, `found=${res.found}`)

  const projects = db.listProjects('WHERE is_existing = 1')
  const byName = Object.fromEntries(projects.map((p) => [p.name, p]))

  check('node project detected', !!byName['my-node-app'], JSON.stringify(byName['my-node-app'] ? { type: byName['my-node-app'].type, stack: byName['my-node-app'].stack } : null))
  const node = byName['my-node-app']
  if (node) {
    const stack = JSON.parse(node.stack)
    check('node stack has Vue+Express+TypeScript', ['Vue', 'Express', 'TypeScript'].every((s) => stack.includes(s)), stack.join(','))
  }

  const java = projects.find((p) => p.type === 'java')
  check('java project detected', !!java, java ? JSON.parse(java.stack).join(',') : '')
  if (java) {
    check('java stack has Spring Boot', JSON.parse(java.stack).includes('Spring Boot'), JSON.parse(java.stack).join(','))
  }

  const py = projects.find((p) => p.type === 'python')
  check('python project detected', !!py, py ? JSON.parse(py.stack).join(',') : '')
  if (py) {
    check('python stack has FastAPI', JSON.parse(py.stack).includes('FastAPI'), JSON.parse(py.stack).join(','))
  }

  const go = projects.find((p) => p.type === 'go')
  check('go project detected', !!go, go ? JSON.parse(go.stack).join(',') : '')

  const gitApp = projects.find((p) => p.name === 'git-app')
  check('git repo detected', !!gitApp && gitApp.is_git === 1, gitApp ? `is_git=${gitApp.is_git}` : '')

  // node_modules 未被识别
  const fake = projects.find((p) => p.path.includes('fake-pkg'))
  check('node_modules not treated as project', !fake, fake ? fake.path : 'none')

  // 2. Git 状态同步
  const sync = await gitSvc.syncAllGitStatus()
  check('git sync runs', sync.total >= 1, JSON.stringify(sync))
  if (gitApp) {
    const status = await gitSvc.getGitStatus(gitApp.id)
    check('git status has branch', !!status && !!status.branch, JSON.stringify(status))
    check('git status detects dirty', status && status.clean === false, `clean=${status?.clean}`)
    check('git status has commits30d >= 1', (status?.commits30d ?? 0) >= 1, `commits30d=${status?.commits30d}`)
    check('git status has lastCommitAt', !!status?.lastCommitAt, `lastCommitAt=${status?.lastCommitAt}`)
  }

  // 3. 统计
  const summary = stats.getSummary()
  check('summary total = 5', summary.total === 5, JSON.stringify(summary))
  check('summary remoteRate = 0 (no remote)', summary.remoteRate === 0, `remoteRate=${summary.remoteRate}`)

  const tech = stats.getTechStack()
  check('tech stack has Node.js/Java/Python/Go', ['Node.js', 'Java', 'Python', 'Go'].every((t) => tech.some((x) => x.name === t)), JSON.stringify(tech))

  const health = stats.getHealth()
  check('health lifecycle developing = 5', health.lifecycle.find((h) => h.name === 'developing')?.value === 5, JSON.stringify(health.lifecycle))
  check('health gitState dirty >= 1', health.gitState.find((h) => h.name === '有未提交修改')?.value >= 1, JSON.stringify(health.gitState))

  // 4. 空间占用
  const sizes = await stats.computeAllSizes()
  check('size computation runs', sizes.done >= 1, JSON.stringify(sizes))
  const disk = stats.getDiskUsage(10)
  check('disk usage lists projects', disk.length >= 5, `count=${disk.length}`)

  // 5. 热力图数据
  if (gitApp) {
    const counts = await gitSvc.syncProjectCommits(gitApp.id, gitApp.path)
    check('heatmap has today commit', counts.size >= 1, [...counts.entries()].slice(0, 3).map(([d, c]) => `${d}:${c}`).join(', '))
    const heat = stats.getHeatmap(365)
    check('heatmap aggregate returns points', heat.length >= 1, `points=${heat.length}`)
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('E2E test crashed:', e)
  process.exit(1)
})
