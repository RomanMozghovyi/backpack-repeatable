<!-- repeatable.blade.php -->
@include('crud::fields.inc.wrapper_start')
@php

    if(isset($field['value']) && is_string($field['value'])){
        $field['value'] = json_decode($field['value'], true);
    }

    // Ensure the value is a properly indexed array (not an object with numeric keys).
    // Keys are NOT row positions: the move up/down buttons reorder rows in the DOM
    // without renaming inputs, so a moved row keeps its original index and the
    // stored order (e.g. {"6":…,"0":…,"1":…}) is the order the editor chose.
    // Never ksort here — that silently reverts every reorder on reload.
    if (isset($field['value']) && is_array($field['value'])) {
        $field['value'] = array_values($field['value']);
    }

    // Count total elements for lazy loading decision
    $totalElements = 0;
    if (old($field['name'])) {
        $totalElements = count(old($field['name']));
    } elseif (isset($field['value']) && $field['value']) {
        $totalElements = count($field['value']);
    }

    // Lazy loading rebuilds rows in JavaScript, fetching each field's real
    // blade from the package field endpoint. See makeAjaxAsync: template requests
    // are de-duplicated by promise, table fields get their columns, and a failed
    // request keeps the value in a hidden input rather than dropping the field —
    // without that last part, saving a page erased anything that failed to load.
    $useLazyLoad = $totalElements > config('backpack-repeatable.lazy_threshold', 5);

    // Collect all unique field types for preloading
    $preloadFieldTypes = [];
    $collectAllFieldTypes = function ($fields) use (&$collectAllFieldTypes, &$preloadFieldTypes) {
        foreach ($fields as $subfield) {
            $preloadFieldTypes[$subfield['type']] = $subfield;
            if ($subfield['type'] === 'repeatable' && isset($subfield['fields'])) {
                $collectAllFieldTypes($subfield['fields']);
            }
        }
    };
    $collectAllFieldTypes($field['fields']);

    // Remove 'repeatable' as it's this field itself
    unset($preloadFieldTypes['repeatable']);

@endphp

<label>{!! $field['label'] !!}</label>
<div>
    <div class="{{ !empty($field['child']) ? 'container-repeatable-elements' : 'container-repeatable-elements-root' }}"
         @if($useLazyLoad)
             data-lazy-load="true"
             data-field-name="{{ $field['name'] }}"
             data-field-config="{{ json_encode($field['fields']) }}"
             data-field-values="{{ json_encode(array_values(old($field['name'], $field['value'] ?? []))) }}"
         @endif
    >
        @if($useLazyLoad)
            {{-- Lazy load placeholder --}}
            <div class="lazy-load-placeholder" style="padding: 20px; text-align: center; background: #f8f9fa; border-radius: 4px; margin: 10px 0;">
                <div class="spinner-border spinner-border-sm text-primary" role="status">
                    <span class="sr-only">Loading...</span>
                </div>
                <span style="margin-left: 10px;">Loading {{ $totalElements }} items...</span>
                <div class="progress mt-2" style="height: 4px;">
                    <div class="progress-bar" role="progressbar" style="width: 0%"></div>
                </div>
            </div>
        @else
            {{-- Normal render for small datasets --}}
            @if (old($field['name']))
                @foreach (old($field['name']) as $key => $repeatableElement)
                    @include('uiarts.backpack-repeatable::fields.repeatable_element', [
                        'repeatable_fields' => $field['fields'],
                        'prefix' => $field['name'] . '[' . $key . ']',
                        'field_value' => old($field['name'])[$key]
                    ])
                @endforeach
            @elseif (isset($field['value']) && $field['value'])
                @foreach ($field['value'] as $key => $repeatableElement)
                    @include('uiarts.backpack-repeatable::fields.repeatable_element', [
                        'repeatable_fields' => $field['fields'],
                        'prefix' => $field['name'] . '[' . $key . ']',
                        'field_value' => $field['value'][$key]
                    ])
                @endforeach
            @elseif (isset($field['fields']) && is_array($field['fields']))
                @include('uiarts.backpack-repeatable::fields.repeatable_element', [
                        'repeatable_fields' => $field['fields'],
                        'prefix' => $field['name'] . '[' . 0 . ']',
                        'field_value' => null,
                    ])
            @endif
        @endif
    </div>
    <button type="button" class="btn btn-sm btn-primary add-repeatable-element" data-repeatable-fields="{{ json_encode($field['fields']) }}" data-field-name="{{ $field['name'] }}" @if(!empty($field['max_rows'])) data-max-rows="{{ $field['max_rows'] }}" @endif>Add Item</button>
    @if (isset($field['hint']))
        <p class="help-block">{!! $field['hint'] !!}</p>
    @endif
</div>

@include('crud::fields.inc.wrapper_end')

{{--
    SERVER-SIDE PRELOADING OF FIELD SCRIPTS
    This renders each field type once in a hidden container so their init scripts are loaded.
    This is necessary because AJAX-loaded fields don't include the script registration.
--}}
<div id="bp-field-scripts-preloader" style="display:none !important; visibility:hidden !important; position:absolute !important; left:-9999px !important; height:0 !important; overflow:hidden !important;">
    @foreach($preloadFieldTypes as $fieldType => $fieldConfig)
        @php
            $preloadField = [
                'name' => '__preload_' . $fieldType . '__',
                'label' => $fieldConfig['label'] ?? ucfirst(str_replace('_', ' ', $fieldType)),
                'type' => $fieldType,
                'value' => '',
                'options' => $fieldConfig['options'] ?? ['_placeholder' => 'placeholder'],
                'attributes' => $fieldConfig['attributes'] ?? [],
                'allows_null' => $fieldConfig['allows_null'] ?? true,
                'wrapper' => ['class' => 'form-group col-sm-12 d-none'],
                'columns' => $fieldConfig['columns'] ?? ['col1' => 'Column 1'],
                'fields' => $fieldConfig['fields'] ?? [],
                'hint' => $fieldConfig['hint'] ?? null,
            ];
        @endphp
        @include('crud::fields.' . $fieldType, ['field' => $preloadField])
    @endforeach
</div>

@push('crud_fields_styles')
    <link rel="stylesheet" href="{{ asset('vendor/uiarts/backpack-repeatable/repeatable.css') }}">

@endpush

@once
    @push('crud_fields_scripts')

        <script>
            window.BackpackRepeatableConfig = {
                debug: @json((bool) config('app.debug')),
                fieldsByTypes: @json(config('backpack-repeatable.fields_by_type', [])),
                fieldUrl: @json(route('backpack-repeatable.field', ['type' => '__TYPE__']))
            };
        </script>
        <script src="{{ asset('vendor/uiarts/backpack-repeatable/repeatable.js') }}"></script>

    @endpush
@endonce
