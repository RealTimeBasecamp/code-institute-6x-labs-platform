from django.apps import AppConfig


class SpeciesConfig(AppConfig):
    """
    Configuration for the Species app.

    Manages species data, seed batches, and fungi batches.
    """
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'species'
