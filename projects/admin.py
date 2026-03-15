"""
Admin configuration for the projects app.

Registers Project, Site, Status, MapComponent, and ComponentFolder
models with the Django admin.
"""
from django.contrib import admin
from .models import Project, Site, Status, MapComponent, ComponentFolder


@admin.register(Status)
class StatusAdmin(admin.ModelAdmin):
    """Admin configuration for Status model."""

    list_display = ['emoji', 'name', 'code', 'is_archived', 'display_order']
    list_filter = ['is_archived', 'includes_in_carbon']
    ordering = ['display_order']


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    """Admin configuration for Project model."""

    list_display = ['name', 'status', 'project_type', 'created_at']
    list_filter = ['status', 'project_type', 'climate', 'soil_type']
    search_fields = ['name', 'description']
    ordering = ['-created_at']


class MapComponentInline(admin.TabularInline):
    model = MapComponent
    extra = 0
    fields = ['name', 'geometry_type', 'data_type', 'folder', 'visible', 'locked', 'z_order']
    readonly_fields = []


class ComponentFolderInline(admin.TabularInline):
    model = ComponentFolder
    extra = 0
    fields = ['name', 'parent', 'visible', 'locked', 'z_order']


@admin.register(Site)
class SiteAdmin(admin.ModelAdmin):
    """Admin configuration for Site model."""

    list_display = ['name', 'project', 'created_at']
    list_filter = ['project']
    search_fields = ['name', 'description']
    ordering = ['-created_at']
    inlines = [ComponentFolderInline, MapComponentInline]


@admin.register(MapComponent)
class MapComponentAdmin(admin.ModelAdmin):
    """Admin configuration for MapComponent model."""

    list_display = ['name', 'site', 'geometry_type', 'data_type', 'folder', 'visible', 'locked', 'z_order']
    list_filter = ['geometry_type', 'data_type', 'visible', 'locked']
    search_fields = ['name', 'annotation_title', 'annotation_description']
    ordering = ['site', 'z_order', 'created_at']
    raw_id_fields = ['site', 'folder']


@admin.register(ComponentFolder)
class ComponentFolderAdmin(admin.ModelAdmin):
    """Admin configuration for ComponentFolder model."""

    list_display = ['name', 'site', 'parent', 'visible', 'locked', 'z_order']
    list_filter = ['visible', 'locked']
    search_fields = ['name']
    ordering = ['site', 'z_order', 'created_at']
    raw_id_fields = ['site', 'parent']
