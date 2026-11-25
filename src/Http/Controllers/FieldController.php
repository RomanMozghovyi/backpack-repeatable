<?php
namespace Uiarts\BackpackRepeatable\Http\Controllers;

use Backpack\CRUD\app\Library\CrudPanel\CrudPanel;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\View;

class FieldController extends Controller
{
    public function __invoke(Request $request, string $type)
    {
        abort_unless(in_array($type, config('backpack-repeatable.allowed_fields', []), true), 404);
        abort_unless(View::exists("crud::fields.{$type}"), 404);
        $validated = $request->validate(['field' => ['required', 'array'], 'field.name' => ['required', 'string', 'max:1000']]);
        $field = $validated['field'];
        $field['type'] = $type;
        $field['label'] = $field['label'] ?? ucfirst($field['name']);
        $field['allows_null'] = filter_var($field['allows_null'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $field['wrapper'] = is_array($field['wrapper'] ?? null) ? $field['wrapper'] : [];
        return response()->json(['html' => view("crud::fields.{$type}", ['field' => $field, 'crud' => new CrudPanel()])->render()]);
    }
}
