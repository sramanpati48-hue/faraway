/**
 * OpenUI's Renderer reports errors on every parse pass, and mid-stream those
 * are usually just forward refs that resolve on the next chunk. Only a
 * non-empty result after the stream has finished is worth surfacing.
 */
export function reportRenderError(label: string, error: unknown, streaming: boolean): void {
  if (streaming) return;
  if (Array.isArray(error) && error.length === 0) return;
  if (!error) return;
  console.warn(label, error);
}
