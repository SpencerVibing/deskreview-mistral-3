function fieldType(value = {}) {
  if (value.type === 'array') return `Array · ${value.items?.type || 'value'}`;
  if (value.type === 'integer') return 'Number';
  return String(value.type || 'value').replace(/^./, (character) => character.toUpperCase());
}

function fieldTone(value = {}) {
  const type = value.type === 'array' ? value.items?.type : value.type;
  if (type === 'string') return 'bg-primary-subtle text-primary-emphasis';
  if (type === 'integer' || type === 'number') return 'bg-warning-subtle text-warning-emphasis';
  if (type === 'object') return 'bg-secondary-subtle text-secondary-emphasis';
  return 'text-bg-light border';
}

function nestedShape(field = {}) {
  return field.type === 'array' ? field.items || {} : field;
}

function fieldConstraints(field = {}) {
  const constraints = [];
  if (Number.isInteger(field.minLength)) constraints.push(`min length ${field.minLength}`);
  if (Number.isInteger(field.maxLength)) constraints.push(`max length ${field.maxLength}`);
  if (Number.isInteger(field.minItems)) constraints.push(`min items ${field.minItems}`);
  if (Number.isInteger(field.maxItems)) constraints.push(`max items ${field.maxItems}`);
  if (Number.isInteger(field.minimum)) constraints.push(`minimum ${field.minimum}`);
  if (Number.isInteger(field.maximum)) constraints.push(`maximum ${field.maximum}`);
  if (Array.isArray(field.enum)) constraints.push(`values: ${field.enum.join(', ')}`);
  if (field.additionalProperties === false) constraints.push('no additional fields');
  return constraints;
}

export function renderSchemaOverview({ container, format, idPrefix = 'annotationSchema' }) {
  if (!container) return;
  container.replaceChildren();
  const schema = format?.json_schema?.schema || {};
  let accordionIndex = 0;

  const fieldAccordion = (name, field, path, required = false, group = false) => {
    const shape = nestedShape(field);
    const children = Object.entries(shape.properties || {});
    const requiredChildren = new Set(shape.required || []);
    const item = document.createElement('div');
    item.className = `accordion-item annotation-schema-field border rounded-3 overflow-hidden mb-2${group ? ' annotation-schema-group' : ''}`;
    const heading = document.createElement('h5');
    heading.className = 'accordion-header';
    const button = document.createElement('button');
    const collapseId = `${idPrefix}Field${accordionIndex += 1}`;
    button.type = 'button';
    button.className = 'accordion-button collapsed py-2 px-3 gap-2';
    button.dataset.bsToggle = 'collapse';
    button.dataset.bsTarget = `#${collapseId}`;
    button.dataset.schemaPath = path;
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', collapseId);
    const label = document.createElement('code');
    label.className = 'text-body fw-semibold flex-shrink-0';
    label.textContent = name;
    const kind = document.createElement('span');
    kind.className = `badge fw-normal flex-shrink-0 ${fieldTone(field)}`;
    kind.textContent = fieldType(field);
    const badge = document.createElement('span');
    badge.className = `badge fw-normal flex-shrink-0 ${required ? 'bg-danger-subtle text-danger-emphasis' : 'text-bg-light border text-secondary'}`;
    badge.textContent = required ? 'Required' : 'Optional';
    button.append(label, kind, badge);
    heading.append(button);

    const collapse = document.createElement('div');
    collapse.id = collapseId;
    collapse.className = 'accordion-collapse collapse';
    const body = document.createElement('div');
    body.className = 'accordion-body bg-light-subtle p-3';
    if (field.description) {
      const fullDescription = document.createElement('p');
      fullDescription.className = 'small text-body mb-2';
      fullDescription.textContent = field.description;
      body.append(fullDescription);
    }
    const constraints = fieldConstraints(field);
    if (constraints.length) {
      const constraintRow = document.createElement('div');
      constraintRow.className = 'd-flex flex-wrap gap-2 mb-3';
      constraints.forEach((constraint) => {
        const constraintBadge = document.createElement('span');
        constraintBadge.className = 'badge text-bg-light border text-secondary fw-normal';
        constraintBadge.textContent = constraint;
        constraintRow.append(constraintBadge);
      });
      body.append(constraintRow);
    }
    if (children.length) {
      const nested = document.createElement('div');
      nested.className = 'accordion annotation-schema-children';
      children.forEach(([childName, child]) => {
        const childPath = `${path}${field.type === 'array' ? '[]' : ''}.${childName}`;
        nested.append(fieldAccordion(childName, child, childPath, requiredChildren.has(childName)));
      });
      body.append(nested);
    }

    const rawWrap = document.createElement('div');
    rawWrap.className = children.length ? 'mt-2' : '';
    const rawButton = document.createElement('button');
    const rawId = `${idPrefix}Raw${accordionIndex += 1}`;
    rawButton.type = 'button';
    rawButton.className = 'btn btn-sm btn-link link-secondary text-decoration-none px-0';
    rawButton.dataset.bsToggle = 'collapse';
    rawButton.dataset.bsTarget = `#${rawId}`;
    rawButton.setAttribute('aria-expanded', 'false');
    rawButton.setAttribute('aria-controls', rawId);
    rawButton.textContent = 'View this field as JSON';
    const rawCollapse = document.createElement('div');
    rawCollapse.id = rawId;
    rawCollapse.className = 'collapse';
    const exact = document.createElement('pre');
    exact.className = 'developer-contract-code border rounded-2 mt-2';
    exact.dataset.schemaJson = path;
    exact.textContent = JSON.stringify(field, null, 2);
    rawCollapse.append(exact);
    rawWrap.append(rawButton, rawCollapse);
    body.append(rawWrap);
    collapse.append(body);
    item.append(heading, collapse);
    return item;
  };

  Object.entries(schema.properties || {}).forEach(([name, group]) => {
    container.append(fieldAccordion(name, group, name, (schema.required || []).includes(name), true));
  });
}
