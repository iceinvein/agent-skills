import { expect, test } from 'bun:test'
import { claudeFailureMessage, worktreeRemoveCommand } from '../replay-critic.ts'

test('a failed claude run names its label and the result subtype from stdout', () => {
  const stdout = JSON.stringify({ type: 'result', is_error: true, subtype: 'error_max_turns' })
  expect(claudeFailureMessage('critic batch 2', 1, stdout, 'boom\n')).toBe(
    'critic batch 2: claude -p exit 1; is_error true, subtype error_max_turns; stderr: boom',
  )
})

test('a failed claude run with non-JSON stdout carries the raw stdout', () => {
  expect(claudeFailureMessage('full replay', 137, 'Killed\n', '')).toBe(
    'full replay: claude -p exit 137; stdout: Killed; stderr: ',
  )
})

test('a worktree that was never added has no removal command', () => {
  expect(worktreeRemoveCommand('/repo', '/scratch/worktree', false)).toBeNull()
})

test('an added worktree is removed with a forced git worktree remove', () => {
  expect(worktreeRemoveCommand('/repo', '/scratch/worktree', true)).toEqual([
    'git',
    '-C',
    '/repo',
    'worktree',
    'remove',
    '--force',
    '/scratch/worktree',
  ])
})
