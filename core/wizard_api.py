"""
Wizard API dispatcher for routing requests to registered wizards.

This module provides the entry point for all wizard API requests,
looking up the appropriate wizard from the registry and dispatching
the request to it.

Data comes from: URL parameters (wizard_name, action, step)
Data returned to: JSON responses via the wizard view handlers
"""
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_POST
from django.contrib.auth.decorators import login_required

from .wizards import get_wizard, wizard_exists


@login_required
@csrf_protect
@require_POST
def wizard_dispatch(request, wizard_name, action='start', step=None):
    """
    Dispatch wizard API requests to the appropriate wizard handler.

    Looks up the wizard by name from the registry and instantiates
    it to handle the request.

    Args:
        request: HTTP request object
        wizard_name: Unique identifier for the wizard (from URL)
        action: The action to perform (start, step, validate, submit, cancel)
        step: Step index for step action (optional)

    Returns:
        JsonResponse: Response from the wizard handler

    URL patterns:
        POST /api/wizard/<wizard_name>/start/
        POST /api/wizard/<wizard_name>/step/<step>/
        POST /api/wizard/<wizard_name>/validate/
        POST /api/wizard/<wizard_name>/submit/
        POST /api/wizard/<wizard_name>/cancel/
    """
    # Check if wizard exists
    if not wizard_exists(wizard_name):
        return JsonResponse({
            'success': False,
            'error': f"Wizard '{wizard_name}' not found"
        }, status=404)

    # Get wizard class and instantiate
    wizard_class = get_wizard(wizard_name)
    wizard_view = wizard_class.as_view()

    # Build kwargs for dispatch
    kwargs = {'action': action}
    if step is not None:
        kwargs['step'] = step

    # Dispatch to wizard view
    return wizard_view(request, **kwargs)
