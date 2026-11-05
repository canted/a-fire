import { captureReportProperties, type CaptureReport } from '../../types/capture-analytics';
import { capturePosthogEvent } from './posthog';
/** Call only after the MCP owner verifies Project access and stored reporting consent.
 * This adapter is ready for that integration; no MCP producer exists yet.
 */
export function captureExperimentOutcome(userId: number, reportingConsent: boolean, input: CaptureReport): boolean {
  if (!reportingConsent || !Number.isSafeInteger(userId) || userId <= 0) return false;
  const properties = captureReportProperties(input);
  if (!properties) return false;
  capturePosthogEvent({ distinctId: userId, event: 'capture_outcome', properties: { ...properties, $insert_id: `capture-outcome:${userId}:${properties.attempt_id}`, reported_by: 'agent' } });
  return true;
}
