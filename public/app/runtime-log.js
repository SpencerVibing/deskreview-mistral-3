export function createRuntimeLog(now = () => performance.now()) {
  let startedAt = now();
  let entries = [];
  let keys = new Set();

  function validEntry(value) {
    return value && typeof value === 'object'
      && typeof value.label === 'string'
      && typeof value.detail === 'string'
      && (!('elapsedMs' in value) || (Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0));
  }

  return {
    reset() {
      startedAt = now();
      entries = [];
      keys = new Set();
    },
    record(label, detail = '', key = label, data = null) {
      if (keys.has(key)) return;
      keys.add(key);
      entries.push({
        key,
        label,
        detail,
        elapsedMs: Math.max(0, now() - startedAt),
        ...(data && typeof data === 'object' ? { data: { ...data } } : {})
      });
    },
    restore(snapshot = []) {
      startedAt = now();
      entries = Array.isArray(snapshot) ? snapshot.filter(validEntry).map((entry) => ({
        key: typeof entry.key === 'string' && entry.key ? entry.key : entry.label,
        label: entry.label,
        detail: entry.detail,
        elapsedMs: Number.isFinite(entry.elapsedMs) ? entry.elapsedMs : 0,
        ...(entry.data && typeof entry.data === 'object' ? { data: { ...entry.data } } : {})
      })) : [];
      keys = new Set(entries.map((entry) => entry.key));
    },
    entries() {
      return entries.map((entry) => ({ ...entry }));
    }
  };
}

const resultDefinitions = [
  { kind: 'authors', label: 'Authors', extraLabel: 'External profiles', extraPrefix: 'author-profiles' },
  { kind: 'affiliations', label: 'Affiliations' },
  { kind: 'abstract', label: 'Abstract' },
  { kind: 'article', label: 'Article' },
  { kind: 'keywords', label: 'Keywords' },
  { kind: 'references', label: 'References', extraLabel: 'Body citations', extraPrefix: 'body-citations' },
  { kind: 'tables', label: 'Tables', extraLabel: 'Body mentions', extraPrefix: 'display-links' },
  { kind: 'figures', label: 'Figures', extraLabel: 'Body mentions', extraPrefix: 'display-links' }
];

function eventState(event) {
  const label = String(event?.label || '').toLowerCase();
  if (/unavailable|incomplete|failed/.test(label)) return 'unavailable';
  if (/started|preparing|extracting|linking/.test(label)) return 'pending';
  return event ? 'ready' : 'waiting';
}

function lastMatching(entries, predicate) {
  return [...entries].reverse().find(predicate) || null;
}

function eventWithKey(entries, key) {
  return lastMatching(entries, (entry) => entry.key === key);
}

function eventWithPrefix(entries, prefix) {
  return lastMatching(entries, (entry) => entry.key === prefix || entry.key.startsWith(`${prefix}:`));
}

function stage(id, label, icon, event, detail = '') {
  return {
    id,
    label,
    icon,
    state: eventState(event),
    elapsedMs: event?.elapsedMs ?? null,
    detail: detail || event?.detail || ''
  };
}

function numberFromDetail(event, pattern) {
  const match = pattern.exec(String(event?.detail || ''));
  return match ? Number(match[1]) : null;
}

function referenceDependencyFlow(entries) {
  const count = eventWithKey(entries, 'count:references');
  const inventory = eventWithPrefix(entries, 'reference-inventory');
  const extraction = eventWithPrefix(entries, 'body-citations');
  const inputs = eventWithKey(entries, 'reference-links:inputs');
  const relation = eventWithPrefix(entries, 'reference-links');
  const links = eventWithKey(entries, 'links:references');
  const started = eventWithKey(entries, 'reference-links:start') || (
    relation?.key === 'reference-links' && /started/i.test(relation.label) ? relation : null
  );
  const referenceCount = Number.isFinite(inputs?.data?.referenceCount)
    ? inputs.data.referenceCount
    : numberFromDetail(started, /matched to (\d+) references/i)
      ?? numberFromDetail(inventory, /(\d+) individual references/i)
      ?? numberFromDetail(count, /(\d+) references/i);
  const citationCount = Number.isFinite(inputs?.data?.citationMentionCount)
    ? inputs.data.citationMentionCount
    : numberFromDetail(started, /(\d+) source-grounded body citation groups/i);
  const bodyState = eventState(extraction) === 'unavailable'
    ? 'unavailable'
    : citationCount === 0
      ? 'blocked'
      : Number.isFinite(citationCount)
        ? 'ready'
        : eventState(extraction);
  const relationState = bodyState === 'blocked' ? 'blocked' : eventState(relation);
  return [
    {
      label: 'Bibliography inventory',
      state: inventory ? eventState(inventory) : eventState(count),
      elapsedMs: inventory?.elapsedMs ?? count?.elapsedMs ?? null,
      detail: Number.isFinite(referenceCount) ? `${referenceCount} individual references available.` : 'No reference inventory event was recorded.'
    },
    {
      label: 'Body citation extraction',
      state: bodyState,
      elapsedMs: extraction?.elapsedMs ?? inputs?.elapsedMs ?? started?.elapsedMs ?? null,
      detail: citationCount === 0
        ? 'The focused annotation stage returned 0 grounded body citation groups. This is the blocking input.'
        : Number.isFinite(citationCount)
          ? `${citationCount} source-grounded citation groups available.`
          : extraction?.detail || 'No body-citation extraction event was recorded.'
    },
    {
      label: 'Exact-quote grounding',
      state: bodyState,
      elapsedMs: extraction?.elapsedMs ?? null,
      detail: extraction?.detail || 'No exact-quote grounding result was recorded.'
    },
    {
      label: 'Document QnA mapping',
      state: relationState,
      elapsedMs: relation?.elapsedMs ?? null,
      detail: bodyState === 'blocked'
        ? 'Mapping cannot produce manuscript-use links without body citation groups.'
        : relation?.detail || 'No mapping event was recorded.'
    },
    {
      label: 'Manuscript-use links',
      state: links ? 'ready' : relationState === 'unavailable' || relationState === 'blocked' ? 'unavailable' : 'waiting',
      elapsedMs: links?.elapsedMs ?? relation?.elapsedMs ?? null,
      detail: links?.detail || 'No completed manuscript-use link set was recorded.'
    }
  ];
}

