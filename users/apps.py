"""
Users app configuration.

Handles app initialization and wizard registration.
"""
from django.apps import AppConfig


class UsersConfig(AppConfig):
    """
    Configuration for the users application.

    Registers the user profile wizard on app ready.
    """
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'users'

    def ready(self):
        """
        Import forms module to trigger wizard registration.

        This runs when the app is fully loaded and ensures the
        UserWizard is registered with the wizard registry.
        """
        # Import forms to register the wizard
        from . import forms  # noqa: F401
