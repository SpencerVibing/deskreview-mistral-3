function handleSchema(handles) {
  return handles.length ? { type: 'string', enum: handles } : { type: 'string' };
}

function mapping(mentionHandles = [], displayHandles = []) {
  return {
    type: 'object', additionalProperties: false, required: ['mention_handle', 'display_handles'],
    properties: {
      mention_handle: handleSchema(mentionHandles),
      display_handles: { type: 'array', items: handleSchema(displayHandles) }
    }
  };
}

export function displayLinksFormat(candidates = {}) {
  const displayHandles = (candidates.displays || []).map((item) => item.handle).filter(Boolean);
  const displayMentionHandles = (candidates.display_mentions || []).map((item) => item.handle).filter(Boolean);
  const handleArray = (handles) => handles.length ? { type: 'array', items: handleSchema(handles) } : { type: 'array', maxItems: 0, items: { type: 'string' } };
  const mappingArray = () => (displayMentionHandles.length && displayHandles.length)
    ? { type: 'array', items: mapping(displayMentionHandles, displayHandles) }
    : { type: 'array', maxItems: 0, items: mapping(displayMentionHandles, displayHandles) };
  return {
    type: 'json_schema',
    json_schema: {
      name: 'deskreview_display_relation_mappings_v1', strict: true,
      schema: {
        type: 'object', additionalProperties: false,
        required: ['display_mappings', 'unmatched_display_mentions', 'unmentioned_display_handles'],
        properties: {
          display_mappings: mappingArray(),
          unmatched_display_mentions: handleArray(displayMentionHandles),
          unmentioned_display_handles: handleArray(displayHandles)
        }
      }
    }
  };
}

export const displayLinksPrompt = [
  'Map the supplied already source-validated manuscript display mention handles to the supplied table and figure display candidate handles. Return opaque handles only. Never return, reconstruct, or alter manuscript text, quotes, page numbers, block IDs, coordinates, candidates, or mentions.',
  'For each display mention, return one display_mappings record containing its mention_handle and the matching table or figure display_handles. Put unmatched mentions and unmentioned displays in their corresponding arrays. Every supplied mention handle must occur exactly once: either in one mapping object or in the unmatched array, never both. Every supplied candidate handle must occur exactly once: either inside one or more mapping arrays or in unmentioned_display_handles, never both. Return JSON only.'
].join(' ');

function known(values = []) { return new Set(values.map((item) => item.handle)); }
function unique(values = []) { return Array.isArray(values) && new Set(values).size === values.length; }
function validSide(mappings, unmatched, unlinked, mentions, items) {
  if (!Array.isArray(mappings) || !unique(unmatched) || !unique(unlinked)) return false;
  if (!unmatched.every((handle) => mentions.has(handle)) || !unlinked.every((handle) => items.has(handle))) return false;
  const mappedMentions = new Set();
  const mappedItems = new Set();
  for (const value of mappings) {
    if (!value || !mentions.has(value.mention_handle) || mappedMentions.has(value.mention_handle) || !unique(value.display_handles) || !value.display_handles.length || !value.display_handles.every((handle) => items.has(handle))) return false;
    mappedMentions.add(value.mention_handle);
    value.display_handles.forEach((handle) => mappedItems.add(handle));
  }
  return [...mentions].every((handle) => mappedMentions.has(handle) !== unmatched.includes(handle))
    && [...items].every((handle) => mappedItems.has(handle) !== unlinked.includes(handle));
}

export function hasValidDisplayLinks(links = {}, candidates = {}) {
  const allowedKeys = new Set(['display_mappings', 'unmatched_display_mentions', 'unmentioned_display_handles']);
  if (!links || typeof links !== 'object' || Array.isArray(links)) return false;
  if (!Object.keys(links).every((key) => allowedKeys.has(key))) return false;
  return validSide(links.display_mappings, links.unmatched_display_mentions, links.unmentioned_display_handles, known(candidates.display_mentions), known(candidates.displays));
}
