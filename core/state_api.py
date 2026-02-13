"""
State Management API for handling publish operations.

This module provides the endpoint for publishing state changes
from the client-side StateManager to the database.

Data comes from: JSON payload with serialized actions from StateManager
Data returned to: JSON response with success/error status
"""
import json
import logging

from django.apps import apps
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_POST

logger = logging.getLogger(__name__)


# Action type handlers registry
ACTION_HANDLERS = {}


def register_action_handler(action_type, handler):
    """
    Register a handler function for an action type.

    Args:
        action_type: String identifier (e.g., 'site:add')
        handler: Function that takes (action, user) and returns result dict
    """
    ACTION_HANDLERS[action_type] = handler


def get_action_handler(action_type):
    """
    Get the handler for an action type.

    Falls back to generic handlers based on action suffix:
    - ':add' or ':create' -> generic_create_handler
    - ':update' or ':edit' -> generic_update_handler
    - ':delete' or ':remove' -> generic_delete_handler

    Args:
        action_type: String identifier

    Returns:
        Handler function or None
    """
    # Check for exact match first
    if action_type in ACTION_HANDLERS:
        return ACTION_HANDLERS[action_type]

    # Fall back to generic handlers based on suffix
    if action_type.endswith(':add') or action_type.endswith(':create'):
        return generic_create_handler
    elif action_type.endswith(':update') or action_type.endswith(':edit'):
        return generic_update_handler
    elif action_type.endswith(':delete') or action_type.endswith(':remove'):
        return generic_delete_handler

    return None


def _user_has_permission_for_instance(user, instance):
    """
    Determine whether `user` may modify/delete `instance`.

    Rules:
    - staff or superuser: allowed
    - Project instance: allowed if `created_by == user`
    - Instances with a `project` relation: allowed if `project.created_by == user`
    - Instances with `created_by`: allowed if `created_by == user`
    Returns True/False.
    """
    if user.is_staff or user.is_superuser:
        return True

    try:
        # Direct project instance
        if hasattr(instance, 'created_by') and getattr(instance, 'created_by') is not None:
            return getattr(instance, 'created_by') == user

        # Related via `project` FK
        if hasattr(instance, 'project') and getattr(instance, 'project') is not None:
            proj = getattr(instance, 'project')
            if hasattr(proj, 'created_by'):
                return proj.created_by == user

        # Some models may be nested (e.g., site -> project)
        if hasattr(instance, 'site') and getattr(instance, 'site') is not None:
            site = getattr(instance, 'site')
            if hasattr(site, 'project') and getattr(site, 'project') is not None:
                proj = getattr(site, 'project')
                if hasattr(proj, 'created_by'):
                    return proj.created_by == user
    except Exception:
        # Fail closed: deny permission on unexpected errors
        return False

    return False


def generic_create_handler(action, user):
    """
    Generic handler for create/add actions.

    Expects action.entityRef to contain:
    - app_label: Django app name
    - model: Model class name
    - defaults: Dict of field values for creation

    Args:
        action: Action dict with executeData and entityRef
        user: User performing the action

    Returns:
        Dict with status and created object info
    """
    entity_ref = action.get('entityRef', {})
    execute_data = action.get('executeData', {})

    app_label = entity_ref.get('app_label')
    model_name = entity_ref.get('model')

    if not app_label or not model_name:
        return {
            'status': 'error',
            'error': 'Missing app_label or model in entityRef'
        }

    try:
        model_class = apps.get_model(app_label, model_name)
    except LookupError:
        return {
            'status': 'error',
            'error': f'Model {app_label}.{model_name} not found'
        }

    # Build creation kwargs from executeData
    create_kwargs = {}
    for key, value in execute_data.items():
        # Skip internal keys
        if key.startswith('_'):
            continue
        create_kwargs[key] = value

    # Add created_by if model has it and user is authenticated
    if hasattr(model_class, 'created_by') and user.is_authenticated:
        create_kwargs['created_by'] = user

    try:
        instance = model_class.objects.create(**create_kwargs)
        return {
            'status': 'created',
            'model': model_name,
            'pk': instance.pk
        }
    except Exception as e:
        logger.error(f'Failed to create {model_name}: {e}')
        return {
            'status': 'error',
            'error': str(e)
        }


