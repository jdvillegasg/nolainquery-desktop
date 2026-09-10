/**
 * User-facing progress labels for cloud generation jobs, keyed by Redis dag_status.
 */
export function generationStepLabelFromDagStatus(
  dagStatus: string | undefined | null,
): string {
  switch ((dagStatus ?? 'processing').toLowerCase()) {
    case 'queued':
      return 'Queued…';
    case 'planning':
      return 'Planning…';
    case 'planning_completed':
      return 'Plan ready…';
    case 'compiling':
    case 'compiled':
    case 'compiling_from_code':
      return 'Compiling pipeline…';
    case 'validating':
      return 'Validating…';
    case 'retrying':
      return 'Correcting pipeline…';
    case 'charging':
    case 'charging_retry':
    case 'finalizing':
      return 'Finalizing…';
    case 'generating_code':
    case 'code_generated':
      return 'Generating code…';
    case 'formatting_visualization':
      return 'Designing visualization…';
    case 'visualization_formatted':
      return 'Validating visualization…';
    case 'processing':
      return 'Generating…';
    default:
      return 'Generating…';
  }
}
