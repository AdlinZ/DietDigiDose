import { describe, expect, it } from 'vitest';
import {
  voicePackActions,
  voicePackManifestChecks,
  voicePackTransitionConfirmation,
} from './voicePackModel';

describe('voice pack admin model', () => {
  it('only exposes valid state transitions', () => {
    expect(voicePackActions('draft')).toEqual(['edit', 'publish']);
    expect(voicePackActions('published')).toEqual(['disable', 'revoke']);
    expect(voicePackActions('disabled')).toEqual(['publish', 'revoke']);
    expect(voicePackActions('revoked')).toEqual([]);
  });

  it('makes destructive impact explicit', () => {
    expect(voicePackTransitionConfirmation('revoke', 'warm-cn@1.0.0')).toContain('删除已安装模型');
    expect(voicePackTransitionConfirmation('publish', 'warm-cn@1.0.0')).toContain('不可原地覆盖');
  });

  it('flags unsafe manifests before submission', () => {
    expect(voicePackManifestChecks({ resources: [{ url: 'http://bad', path: '../model', sha256: 'no' }] }).every((item) => item.passed)).toBe(false);
  });
});
