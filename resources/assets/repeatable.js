
            (function() {
                'use strict';

                // Cache for field templates to avoid repeated AJAX calls
                const fieldTemplateCache = new Map();

                // Batch size for lazy loading
                const BATCH_SIZE = 3;
                const BATCH_DELAY = 50; // ms between batches

                // Lifecycle tracing, on when APP_DEBUG is. Uses console.info:
                // Chrome hides console.debug at its default log levels.
                const DEBUG = window.BackpackRepeatableConfig.debug;
                const FIELD_URL = window.BackpackRepeatableConfig.fieldUrl;
                function trace(...args) {
                    if (DEBUG) console.info('[repeatable_gpt]', ...args);
                }

                trace('script loaded');

                // Debounce utility
                function debounce(func, wait) {
                    let timeout;
                    return function executedFunction(...args) {
                        const later = () => {
                            clearTimeout(timeout);
                            func(...args);
                        };
                        clearTimeout(timeout);
                        timeout = setTimeout(later, wait);
                    };
                }

                // Track initialized elements to prevent double initialization
                const initializedElements = new WeakSet();

                /**
                 * Initialize Backpack fields by calling their data-init-function
                 */
                function initBackpackFields($scope) {
                    $scope.find('[data-init-function]').each(function() {
                        const $el = $(this);
                        const initFunction = $el.data('init-function');

                        // Skip if already initialized
                        if ($el.attr('data-bp-field-initialized') === 'true') {
                            return;
                        }

                        // Mark as initialized
                        $el.attr('data-bp-field-initialized', 'true');

                        // Call the init function if it exists
                        if (initFunction && typeof window[initFunction] === 'function') {
                            try {
                                window[initFunction]($el);
                            } catch (e) {
                                console.warn('Error initializing field with ' + initFunction + ':', e);
                            }
                        } else {
                            console.warn('Init function not found:', initFunction);
                        }
                    });
                }

                function initializeRepeatable(container) {
                    if (initializedElements.has(container)) {
                        return;
                    }
                    initializedElements.add(container);

                    // Use event delegation instead of attaching to each button
                    if (container === document) {
                        setupEventDelegation();
                        // Start lazy loading if needed
                        initializeLazyContainers().catch(error => {
                            console.error('[repeatable_gpt] lazy loading failed:', error);
                        });
                    }

                    // Initialize fields - but only for new elements
                    const newElements = container.querySelectorAll('.repeatable-element-gpt:not([data-initialized])');
                    if (newElements.length > 0) {
                        initializeFieldsWithJavascript($(newElements));
                        newElements.forEach(el => el.setAttribute('data-initialized', 'true'));
                    }

                    initializeSelectHandlers(container);
                }

                // Single event delegation setup - runs only once
                let delegationSetup = false;
                function setupEventDelegation() {
                    if (delegationSetup) return;
                    delegationSetup = true;

                    document.addEventListener('click', function(event) {
                        const target = event.target;

                        if (target.closest('.delete-element-gpt')) {
                            event.preventDefault();
                            const element = target.closest('.repeatable-element-gpt');
                            if (element) {
                                const parent = element.parentElement;
                                element.remove();
                                updateAddButtonState(parent);
                                updateButtonsState(parent);
                            }
                            return;
                        }

                        if (target.closest('.add-repeatable-element')) {
                            event.preventDefault();
                            handleAddParentItem(target.closest('.add-repeatable-element'));
                            return;
                        }

                        if (target.closest('.add-child-repeatable-element')) {
                            event.preventDefault();
                            handleAddChildItem(target.closest('.add-child-repeatable-element'));
                            return;
                        }
                    }, { passive: false });
                }

                function initializeSelectHandlers(container) {
                    const selects = container.querySelectorAll('.repeatable-element-gpt select:not([data-handler-attached])');

                    selects.forEach(function(item) {
                        item.setAttribute('data-handler-attached', 'true');
                        const sel = $(item);
                        const dataHide = sel.attr('data-hide');

                        if (dataHide) {
                            try {
                                const jsonObject = JSON.parse(dataHide);
                                const jsonKey = Object.keys(jsonObject)[0];
                                const jsonValue = Object.values(jsonObject)[0];

                                sel.on('change', function() {
                                    const parentEl = $(this).closest('.repeatable-element-gpt').find('input');

                                    parentEl.each(function() {
                                        if ($(this).attr('data-hide') === jsonValue) {
                                            $(this).closest('.form-group').toggle(jsonKey === sel.val());
                                        }
                                    });
                                });

                                sel.trigger('change');
                            } catch (e) {
                                console.warn('Invalid JSON in data-hide attribute:', dataHide);
                            }
                        }
                    });

                    afterScriptStart();
                }

                // =====================================================
                // LAZY LOADING FUNCTIONS
                // =====================================================

                async function initializeLazyContainers() {
                    const lazyContainers = document.querySelectorAll('[data-lazy-load="true"]');
                    trace('lazy containers found:', lazyContainers.length);

                    // One broken container must not stop the ones after it.
                    for (const container of lazyContainers) {
                        const name = container.getAttribute('data-field-name');
                        const started = performance.now();

                        try {
                            await loadContainerLazily(container);
                            trace(name + ': done in ' + Math.round(performance.now() - started) + 'ms');
                        } catch (error) {
                            console.error('[repeatable_gpt] ' + name + ' failed to load:', error);
                            container.setAttribute('data-lazy-failed', 'true');

                            const placeholder = container.querySelector('.lazy-load-placeholder');
                            if (placeholder) {
                                placeholder.innerHTML = '<div class="alert alert-danger mb-0">These blocks failed to load. '
                                    + 'Saving is disabled so they are not lost — reload the page.</div>';
                            }
                        }
                    }
                }

                // A container keeps data-lazy-load until every row is in the
                // form. Submitting before that writes only the rows rendered so
                // far and deletes the rest — which is how a page went from 7
                // blocks to 1. Block the save instead.
                document.addEventListener('submit', function (event) {
                    const pending = event.target.querySelectorAll('[data-lazy-load="true"]');
                    if (!pending.length) return;

                    event.preventDefault();
                    event.stopImmediatePropagation();

                    const failed = [...pending].some(c => c.hasAttribute('data-lazy-failed'));
                    alert(failed
                        ? 'Some blocks failed to load. Reload the page before saving, otherwise they would be deleted.'
                        : 'Blocks are still loading. Wait for them to finish, then save.');
                }, true);

                // Rows keep the index they were rendered with: moving a row only
                // moves its DOM node, and a child row added after a delete can
                // reuse an index that is still taken. Rewrite every row's index
                // from its position right before submit, so the saved keys are
                // 0..n in the order the editor sees — at every nesting level.
                function renumberRows(rows, base) {
                    rows.forEach(function (row, position) {
                        const prefix = base + '[' + position + ']';

                        row.querySelectorAll('[name]').forEach(function (input) {
                            const name = input.getAttribute('name');
                            if (!name.startsWith(base + '[')) return;

                            const index = name.slice(base.length).match(/^\[\d+\]/);
                            if (!index) return;

                            input.setAttribute('name', prefix + name.slice(base.length + index[0].length));
                        });

                        // Nested repeatables owned by this row (not by a row nested deeper)
                        row.querySelectorAll('.add-child-repeatable-element').forEach(function (button) {
                            if (button.closest('.repeatable-element-gpt') !== row) return;

                            const field = (button.getAttribute('data-field-name') || '').match(/\[([^\[\]]+)\]$/);
                            if (!field) return;

                            // Child rows sit in .container-repeatable-elements, or directly
                            // in the field wrapper once added via handleAddChildItem.
                            const childRows = [...button.parentElement.querySelectorAll('.repeatable-element-gpt')]
                                .filter(child => child.parentElement.closest('.repeatable-element-gpt') === row);

                            const childBase = prefix + '[' + field[1] + ']';
                            button.setAttribute('data-field-name', childBase);
                            renumberRows(childRows, childBase);
                        });
                    });
                }

                // jQuery handler on purpose: Backpack's save-action dropdown submits
                // via jQuery's crudForm.submit(), which never fires native submit
                // listeners — this catches both that and the plain Save button.
                $(document).on('submit', 'form', function (event) {
                    // The native guard above only sees native submits; repeat it here.
                    if (this.querySelector('[data-lazy-load="true"]')) {
                        event.preventDefault();
                        $(this).find('button[type=submit]').prop('disabled', false);
                        alert('Blocks are still loading. Wait for them to finish, then save.');
                        return;
                    }

                    this.querySelectorAll('.container-repeatable-elements-root').forEach(function (root) {
                        const button = root.nextElementSibling;
                        if (!button || !button.classList.contains('add-repeatable-element')) return;

                        renumberRows(root.querySelectorAll(':scope > .repeatable-element-gpt'), button.getAttribute('data-field-name'));
                    });
                });

                async function loadContainerLazily(container) {
                    const fieldName = container.getAttribute('data-field-name');
                    const fieldConfig = JSON.parse(container.getAttribute('data-field-config'));
                    const fieldValues = JSON.parse(container.getAttribute('data-field-values'));
                    const placeholder = container.querySelector('.lazy-load-placeholder');
                    const progressBar = placeholder?.querySelector('.progress-bar');

                    const totalItems = fieldValues.length;
                    let loadedItems = 0;

                    // Pre-fetch all unique field types to cache templates
                    const uniqueTypes = new Set();
                    function collectTypes(fields) {
                        fields.forEach(f => {
                            uniqueTypes.add(f.type);
                            if (f.type === 'repeatable' && f.fields) {
                                collectTypes(f.fields);
                            }
                        });
                    }
                    collectTypes(fieldConfig);
                    trace(fieldName + ': ' + totalItems + ' rows, field types:', [...uniqueTypes]);

                    // Prefetch templates in parallel
                    await Promise.all([...uniqueTypes].map(type => prefetchFieldTemplate(type, fieldConfig)));

                    // Process items in batches
                    for (let i = 0; i < fieldValues.length; i += BATCH_SIZE) {
                        const batch = fieldValues.slice(i, Math.min(i + BATCH_SIZE, fieldValues.length));

                        // Each row is isolated: one row failing must not stop the
                        // rest of the page from rendering, and its values must
                        // survive the save regardless.
                        const settled = await Promise.all(batch.map(async (values, batchIndex) => {
                            const index = i + batchIndex;
                            const prefix = fieldName + '[' + index + ']';

                            try {
                                return await createElementWithValues(fieldConfig, prefix, values);
                            } catch (error) {
                                console.error('Row ' + index + ' failed to render:', error);
                                return createFallbackElement(prefix, values, index);
                            }
                        }));

                        const elements = settled;
                        trace(fieldName + ': rendered rows ' + i + '–' + (i + batch.length - 1));

                        // Insert elements into DOM FIRST
                        elements.forEach(el => {
                            if (placeholder) {
                                container.insertBefore(el, placeholder);
                            } else {
                                container.appendChild(el);
                            }
                            el.setAttribute('data-initialized', 'true');
                        });

                        // THEN initialize Backpack fields - scripts are already loaded server-side!
                        elements.forEach(el => {
                            initBackpackFields($(el));
                            initializeSelectHandlers(el);
                        });

                        loadedItems += batch.length;
                        if (progressBar) {
                            progressBar.style.width = Math.round((loadedItems / totalItems) * 100) + '%';
                        }

                        if (i + BATCH_SIZE < fieldValues.length) {
                            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
                        }
                    }

                    if (placeholder) {
                        placeholder.remove();
                    }

                    container.removeAttribute('data-lazy-load');
                    container.removeAttribute('data-field-values');

                    afterScriptStart();
                    updateAddButtonState(container);
                    updateButtonsState(container);
                }

                async function prefetchFieldTemplate(type, fieldConfig) {
                    let sampleField = null;
                    function findField(fields) {
                        for (const f of fields) {
                            if (f.type === type) {
                                sampleField = f;
                                return true;
                            }
                            if (f.type === 'repeatable' && f.fields && findField(f.fields)) {
                                return true;
                            }
                        }
                        return false;
                    }
                    findField(fieldConfig);

                    if (sampleField && type !== 'repeatable') {
                        await makeAjaxAsync('__FIELD_NAME__', { ...sampleField, label: '__FIELD_LABEL__' });
                    }
                }

                // A row that could not be built still has to carry its stored
                // values, otherwise saving the page deletes them.
                function createFallbackElement(baseName, values, index) {
                    const el = document.createElement('div');
                    el.classList.add('repeatable-element-gpt', 'col-md-12', 'well', 'repeatable-element', 'row', 'm-1', 'p-2');

                    const inputs = Object.keys(values || {}).map(key => {
                        const raw = values[key];
                        const str = (raw === null || raw === undefined)
                            ? ''
                            : (typeof raw === 'string' ? raw : JSON.stringify(raw));

                        return `<input type="hidden" name="${baseName}[${key}]" value="${escapeHtml(str)}">`;
                    }).join('');

                    el.innerHTML = `
                        <div class="alert alert-warning mb-0" style="width:100%">
                            <strong>Block ${index + 1} could not be opened for editing.</strong>
                            Its content is intact and will be kept when you save. Reload the page to try again.
                        </div>
                        ${inputs}
                    `;

                    return el;
                }

                async function createElementWithValues(fieldConfig, baseName, values) {
                    const newElement = document.createElement('div');
                    newElement.classList.add('repeatable-element-gpt', 'col-md-12', 'well', 'repeatable-element', 'row', 'm-1', 'p-2');
                    newElement.innerHTML = `
                        <div class="controls">
                            <button type="button" class="close delete-element-gpt">
                                <span aria-hidden="true">&times;</span>
                            </button>
                            <button type="button" class="close move-element-up">
                                <svg viewBox="0 0 64 80"><path d="M46.8,36.7c-4.3-4.3-8.7-8.7-13-13c-1-1-2.6-1-3.5,0c-4.3,4.3-8.7,8.7-13,13c-2.3,2.3,1.3,5.8,3.5,3.5c4.3-4.3,8.7-8.7,13-13c-1.2,0-2.4,0-3.5,0c4.3,4.3,8.7,8.7,13,13C45.5,42.5,49,39,46.8,36.7L46.8,36.7z"/></svg>
                            </button>
                            <button type="button" class="close move-element-down">
                                <svg viewBox="0 0 64 80"><path d="M17.2,30.3c4.3,4.3,8.7,8.7,13,13c1,1,2.6,1,3.5,0c4.3-4.3,8.7-8.7,13-13c2.3-2.3-1.3-5.8-3.5-3.5c-4.3,4.3-8.7,8.7-13,13c1.2,0,2.4,0,3.5,0c-4.3-4.3-8.7-8.7-13-13C18.5,24.5,15,28,17.2,30.3L17.2,30.3z"/></svg>
                            </button>
                        </div>
                    `;

                    const fieldPromises = fieldConfig.map(field => {
                        const fieldWithValue = {
                            ...field,
                            value: values[field.name] ?? field.default ?? '',
                            default: values[field.name] ?? field.default ?? ''
                        };
                        return createFieldHtmlAsync(fieldWithValue, baseName, null);
                    });

                    const fieldHtmls = await Promise.all(fieldPromises);
                    fieldHtmls.forEach(html => {
                        newElement.insertAdjacentHTML('beforeend', html);
                    });

                    return newElement;
                }

                // =====================================================
                // ADD ELEMENT HANDLERS
                // =====================================================

                async function handleAddParentItem(button) {
                    const container = button.previousElementSibling;
                    const fields = JSON.parse(button.getAttribute('data-repeatable-fields'));
                    const fieldName = button.getAttribute('data-field-name');
                    const lastIndex = getNextIndex(container);

                    const newElement = createRepeatableElement();
                    container.appendChild(newElement);

                    // Load fields asynchronously
                    await loadFieldsAsync(fields, fieldName + '[' + lastIndex + ']', newElement, container);

                    newElement.classList.remove('is-loading');
                    newElement.setAttribute('data-initialized', 'true');

                    // Initialize Backpack fields - scripts are already loaded server-side!
                    initBackpackFields($(newElement));
                    initializeSelectHandlers(newElement);
                    afterScriptStart();
                    updateAddButtonState(container);
                    updateButtonsState(container);
                }

                async function handleAddChildItem(button) {
                    const container = button.parentElement;
                    const fields = JSON.parse(button.getAttribute('data-repeatable-fields'));
                    const fieldName = button.getAttribute('data-field-name');
                    const lastIndex = getNextChildIndex(container);

                    const newElement = createRepeatableElement();
                    container.insertBefore(newElement, button);

                    await loadFieldsAsync(fields, fieldName + '[' + lastIndex + ']', newElement, container);

                    newElement.classList.remove('is-loading');
                    newElement.setAttribute('data-initialized', 'true');

                    initBackpackFields($(newElement));
                    initializeSelectHandlers(newElement);
                }

                function createRepeatableElement() {
                    const newElement = document.createElement('div');
                    newElement.classList.add('repeatable-element-gpt', 'col-md-12', 'well', 'repeatable-element', 'row', 'm-1', 'p-2', 'is-loading');
                    newElement.innerHTML = `
                        <div class="controls">
                            <button type="button" class="close delete-element-gpt">
                                <span aria-hidden="true">&times;</span>
                            </button>
                            <button type="button" class="close move-element-up">
                                <svg viewBox="0 0 64 80"><path d="M46.8,36.7c-4.3-4.3-8.7-8.7-13-13c-1-1-2.6-1-3.5,0c-4.3,4.3-8.7,8.7-13,13c-2.3,2.3,1.3,5.8,3.5,3.5c4.3-4.3,8.7-8.7,13-13c-1.2,0-2.4,0-3.5,0c4.3,4.3,8.7,8.7,13,13C45.5,42.5,49,39,46.8,36.7L46.8,36.7z"/></svg>
                            </button>
                            <button type="button" class="close move-element-down">
                                <svg viewBox="0 0 64 80"><path d="M17.2,30.3c4.3,4.3,8.7,8.7,13,13c1,1,2.6,1,3.5,0c4.3-4.3,8.7-8.7,13-13c2.3-2.3-1.3-5.8-3.5-3.5c-4.3,4.3-8.7,8.7-13,13c1.2,0,2.4,0,3.5,0c-4.3-4.3-8.7-8.7-13-13C18.5,24.5,15,28,17.2,30.3L17.2,30.3z"/></svg>
                            </button>
                        </div>
                    `;
                    return newElement;
                }

                // =====================================================
                // ASYNC FIELD LOADING
                // =====================================================

                async function loadFieldsAsync(fields, baseName, targetElement, container) {
                    const promises = fields.map(field => createFieldHtmlAsync(field, baseName, container));
                    const results = await Promise.all(promises);

                    results.forEach(html => {
                        targetElement.insertAdjacentHTML('beforeend', html);
                    });
                }

                async function createFieldHtmlAsync(field, baseName, container = false) {
                    const fieldName = baseName + '[' + field.name + ']';

                    if (field.type === 'repeatable') {
                        let lastIndex = 0;
                        if (container) {
                            const fieldContainer = container.querySelector('.field-' + field.name);
                            if (fieldContainer) {
                                lastIndex = fieldContainer.querySelectorAll('.repeatable-element-gpt').length;
                            }
                        }

                        let nestedContent = '';
                        if (Array.isArray(field.value) && field.value.length > 0) {
                            const nestedPromises = field.value.map((nestedValues, nestedIndex) => {
                                return createNestedRepeatableContent(field.fields, fieldName + '[' + nestedIndex + ']', nestedValues);
                            });
                            const nestedResults = await Promise.all(nestedPromises);
                            nestedContent = nestedResults.join('');
                        } else {
                            nestedContent = `
                                <div class="repeatable-element-gpt col-md-12 well repeatable-element row m-1 p-2">
                                    <div class="controls">
                                        <button type="button" class="close delete-element-gpt">
                                            <span aria-hidden="true">&times;</span>
                                        </button>
                                        <button type="button" class="close move-element-up">
                                            <svg viewBox="0 0 64 80"><path d="M46.8,36.7c-4.3-4.3-8.7-8.7-13-13c-1-1-2.6-1-3.5,0c-4.3,4.3-8.7,8.7-13,13c-2.3,2.3,1.3,5.8,3.5,3.5c4.3-4.3,8.7-8.7,13-13c-1.2,0-2.4,0-3.5,0c4.3,4.3,8.7,8.7,13,13C45.5,42.5,49,39,46.8,36.7L46.8,36.7z"/></svg>
                                        </button>
                                        <button type="button" class="close move-element-down">
                                            <svg viewBox="0 0 64 80"><path d="M17.2,30.3c4.3,4.3,8.7,8.7,13,13c1,1,2.6,1,3.5,0c4.3-4.3,8.7-8.7,13-13c2.3-2.3-1.3-5.8-3.5-3.5c-4.3,4.3-8.7,8.7-13,13c1.2,0,2.4,0,3.5,0c-4.3-4.3-8.7-8.7-13-13C18.5,24.5,15,28,17.2,30.3L17.2,30.3z"/></svg>
                                        </button>
                                    </div>
                                    ${await createRepeatableFieldsAsync(field.fields, fieldName + '[0]')}
                                </div>
                            `;
                        }

                        return `
                            <div class="form-group col-sm-12 fields field-${field.name}">
                                <label>${field.label}</label>
                                <div class="container-repeatable-elements">
                                    ${nestedContent}
                                </div>
                                <button type="button" class="btn btn-sm btn-primary add-child-repeatable-element" data-repeatable-fields='${JSON.stringify(field.fields)}' data-field-name="${fieldName}" data-parent-name="${baseName}" data-parent-index="${field.index || 0}">Add Item</button>
                            </div>
                        `;
                    }

                    return await makeAjaxAsync(fieldName, field);
                }

                async function createNestedRepeatableContent(fields, baseName, values) {
                    const fieldPromises = fields.map(f => {
                        const fieldWithValue = {
                            ...f,
                            value: values[f.name] ?? f.default ?? '',
                            default: values[f.name] ?? f.default ?? ''
                        };
                        return createFieldHtmlAsync(fieldWithValue, baseName, null);
                    });

                    const fieldHtmls = await Promise.all(fieldPromises);

                    return `
                        <div class="repeatable-element-gpt col-md-12 well repeatable-element row m-1 p-2">
                            <div class="controls">
                                <button type="button" class="close delete-element-gpt">
                                    <span aria-hidden="true">&times;</span>
                                </button>
                                <button type="button" class="close move-element-up">
                                    <svg viewBox="0 0 64 80"><path d="M46.8,36.7c-4.3-4.3-8.7-8.7-13-13c-1-1-2.6-1-3.5,0c-4.3,4.3-8.7,8.7-13,13c-2.3,2.3,1.3,5.8,3.5,3.5c4.3-4.3,8.7-8.7,13-13c-1.2,0-2.4,0-3.5,0c4.3,4.3,8.7,8.7,13,13C45.5,42.5,49,39,46.8,36.7L46.8,36.7z"/></svg>
                                </button>
                                <button type="button" class="close move-element-down">
                                    <svg viewBox="0 0 64 80"><path d="M17.2,30.3c4.3,4.3,8.7,8.7,13,13c1,1,2.6,1,3.5,0c4.3-4.3,8.7-8.7,13-13c2.3-2.3-1.3-5.8-3.5-3.5c-4.3,4.3-8.7,8.7-13,13c1.2,0,2.4,0,3.5,0c-4.3-4.3-8.7-8.7-13-13C18.5,24.5,15,28,17.2,30.3L17.2,30.3z"/></svg>
                                </button>
                            </div>
                            ${fieldHtmls.join('')}
                        </div>
                    `;
                }

                async function createRepeatableFieldsAsync(fields, prefix) {
                    const promises = fields.map(field => createFieldHtmlAsync({ ...field }, prefix));
                    const results = await Promise.all(promises);
                    return results.join('');
                }

                // Async AJAX with caching
                async function makeAjaxAsync(fieldName, field) {
                    const cacheKey = `${field.type}_${JSON.stringify(field.options || {})}_${JSON.stringify(field.attributes || {})}_${JSON.stringify(field.wrapper || {})}_${JSON.stringify(field.columns || {})}`;

                    // Cache the PROMISE rather than the resolved template. Every
                    // row asks for the same templates at the same time, so
                    // caching only the result meant each row fired its own
                    // request — hundreds at once on a long page. Enough of them
                    // failed that fields went missing from the form, and saving
                    // then wrote the row without them.
                    let pending = fieldTemplateCache.get(cacheKey);

                    if (!pending) {
                        // Wrapped so it behaves as a native promise — a jQuery
                        // deferred shared between many awaits is easy to get
                        // subtly wrong.
                        pending = Promise.resolve($.ajax({
                            url: FIELD_URL.replace('__TYPE__', encodeURIComponent(field.type)),
                            method: 'GET',
                            data: {
                                field: {
                                    name: '__FIELD_NAME__',
                                    label: '__FIELD_LABEL__',
                                    value: '',
                                    options: field.options || {},
                                    attributes: field.attributes || {},
                                    allows_null: field.allows_null || false,
                                    wrapper: field.wrapper || false,
                                    default: null,
                                    // Without these a table field falls back to a
                                    // single "Value" column.
                                    columns: field.columns || {},
                                    max: field.max ?? null,
                                    min: field.min ?? null,
                                    entity_singular: field.entity_singular ?? null,
                                }
                            }
                        })).then(response => response.html);

                        trace('fetching template: ' + field.type);
                        fieldTemplateCache.set(cacheKey, pending);
                    }

                    let template;

                    try {
                        template = await pending;
                    } catch (error) {
                        console.error('Error loading field HTML:', error);
                        fieldTemplateCache.delete(cacheKey);

                        // Keep the value in the form. A field with no input is
                        // absent from the submit, and saving would erase it.
                        const raw = field.value ?? field.default ?? '';
                        const kept = typeof raw === 'string' ? raw : JSON.stringify(raw);

                        return `
                            <div class="form-group col-sm-12 fields field-${field.name}">
                                <label>${field.label || field.name}</label>
                                <p class="text-danger small mb-1">Could not load this field. Its saved value is preserved — reload the page to edit it.</p>
                                <input type="hidden" name="${fieldName}" value="${escapeHtml(kept)}">
                            </div>
                        `;
                    }

                    // Replace all occurrences of placeholders (case-insensitive for label)
                    let result = template
                        .replace(/__FIELD_NAME__/g, fieldName)
                        .replace(/__FIELD_LABEL__/gi, field.label || '')
                        .replace(/__field_label__/g, field.label || '');

                    const value = field.value ?? field.default ?? '';

                    // Saved content goes in through replacer FUNCTIONS, never
                    // replacement strings: in a string, "$1", "$&" and "$20" are
                    // patterns, so "<p>From $20</p>" came back as "<p>From ".

                    // A table field keeps its rows in a hidden input that the
                    // blade renders as value="[]" when empty, so the generic
                    // value="" replacement below never matches it.
                    if (field.type === 'table') {
                        const rows = typeof value === 'string' ? value : JSON.stringify(value ?? []);

                        if (rows && rows !== '[]' && rows !== '""') {
                            result = result.replace(/value="\[\]"/, () => `value="${escapeHtml(rows)}"`);
                        }

                        return result;
                    }

                    // Same for browse_multiple: its hidden input is rendered as
                    // value="null", and the field reads its paths from there.
                    if (field.type === 'browse_multiple') {
                        const paths = typeof value === 'string' ? value : JSON.stringify(value ?? null);

                        if (paths) {
                            result = result.replace(/(<input type="hidden" data-marker="multipleBrowseInput"[^>]*?\bvalue=")[^"]*(")/,
                                (match, before, after) => before + escapeHtml(paths) + after);
                        }

                        return result;
                    }

                    // A checkbox's state lives in its hidden sibling input, which
                    // the template renders as value="0" (the empty value we send
                    // arrives as null), so the generic value="" replacement never
                    // matches it. bpFieldInitCheckbox then reads that 0 and
                    // unticks the box — and the next save writes 0 to the DB.
                    if (field.type === 'checkbox') {
                        const checked = value === true || value === 1 || value === '1' || value === 'on' || value === 'true';

                        result = result.replace(/(<input type="hidden"[^>]*?\bvalue=")[^"]*(")/, `$1${checked ? 1 : 0}$2`);

                        if (checked) {
                            result = result.replace(/type="checkbox"/, 'type="checkbox" checked');
                        }

                        return result;
                    }

                    if (value !== '') {
                        const escapedValue = escapeHtml(typeof value === 'string' ? value : JSON.stringify(value));

                        result = result.replace(/value=""/g, () => `value="${escapedValue}"`);
                        result = result.replace(/(<textarea[^>]*>)(<\/textarea>)/g, (match, open, close) => open + escapedValue + close);

                        if (field.type === 'select' || field.type === 'select2' || field.type === 'select_from_array' || field.type === 'select2_from_array') {
                            result = result.replace(/ selected="selected"/g, '');
                            result = result.replace(/ selected/g, '');
                            result = result.split(`value="${escapedValue}"`).join(`value="${escapedValue}" selected`);
                        }
                    }

                    return result;
                }

                // Escapes for attribute values as well as text. Serialising a
                // text node (the old textContent/innerHTML trick) leaves quotes
                // alone, so a title like 'We are "the best"' was cut off at the
                // first quote, and a table's JSON rows were lost entirely.
                function escapeHtml(text) {
                    return String(text)
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#39;');
                }

                // =====================================================
                // HELPER FUNCTIONS
                // =====================================================

                function getNextIndex(container) {
                    let lastIndex = -1;
                    const elements = container.querySelectorAll(':scope > .repeatable-element-gpt');

                    elements.forEach(function(element) {
                        const nameInput = element.querySelector('[name]');
                        if (!nameInput) return;

                        const nameAttr = nameInput.getAttribute('name');
                        const matches = nameAttr.match(/\[(\d+)\]/g);

                        if (matches) {
                            matches.forEach(function(match) {
                                const index = parseInt(match.match(/\d+/)[0]);
                                if (index > lastIndex) {
                                    lastIndex = index;
                                }
                            });
                        }
                    });

                    return lastIndex === -1 ? 0 : lastIndex + 1;
                }

                function getNextChildIndex(container) {
                    return container.querySelectorAll('.repeatable-element-gpt').length;
                }

                const afterScriptStart = debounce(function() {
                    const fieldsByTypes = window.BackpackRepeatableConfig.fieldsByTypes || {};
                    if (!Object.keys(fieldsByTypes).length) return;
                    const selects = $('.container-repeatable-elements-root select').filter(function () { return /\[type\]$/.test(this.name) && !this.hasAttribute('data-type-handler'); });

                    selects.each(function() {
                        const sel = $(this);
                        sel.attr('data-type-handler', 'true');

                        sel.on('change', function() {
                            const parentEl = $(this).parent().closest('.repeatable-element-gpt');
                            parentEl.find('.fields').hide();

                            const selectedType = this.value;
                            if (fieldsByTypes[selectedType]) {
                                $.each(fieldsByTypes[selectedType], function(index, value) {
                                    parentEl.find('.field-' + value).show();
                                });
                            }
                        });

                        const parentEl = sel.parent().closest('.repeatable-element-gpt');
                        parentEl.find('.fields').hide();

                        const selectedVal = sel.find(':selected').val();
                        if (fieldsByTypes[selectedVal]) {
                            $.each(fieldsByTypes[selectedVal], function(index, value) {
                                parentEl.find('.field-' + value).show();
                            });
                        }
                    });
                }, 100);

                // Initialize on DOM ready
                document.addEventListener('DOMContentLoaded', function() {
                    initializeRepeatable(document);
                }, { once: true });

                document.addEventListener('click', function (e) {
                    const upBtn = e.target.closest('.move-element-up');
                    const downBtn = e.target.closest('.move-element-down');

                    if (!upBtn && !downBtn) return;

                    const element = e.target.closest('.repeatable-element-gpt');
                    if (!element) return;

                    const container = element.closest('.container-repeatable-elements') ?? element.closest('.container-repeatable-elements-root');
                    if (!container) return;

                    if (upBtn) {
                        const prev = element.previousElementSibling;
                        if (prev && prev.classList.contains('repeatable-element-gpt')) {
                            destroyEditors(element);
                            destroyEditors(prev);
                            container.insertBefore(element, prev);
                            reinitEditors(element);
                            reinitEditors(prev);
                        }
                    }

                    if (downBtn) {
                        const next = element.nextElementSibling;
                        if (next && next.classList.contains('repeatable-element-gpt')) {
                            destroyEditors(element);
                            destroyEditors(next);
                            container.insertBefore(next, element);
                            reinitEditors(element);
                            reinitEditors(next);
                        }
                    }

                    updateButtonsState(container);
                });

                // Respect max_rows: once the limit is reached, the add button goes away.
                function updateAddButtonState(container) {
                    if (!container) return;

                    const button = container.nextElementSibling;
                    if (!button || !button.classList.contains('add-repeatable-element')) return;

                    const maxRows = parseInt(button.getAttribute('data-max-rows'), 10);
                    if (!maxRows) return;

                    const count = container.querySelectorAll(':scope > .repeatable-element-gpt').length;
                    button.classList.toggle('d-none', count >= maxRows);
                }

                function updateButtonsState(container) {
                    if (!container) return;

                    // Direct children only - a nested block must not disable its parent's buttons
                    const elements = container.querySelectorAll(':scope > .repeatable-element-gpt');

                    elements.forEach((el, index) => {
                        const upBtn = el.querySelector(':scope > .controls .move-element-up');
                        const downBtn = el.querySelector(':scope > .controls .move-element-down');

                        if (upBtn) {
                            upBtn.disabled = index === 0;
                        }

                        if (downBtn) {
                            downBtn.disabled = index === elements.length - 1;
                        }
                    });
                }

                function destroyEditors(element) {
                    // TinyMCE
                    element.querySelectorAll('textarea.tinymce, textarea[data-init-function*="tinymce"]').forEach(el => {
                        const editor = window.tinymce?.get(el.id);
                        if (editor) {
                            el.value = editor.getContent(); // save content back
                            editor.remove();
                        }
                    });

                    // Summernote
                    $(element).find('.summernote, [data-init-function*="summernote"]').each(function() {
                        if ($(this).hasClass('summernote-initialized') || $(this).next('.note-editor').length) {
                            $(this).summernote('destroy');
                        }
                    });

                    // CKEditor (if used)
                    element.querySelectorAll('[data-init-function*="ckeditor"]').forEach(el => {
                        const instance = window.CKEDITOR?.instances[el.id];
                        if (instance) {
                            el.value = instance.getData();
                            instance.destroy();
                        }
                    });
                }

                function reinitEditors(element) {
                    // Re-trigger Backpack's init functions for editor fields
                    $(element).find('[data-init-function]').each(function() {
                        const $el = $(this);
                        const initFunction = $el.data('init-function');

                        // Only reinit editor-type fields
                        const editorInits = ['bpFieldInitTinymceElement', 'bpFieldInitSummernoteElement',
                                            'bpFieldInitCkeditorElement', 'bpFieldInitEasyMdeElement'];

                        if (editorInits.includes(initFunction) || initFunction?.toLowerCase().includes('editor')
                            || initFunction?.toLowerCase().includes('mce') || initFunction?.toLowerCase().includes('summernote')) {

                            // Remove initialized flag so it can reinit
                            $el.removeAttr('data-bp-field-initialized');

                            if (typeof window[initFunction] === 'function') {
                                try {
                                    window[initFunction]($el);
                                } catch (e) {
                                    console.warn('Error reinitializing ' + initFunction + ':', e);
                                }
                            }
                        }
                    });
                }

                document.querySelectorAll('.container-repeatable-elements-root')
                    .forEach(function (container) {
                        updateButtonsState(container);
                        updateAddButtonState(container);
                    });

            })();
