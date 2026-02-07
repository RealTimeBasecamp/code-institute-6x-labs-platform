"""
Admin configuration for the planting app.

Registers PlantStatus and Species models with the Django admin.
"""
from django.contrib import admin
from .models import PlantStatus, Species, EditorPreferences


@admin.register(PlantStatus)
class PlantStatusAdmin(admin.ModelAdmin):
    """Admin configuration for PlantStatus model."""

    list_display = ['emoji', 'name', 'code', 'category', 'is_dead', 'display_order']
    list_filter = ['is_dead', 'category']
    ordering = ['display_order']


@admin.register(Species)
class SpeciesAdmin(admin.ModelAdmin):
    """Admin configuration for Species model."""

    list_display = ['cultivar', 'common_name', 'scientific_name', 'category']
    list_filter = ['category']
    search_fields = ['cultivar', 'common_name', 'scientific_name']


@admin.register(EditorPreferences)
class EditorPreferencesAdmin(admin.ModelAdmin):
    """Admin configuration for EditorPreferences model."""

    list_display = ['user', 'ui_scale', 'auto_topdown_drawing']
    search_fields = ['user__username', 'user__email']
    raw_id_fields = ['user']
