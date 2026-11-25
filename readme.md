# Backpack Repeatable

Nested repeatable fields for Backpack 4, 5 and 6. The package requires PHP 7.4+; the installed Laravel and Backpack versions determine their own additional requirements.

## Local installation

Add a Composer path repository pointing to this package, with `options.versions` set to `{"uiarts/backpack-repeatable":"0.1.0"}`, then require `uiarts/backpack-repeatable:^0.1`.
Laravel and Backpack versions must also be compatible with each other; Composer enforces their upstream requirements.

Publish assets after installation and each package update:

```sh
php artisan vendor:publish --tag=backpack-repeatable-assets --force
php artisan vendor:publish --tag=backpack-repeatable-config
```

```php
CRUD::addField([
    'name' => 'blocks',
    'type' => 'repeatable_gpt',
    'label' => 'Blocks',
    'fields' => [
        ['name' => 'title', 'type' => 'text'],
        ['name' => 'items', 'type' => 'repeatable', 'fields' => [
            ['name' => 'text', 'type' => 'textarea'],
        ]],
    ],
    'max_rows' => 20,
]);
```

Use an array cast for the model attribute. Stored row order is preserved; input names are normalized before submit. More than five rows load asynchronously. Saving is blocked while lazy loading is incomplete. Failed field requests retain the current value in a hidden input.

`config/backpack-repeatable.php` controls `lazy_threshold`, `allowed_fields`, and optional `fields_by_type` (a map of block type to visible subfield names for a `type` selector). The application supplies this map; the package does not depend on application helpers.

AJAX rendering uses the configured Backpack route prefix and admin middleware. Only allowlisted field types are rendered. Add custom/editor types explicitly after verifying their assets and initialization. Relationship fields requiring a model or CRUD entity are not supported by the standalone renderer.

## Validation

Run `composer install` and `composer test` inside this package. Integration tests use Orchestra Testbench; verify nested editing, reordering, validation errors, multiple repeatables, and editor lifecycle in Backpack 4, 5 and 6 browser hosts before release. This is an initial extraction, not a verified production release.
