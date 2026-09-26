export const ACTION_CONTEXT_FRACTION = 0.70;

export function contextCeiling(usage) {
  const contextWindow = usage?.contextWindow;
  const tokens = usage?.tokens;
  if (!Number.isFinite(contextWindow) || contextWindow <= 0 || !Number.isFinite(tokens)) {
    return { closed: true, contextWindow: contextWindow ?? null, tokens: tokens ?? null, ceilingTokens: null };
  }
  const ceilingTokens = Math.floor(contextWindow * ACTION_CONTEXT_FRACTION);
  return { closed: tokens >= ceilingTokens, contextWindow, tokens, ceilingTokens };
}

export function contextReport(contextWindow, peakTokens, ceilingReached) {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    return { contextWindow: null, peakTokens: null, peakPercent: null, ceilingTokens: null, ceilingReached };
  }
  return {
    contextWindow,
    peakTokens: Number.isFinite(peakTokens) ? Math.round(peakTokens) : null,
    peakPercent: Number.isFinite(peakTokens) ? Math.round(peakTokens / contextWindow * 1000) / 10 : null,
    ceilingTokens: Math.floor(contextWindow * ACTION_CONTEXT_FRACTION),
    ceilingReached,
  };
}
