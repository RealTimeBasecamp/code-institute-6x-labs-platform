"""
Planting app configuration.

This app contains domain-specific models for plant species and status tracking.
"""
from django.apps import AppConfig


class PlantingConfig(AppConfig):
    """Configuration for the planting app."""

    default_auto_field = 'django.db.models.BigAutoField'
    name = 'planting'
    verbose_name = 'Planting & Species'
