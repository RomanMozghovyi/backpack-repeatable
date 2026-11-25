<?php
namespace Uiarts\BackpackRepeatable\Tests;

use Orchestra\Testbench\TestCase;
use Uiarts\BackpackRepeatable\AddonServiceProvider;

class FieldRendererTest extends TestCase
{
    protected function getPackageProviders($app)
    {
        return [\Backpack\CRUD\BackpackServiceProvider::class, AddonServiceProvider::class];
    }

    public function test_route_uses_configured_admin_prefix_and_middleware(): void
    {
        $route = app('router')->getRoutes()->getByName('backpack-repeatable.field');
        $this->assertNotNull($route);
        $this->assertContains(config('backpack.base.middleware_key', 'admin'), $route->middleware());
    }

    public function test_unknown_field_is_rejected(): void
    {
        $this->withoutMiddleware()->getJson(route('backpack-repeatable.field', ['type' => 'unknown']))->assertNotFound();
    }

    public function test_field_name_is_required(): void
    {
        $this->withoutMiddleware()->getJson(route('backpack-repeatable.field', ['type' => 'text']))->assertUnprocessable();
    }

    public function test_text_renders_without_a_page_model(): void
    {
        $this->withoutMiddleware()->getJson(route('backpack-repeatable.field', ['type' => 'text', 'field' => ['name' => 'blocks[0][title]', 'value' => 'Example']]))
            ->assertOk()->assertJsonStructure(['html']);
    }
}
