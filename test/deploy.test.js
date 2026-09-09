import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// Given the VM's saved public Auth configuration, a redeploy must keep both
// browser login and backend token verification; a failed build must not stop prod.
function deploy(failBuild = false) {
  const dir = mkdtempSync(join(tmpdir(), 'bb-deploy-test-'))
  try {
    writeFileSync(join(dir, '.env.local'), 'VITE_SUPABASE_URL=https://example.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=public-test-key\n')
    writeFileSync(join(dir, 'docker'), `#!/bin/sh
echo "$*" >> "$BB_APP_DIR/calls"
if [ "$1" = build ]; then
  [ "$VITE_SUPABASE_URL" = https://example.supabase.co ] || exit 21
  [ "$VITE_SUPABASE_PUBLISHABLE_KEY" = public-test-key ] || exit 22
  ${failBuild ? 'exit 23' : ':'}
fi
if [ "$1" = run ]; then
  [ "$SUPABASE_URL" = "$VITE_SUPABASE_URL" ] || exit 24
  [ "$SUPABASE_PUBLISHABLE_KEY" = "$VITE_SUPABASE_PUBLISHABLE_KEY" ] || exit 25
fi
`, { mode: 0o755 })
    const result = spawnSync('bash', [resolve('scripts/deploy-vm.sh')], {
      env: { ...process.env, BB_APP_DIR: dir, PATH: `${dir}:${process.env.PATH}` },
      encoding: 'utf8',
    })
    const calls = (() => { try { return readFileSync(join(dir, 'calls'), 'utf8') } catch { return '' } })()
    return { ...result, calls }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('VM deploy supplies public Auth config to the build and runtime', () => {
  const result = deploy()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.calls, /build .*--build-arg VITE_SUPABASE_URL .*--build-arg VITE_SUPABASE_PUBLISHABLE_KEY/)
  assert.match(result.calls, /run .*--network bb-net/)
  assert.match(result.calls, /run .*--env SUPABASE_URL .*--env SUPABASE_PUBLISHABLE_KEY/)
})

test('failed VM build leaves the running container untouched', () => {
  const result = deploy(true)
  assert.equal(result.status, 23, result.stderr)
  assert.doesNotMatch(result.calls, /^(stop|rm|run) /m)
})
