"""
Wizard registry for centralized wizard configuration.

Allows registering wizard classes and retrieving them by name
for the generic wizard API endpoints.

This pattern enables:
- Loose coupling between URL routes and wizard implementations
- Easy discovery of available wizards
- Consistent wizard naming across frontend and backend
"""

# Global registry storing wizard_name -> wizard_class mappings
_wizard_registry = {}


def register_wizard(name, wizard_class):
    """
    Register a wizard class with a unique name.

    Called during app initialization (typically in wizards.py files)
    to make wizards available to the API endpoints.

    Args:
        name: Unique string identifier for the wizard (e.g., 'user_profile')
        wizard_class: The wizard view class (subclass of BaseWizardView)

    Raises:
        ValueError: If a wizard with the same name is already registered

    Example:
        from core.wizards import register_wizard

        class MyWizardView(BaseWizardView):
            wizard_name = 'my_wizard'
            ...

        register_wizard('my_wizard', MyWizardView)
    """
    if name in _wizard_registry:
        raise ValueError(
            f"Wizard '{name}' is already registered. "
            f"Each wizard must have a unique name."
        )
    _wizard_registry[name] = wizard_class


def get_wizard(name):
    """
    Retrieve a wizard class by name.

    Used by the API endpoints to instantiate the appropriate wizard
    based on the URL parameter.

    Args:
        name: Wizard identifier string

    Returns:
        Wizard class if found, None otherwise
    """
    return _wizard_registry.get(name)


def wizard_exists(name):
    """
    Check if a wizard is registered.

    Args:
        name: Wizard identifier string

    Returns:
        bool: True if wizard is registered, False otherwise
    """
    return name in _wizard_registry


def get_all_wizards():
    """
    Get all registered wizards.

    Useful for debugging or admin interfaces that need to list
    available wizards.

    Returns:
        dict: Copy of the wizard registry (name -> class mappings)
    """
    return _wizard_registry.copy()


def clear_registry():
    """
    Clear all registered wizards.

    Primarily used for testing to reset state between tests.
    """
    global _wizard_registry
    _wizard_registry = {}
