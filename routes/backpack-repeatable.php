<?php
use Illuminate\Support\Facades\Route;
use Uiarts\BackpackRepeatable\Http\Controllers\FieldController;
Route::group([
    'prefix' => config('backpack.base.route_prefix', 'admin'),
    'middleware' => array_merge((array) config('backpack.base.web_middleware', 'web'), (array) config('backpack.base.middleware_key', 'admin')),
], function () {
    Route::get('backpack-repeatable/field/{type}', FieldController::class)
        ->where('type', '[a-zA-Z0-9_]+')->name('backpack-repeatable.field');
});
