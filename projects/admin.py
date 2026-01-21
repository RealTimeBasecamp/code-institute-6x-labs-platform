"""
Admin configuration for the projects app.

Registers Project and Status models with the Django admin.
"""
from django.contrib import admin
from .models import Project, Site, Status


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

@admin.register(Site)
class SiteAdmin(admin.ModelAdmin):
    """Admin configuration for Site model."""

    list_display = ['name', 'project', 'created_at']
    list_filter = ['project']
    search_fields = ['name', 'description']
    ordering = ['-created_at']
