<?php
namespace Uiarts\BackpackRepeatable;

use Backpack\CRUD\ViewNamespaces;
use Illuminate\Support\ServiceProvider;

class AddonServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/backpack-repeatable.php', 'backpack-repeatable');
    }

    public function boot(): void
    {
        $this->loadViewsFrom(__DIR__.'/../resources/views', 'uiarts.backpack-repeatable');
        $this->callAfterResolving('view', function ($view) {
            if (class_exists(ViewNamespaces::class)) {
                ViewNamespaces::addFor('fields', 'uiarts.backpack-repeatable::fields');
            } else {
                // Older Backpack versions resolve custom fields through crud::fields.
                $view->prependNamespace('crud', __DIR__.'/../resources/views');
            }
        });
        $this->loadRoutesFrom(__DIR__.'/../routes/backpack-repeatable.php');
        if ($this->app->runningInConsole()) {
            $this->publishes([__DIR__.'/../config/backpack-repeatable.php' => config_path('backpack-repeatable.php')], 'backpack-repeatable-config');
            $this->publishes([__DIR__.'/../resources/assets' => public_path('vendor/uiarts/backpack-repeatable')], 'backpack-repeatable-assets');
        }
    }
}