def generic_update_handler(action, user):
    """
    Generic handler for update/edit actions.

    Expects action.entityRef to contain:
    - app_label: Django app name
    - model: Model class name
    - pk: Primary key of object to update
    - field: (optional) Specific field to update

    Args:
        action: Action dict with executeData and entityRef
        user: User performing the action

    Returns:
        Dict with status and updated object info
    """
    entity_ref = action.get('entityRef', {})
    execute_data = action.get('executeData', {})

    app_label = entity_ref.get('app_label')
    model_name = entity_ref.get('model')
    pk = entity_ref.get('pk')

    if not app_label or not model_name or not pk:
        return {
            'status': 'error',
            'error': 'Missing app_label, model, or pk in entityRef'
        }

    try:
        model_class = apps.get_model(app_label, model_name)
    except LookupError:
        return {
            'status': 'error',
            'error': f'Model {app_label}.{model_name} not found'
        }

    try:
        instance = model_class.objects.get(pk=pk)
    except model_class.DoesNotExist:
        return {
            'status': 'error',
            'error': f'{model_name} with pk={pk} not found'
        }

    # Permission check: only allow owner/staff/superuser to update
    if not _user_has_permission_for_instance(user, instance):
        return {
            'status': 'error',
            'error': 'Permission denied'
        }
    # Update fields from executeData
    update_fields = []
    for key, value in execute_data.items():
        if key.startswith('_'):
            continue
        if hasattr(instance, key):
            setattr(instance, key, value)
            update_fields.append(key)

    if update_fields:
        try:
            instance.save(update_fields=update_fields)
            return {
                'status': 'updated',
                'model': model_name,
                'pk': pk,
                'fields': update_fields
            }
        except Exception as e:
            logger.error(f'Failed to update {model_name} pk={pk}: {e}')
            return {
                'status': 'error',
                'error': str(e)
            }

    return {
        'status': 'no_change',
        'model': model_name,
        'pk': pk
    }


def generic_delete_handler(action, user):
    """
    Generic handler for delete/remove actions.

    Expects action.entityRef to contain:
    - app_label: Django app name
    - model: Model class name
    - pk: Primary key of object to delete

    Args:
        action: Action dict with undoData and entityRef
        user: User performing the action

    Returns:
        Dict with status and deleted object info
    """
    entity_ref = action.get('entityRef', {})

    app_label = entity_ref.get('app_label')
    model_name = entity_ref.get('model')
    pk = entity_ref.get('pk')

    if not app_label or not model_name or not pk:
        return {
            'status': 'error',
            'error': 'Missing app_label, model, or pk in entityRef'
        }

    try:
        model_class = apps.get_model(app_label, model_name)
    except LookupError:
        return {
            'status': 'error',
            'error': f'Model {app_label}.{model_name} not found'
        }

    try:
        instance = model_class.objects.get(pk=pk)

        # Permission check: only allow owner/staff/superuser to delete
        if not _user_has_permission_for_instance(user, instance):
            return {
                'status': 'error',
                'error': 'Permission denied'
            }

        instance.delete()
        return {
            'status': 'deleted',
            'model': model_name,
            'pk': pk
        }
    except model_class.DoesNotExist:
        return {
            'status': 'error',
            'error': f'{model_name} with pk={pk} not found'
        }
    except Exception as e:
        logger.error(f'Failed to delete {model_name} pk={pk}: {e}')
        return {
            'status': 'error',
            'error': str(e)
        }


@csrf_protect
@require_POST
def publish_changes(request):
    """
    Apply all changes from the action queue atomically.

    Receives a JSON payload with:
    - entity_type: Type of main entity being edited
    - entity_id: ID of main entity
    - actions: List of serialized actions
    - changelist: Summary of changes for logging

    All actions are applied within a transaction. If any action fails,
    the entire transaction is rolled back.

    Args:
        request: HTTP request with JSON body

    Returns:
        JsonResponse with success status and results
    """
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({
            'success': False,
            'error': 'Invalid JSON payload'
        }, status=400)

    entity_type = data.get('entity_type')
    entity_id = data.get('entity_id')
    actions = data.get('actions', [])
    changelist = data.get('changelist', {})

    if not actions:
        return JsonResponse({
            'success': False,
            'error': 'No actions to publish'
        }, status=400)

    logger.info(
        f'Publishing {len(actions)} actions for {entity_type}:{entity_id} '
        f'by user {request.user}'
    )

    results = []
    failed_at = None

    try:
        with transaction.atomic():
            for i, action in enumerate(actions):
                action_type = action.get('type')
                handler = get_action_handler(action_type)

                if not handler:
                    raise ValueError(
                        f'No handler for action type: {action_type}'
                    )

                result = handler(action, request.user)
                results.append({
                    'action_type': action_type,
                    'description': action.get('description', ''),
                    **result
                })

                # Check if action failed
                if result.get('status') == 'error':
                    failed_at = i
                    raise ValueError(result.get('error', 'Unknown error'))

        # All actions succeeded
        return JsonResponse({
            'success': True,
            'message': f'Successfully published {len(actions)} changes',
            'results': results,
            'changelist_summary': changelist.get('summary', {})
        })

    except ValueError as e:
        # Validation or handler error - transaction rolled back
        return JsonResponse({
            'success': False,
            'error': str(e),
            'failed_at_index': failed_at,
            'results': results
        }, status=400)

    except Exception as e:
        # Unexpected error
        logger.exception(f'Publish failed for {entity_type}:{entity_id}')
        return JsonResponse({
            'success': False,
            'error': 'An unexpected error occurred',
            'details': str(e) if request.user.is_staff else None
        }, status=500)
