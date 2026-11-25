<!-- repeatable_element.blade.php -->
<div class="repeatable-element-gpt col-md-12 well repeatable-element row m-1 p-2">
    <div class="controls">
        <button type="button" class="close delete-element-gpt"><span aria-hidden="true">×</span></button>
        <button type="button" class="close move-element-up">
            <svg viewBox="0 0 64 80"><path d="M46.8,36.7c-4.3-4.3-8.7-8.7-13-13c-1-1-2.6-1-3.5,0c-4.3,4.3-8.7,8.7-13,13c-2.3,2.3,1.3,5.8,3.5,3.5c4.3-4.3,8.7-8.7,13-13c-1.2,0-2.4,0-3.5,0c4.3,4.3,8.7,8.7,13,13C45.5,42.5,49,39,46.8,36.7L46.8,36.7z"/></svg>
        </button>
        <button type="button" class="close move-element-down">
            <svg viewBox="0 0 64 80"><path d="M17.2,30.3c4.3,4.3,8.7,8.7,13,13c1,1,2.6,1,3.5,0c4.3-4.3,8.7-8.7,13-13c2.3-2.3-1.3-5.8-3.5-3.5c-4.3,4.3-8.7,8.7-13,13c1.2,0,2.4,0,3.5,0c-4.3-4.3-8.7-8.7-13-13C18.5,24.5,15,28,17.2,30.3L17.2,30.3z"/></svg>
        </button>
    </div>

    @php
        $field_value = $field_value ?? null;
    @endphp

    @foreach ($repeatable_fields as $subfield)
        @php
            $realname = $subfield['name'];
            $subfield['label'] = $subfield['label'] ?? ucfirst(str_replace('_', ' ', $realname));
            $subfield['name'] = $prefix . '[' . $subfield['name'] . ']';
            $subfield['value'] = isset($field_value[$realname]) ? $field_value[$realname] : null;
        @endphp

        @if ($subfield['type'] === 'repeatable')
            @php
                $subfield['child'] = true;
            @endphp
            @include('uiarts.backpack-repeatable::fields.repeatable_child_element', [
                'field' => $subfield,
                'field_value' => $subfield['value'],
            ])
        @else
            @include('crud::fields.' . $subfield['type'], [
                'field' => $subfield,
                'field_value' => $subfield['value']
            ])
        @endif

    @endforeach
</div>
