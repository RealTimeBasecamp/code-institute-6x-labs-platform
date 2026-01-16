"""
Projects app configuration.

Handles app initialization and wizard registration.
"""
from django.apps import AppConfig


class ProjectsConfig(AppConfig):
    """
    Configuration for the projects application.

    Registers the project creation wizard on app ready.
    """
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'projects'

    def ready(self):
        """
        Import forms module to trigger wizard registration.

        This runs when the app is fully loaded and ensures the
        ProjectWizard is registered with the wizard registry.
        """
        # Import forms to register the wizard
        from . import forms  # noqa: F401
