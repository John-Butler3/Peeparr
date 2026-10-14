import { applyLegacyEnvNames } from './legacy-env';

describe('applyLegacyEnvNames', () => {
  it('fills PEEPARR_* settings from their old STASHARR_* names', () => {
    const env: NodeJS.ProcessEnv = { STASHARR_LOG_LEVELS: 'error,warn' };

    applyLegacyEnvNames(env);

    expect(env.PEEPARR_LOG_LEVELS).toBe('error,warn');
  });

  it('keeps a PEEPARR_* setting that is already set', () => {
    const env: NodeJS.ProcessEnv = {
      STASHARR_LOG_LEVELS: 'error',
      PEEPARR_LOG_LEVELS: 'debug',
    };

    applyLegacyEnvNames(env);

    expect(env.PEEPARR_LOG_LEVELS).toBe('debug');
  });
});