export function runtimeFlowModel(snapshot = []) {
  const entries = Array.isArray(snapshot)
    ? snapshot.filter((entry) => entry && typeof entry === 'object').map((entry) => ({ ...entry }))
    : [];
  const elapsedMs = entries.reduce((maximum, entry) => Math.max(maximum, Number(entry.elapsedMs) || 0), 0);
  const annotationEvents = entries.filter((entry) => (
    entry.key?.startsWith('annotation:')
    || entry.key === 'annotation-coverage'
    || entry.key?.startsWith('annotation-ocr:')
  ));
  const countEvents = entries.filter((entry) => entry.key?.startsWith('count:'));
  const linkEvents = entries.filter((entry) => entry.key?.startsWith('links:'));
  const sourceLinkLifecycle = lastMatching(entries, (entry) => (
    entry.key?.startsWith('reference-links')
    || entry.key?.startsWith('display-links')
  ));
  const bodyCitationLifecycle = eventWithPrefix(entries, 'body-citations');
  const annotationEvent = lastMatching(annotationEvents, (entry) => eventState(entry) === 'unavailable')
    || annotationEvents.at(-1)
    || null;
  const countEvent = countEvents.at(-1) || null;
  const linkEvent = sourceLinkLifecycle || linkEvents.at(-1) || null;
  const results = resultDefinitions.map((definition) => {
    const count = eventWithKey(entries, `count:${definition.kind}`);
    const links = eventWithKey(entries, `links:${definition.kind}`);
    const categoryState = lastMatching(entries, (entry) => entry.key?.startsWith(`state:${definition.kind}:`));
    let linkState = links ? 'ready' : eventState(categoryState) === 'pending' ? 'pending' : 'waiting';
    if (!links && eventState(categoryState) === 'unavailable') linkState = 'unavailable';
    let extra = null;
    if (definition.extraPrefix) {
      const extraEvent = eventWithPrefix(entries, definition.extraPrefix);
      extra = {
        label: definition.extraLabel,
        state: eventState(extraEvent),
        elapsedMs: extraEvent?.elapsedMs ?? null,
        detail: extraEvent?.detail || ''
      };
    }
    if (definition.kind === 'references' && extra?.state === 'unavailable') linkState = 'unavailable';
    if (['tables', 'figures'].includes(definition.kind) && extra?.state === 'unavailable') linkState = 'unavailable';
    return {
      ...definition,
      count: {
        state: eventState(count),
        elapsedMs: count?.elapsedMs ?? null,
        detail: count?.detail || ''
      },
      links: {
        state: linkState,
        elapsedMs: links?.elapsedMs ?? null,
        detail: links?.detail || ''
      },
      extra,
      dependencies: definition.kind === 'references'
        ? referenceDependencyFlow(entries)
        : [
            {
              label: 'Count',
              state: eventState(count),
              elapsedMs: count?.elapsedMs ?? null,
              detail: count?.detail || 'No count event was recorded.'
            },
            {
              label: 'Exact item links',
              state: linkState,
              elapsedMs: links?.elapsedMs ?? null,
              detail: links?.detail || 'No completed item-link event was recorded.'
            },
            ...(extra ? [{
              label: extra.label,
              state: extra.state,
              elapsedMs: extra.elapsedMs,
              detail: extra.detail || `No ${extra.label.toLowerCase()} event was recorded.`
            }] : [])
          ]
    };
  });
  return {
    elapsedMs,
    countsReady: results.filter((result) => result.count.state === 'ready').length,
    linksReady: results.filter((result) => result.links.state === 'ready').length,
    resultCount: results.length,
    stages: [
      stage('upload', 'Upload', 'bi-upload', eventWithKey(entries, 'Upload started') || eventWithKey(entries, 'upload')),
      stage('ocr', 'Raw OCR', 'bi-file-earmark-text', eventWithKey(entries, 'raw-ocr')),
      stage('toc', 'Contents', 'bi-list-nested', eventWithKey(entries, 'toc')),
      stage('annotation', 'Annotation', 'bi-braces', annotationEvent, annotationEvents.length ? `${annotationEvents.length} annotation checkpoint${annotationEvents.length === 1 ? '' : 's'} recorded.` : ''),
      stage('counts', 'Counts', 'bi-grid-3x3-gap', countEvent, countEvents.length ? `${countEvents.length}/${resultDefinitions.length} result counts ready.` : ''),
      stage('citations', 'Body citations', 'bi-quote', bodyCitationLifecycle),
      stage('links', 'Document QnA', 'bi-link-45deg', linkEvent, linkEvents.length ? `${linkEvents.length}/${resultDefinitions.length} result link sets ready.` : ''),
      stage('storage', 'Stored', 'bi-device-ssd', eventWithKey(entries, 'storage'))
    ],
    results
  };
}
