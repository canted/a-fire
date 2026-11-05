// Native instrumentation is deferred; browser SDK stays in its platform adapter.
export function syncAnalyticsIdentity(_userId: string | null): void {}
export function trackScreen(_path: string): void {}

export function trackUpload(_outcome: 'started' | 'succeeded' | 'failed', _mediaType: string, _targetType: string, _durationMs?: number): void {}
