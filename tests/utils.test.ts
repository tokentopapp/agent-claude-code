import { describe, test, expect } from 'bun:test';
import { decodeProjectDirName, extractProjectPath } from '../src/utils.ts';

describe('decodeProjectDirName', () => {
  test('decodes leading-dash path to absolute path', () => {
    expect(decodeProjectDirName('-Users-nigel-development')).toBe('/Users/nigel/development');
  });

  test('decodes multi-segment absolute path', () => {
    expect(decodeProjectDirName('-Users-nigel-development-tokentop-ttop')).toBe('/Users/nigel/development/tokentop/ttop');
  });

  test('decodes path without leading dash using slash replacement', () => {
    expect(decodeProjectDirName('some-project-dir')).toBe('some/project/dir');
  });

  test('handles empty string', () => {
    expect(decodeProjectDirName('')).toBe('');
  });

  test('handles single segment with leading dash', () => {
    expect(decodeProjectDirName('-Users')).toBe('/Users');
  });
});

describe('extractProjectPath', () => {
  test('returns first non-empty cwd', () => {
    expect(extractProjectPath([
      { cwd: '/Users/test/project' },
      { cwd: '/Users/test/other' },
    ])).toBe('/Users/test/project');
  });

  test('skips entries without cwd', () => {
    expect(extractProjectPath([
      {},
      { cwd: '/Users/test/project' },
    ])).toBe('/Users/test/project');
  });

  test('skips entries with empty cwd', () => {
    expect(extractProjectPath([
      { cwd: '' },
      { cwd: '   ' },
      { cwd: '/Users/test/project' },
    ])).toBe('/Users/test/project');
  });

  test('returns undefined for empty array', () => {
    expect(extractProjectPath([])).toBeUndefined();
  });

  test('returns undefined when no entries have cwd', () => {
    expect(extractProjectPath([{}, {}, {}])).toBeUndefined();
  });

  test('trims whitespace from cwd', () => {
    expect(extractProjectPath([{ cwd: '  /Users/test/project  ' }])).toBe('/Users/test/project');
  });
});
