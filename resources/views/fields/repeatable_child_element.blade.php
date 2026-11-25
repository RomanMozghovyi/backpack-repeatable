<!-- repeatable_element.blade.php -->
<div class="{{$field['wrapper']['class'] ?? 'form-group col-md-12 fields field-'.$field['name']}}">
        @php
            $repeatable_index = 0;
            $result = [];
            $fields = $field['fields'] ?? [];

            $values = [];
            if(is_string($field['value'])){
                $field['value'] = json_decode($field['value'], true);
            }
            if(is_array($field['value'])){
                $values = $field['value'];
            }
        @endphp

        @if(is_null($field['value']))
            @php
                $group = [];
                foreach ($field['fields'] as $f) {
                    $fieldCopy = $f;
                    $fieldCopy['default'] = $f['default'] ?? null;
                    $group[] = $fieldCopy;
                }
                $result[] = $group;
            @endphp
        @else
            @php
                foreach ($values as $index => $itemValues) {
                    foreach ($fields as $f) {
                        $fieldCopy = $f;
                        $fieldCopy['default'] = $itemValues[$f['name']] ?? ($f['default'] ?? null);
                        $group[] = $fieldCopy;
                    }
                    $result[] = $group;
                    unset($group);
                }
            @endphp
        @endif

    @foreach ($result as $key => $value)
        <div class="repeatable-element-gpt col-md-12 well repeatable-element row m-1 p-2">
            <div class="controls">
                <button type="button" class="close delete-element-gpt"><span aria-hidden="true">×</span></button>
            </div>
            @foreach ($value as $subfield)
                @php
                    $realname = $subfield['name'];
                    $subfield['label'] = $subfield['label'] ?? ucfirst(str_replace('_', ' ', $realname));
                    $subfield['name'] = $field['name'] . '['. $key .'][' . $realname . ']';
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
    @endforeach
    <button type="button" class="btn btn-sm btn-primary add-child-repeatable-element" data-repeatable-fields="{{ json_encode($field['fields']) }}" data-field-name="{{ $field['name'] }}">Add Item</button>
</div>

