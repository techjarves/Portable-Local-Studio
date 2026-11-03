const explicitSearchRequest = /\b(?:search(?:\s+the)?\s+(?:web|internet|online)|web\s+search|search\s+for|look\s+(?:it\s+)?up(?:\s+online)?|find\s+(?:it\s+)?online|check\s+(?:online|the\s+web))\b/i;
const currentInfoRequest = /\b(?:current(?:ly)?|right\s+now|today(?:'s)?)\b[^.!?\n]{0,60}\b(?:weather|temperature|forecast|price|stock|news|score|hours|availability)\b|\b(?:weather|temperature|forecast|price|stock|news|score|hours|availability)\b[^.!?\n]{0,60}\b(?:current(?:ly)?|right\s+now|today(?:'s)?)\b/i;

function getExplicitWebSearchQuery(message) {
  const query = String(message || "").trim();
  if (!query || (!explicitSearchRequest.test(query) && !currentInfoRequest.test(query))) {
    return null;
  }
  return query.slice(0, 200);
}

module.exports = { getExplicitWebSearchQuery };
