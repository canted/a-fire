/** Agent-reported research metadata. Never include paths, URLs, filenames or prose. */
export const captureTriggers = ['monitoring', 'user_request', 'scheduled_reminder', 'completion_offer'] as const;
export const captureAcquisitions = ['existing_artifact', 'user_capture', 'agent_capture'] as const;
export const captureSources = ['folder', 'website', 'agent_session', 'selected_library_item', 'direct_handoff', 'other'] as const;
export const captureOutcomes = ['saved', 'declined', 'skipped', 'no_material', 'source_unavailable', 'failed', 'duplicate', 'suppressed_deleted', 'suppressed_moved'] as const;
export type CaptureReport = {
  attempt_id: string;
  project_id: number;
  entry_id?: number;
  trigger: typeof captureTriggers[number];
  acquisition?: typeof captureAcquisitions[number];
  source: typeof captureSources[number];
  outcome: typeof captureOutcomes[number];
  artifact_count?: number;
  duration_ms?: number;
};
export function captureReportProperties(input: CaptureReport): CaptureReport | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.attempt_id) || !Number.isSafeInteger(input.project_id) || input.project_id <= 0 ||
      !captureTriggers.includes(input.trigger) || !captureSources.includes(input.source) || !captureOutcomes.includes(input.outcome) ||
      (input.acquisition !== undefined && !captureAcquisitions.includes(input.acquisition))) return null;
  for (const value of [input.entry_id, input.artifact_count, input.duration_ms])
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) return null;
  if (input.entry_id === 0 || (input.outcome === 'saved' && !input.entry_id)) return null;
  return { attempt_id: input.attempt_id, project_id: input.project_id, entry_id: input.entry_id, trigger: input.trigger,
    acquisition: input.acquisition, source: input.source, outcome: input.outcome,
    artifact_count: input.artifact_count, duration_ms: input.duration_ms };
}
